-- M4 — fn_refresh_signals(): recomputes the `signals` table from scratch,
-- type by type. Callable by an authenticated admin (Admin panel button,
-- future) or by pg_cron (no auth context — auth.uid() is null there, so the
-- admin gate is skipped rather than blocking the scheduled job).
--
-- Real SQL for every type whose data prerequisite currently exists. Types
-- left out on purpose, not stubbed with fake rows:
--  - brand_profile_match: needs `companies.brand_focus`, which is part of
--    the M5 enrichment schema (§4.6) and doesn't exist yet. Stays in the
--    `signals.type` CHECK list (schema future-proof) but has no generator
--    block here until M5 lands.
--  - replenishment_due, dormant_winback, declining_volume,
--    first_order_followup, basket_expansion, category_gap: Tier 2, and
--    `orders`/`order_items` doesn't exist yet (§4.4, dormant until Tier 2
--    data arrives per §4A). Nothing to compute from.
--  - external_opportunity: M5 enrichment output, not a rule-tier query.
--  - upsell_pack, cross_sell(winner_derived): needs pack_rank ladder /
--    focus-loop winner stats, neither of which exist meaningfully yet with
--    ~1 test feedback row in the system.
--
-- Each block deletes its own type's rows and reinserts — simplest correct
-- way to keep the table in sync without tracking per-row staleness.
create or replace function fn_refresh_signals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not fn_is_admin() then
    raise exception 'admin only';
  end if;

  -- focus_list_push: every company on the currently active focus list.
  delete from signals where type = 'focus_list_push';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    fli.company_id,
    null,
    'focus_list_push',
    1,
    'rule',
    3,
    'Auf aktueller Fokusliste „' || fl.name || '"' || coalesce(' — ' || fli.note, ''),
    jsonb_build_object('focus_list_id', fl.id, 'focus_list_item_id', fli.id)
  from focus_list_items fli
  join focus_lists fl on fl.id = fli.focus_list_id and fl.active
  join companies c on c.id = fli.company_id and not c.do_not_contact and c.active;

  -- revenue_trend_risk (new Tier-1 type, VIS-import proxy for the Tier-2
  -- `declining_volume` concept): annual revenue down >15% vs. prior year.
  -- Labeled explicitly as a weaker, non-invoice-grade source per §4A.
  delete from signals where type = 'revenue_trend_risk';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    c.id,
    null,
    'revenue_trend_risk',
    1,
    'rule',
    round(least(5, 1 + (1 - c.revenue_current_year / c.revenue_prior_year) * 10)::numeric, 2),
    'Umsatz laut VIS ' || round((100 * (1 - c.revenue_current_year / c.revenue_prior_year))::numeric, 0)
      || '% gefallen ggü. Vorjahr (laut Jahresvergleich, kein Tier-2-Beleg).',
    jsonb_build_object('revenue_prior_year', c.revenue_prior_year, 'revenue_current_year', c.revenue_current_year)
  from companies c
  where not c.do_not_contact and c.active
    and c.revenue_prior_year > 0
    and c.revenue_current_year is not null
    and c.revenue_current_year < c.revenue_prior_year * 0.85;

  -- feedback_replenishment §6.2b: ≥3 'sold' feedback rows for the same
  -- (company, product), overdue once days-since-last exceeds avg gap × 1.25.
  delete from signals where type = 'feedback_replenishment';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    stats.company_id,
    stats.product_id,
    'feedback_replenishment',
    1,
    'rule',
    3,
    'Laut Feedback bisher alle ~' || round(stats.avg_gap_days) || ' Tage bestellt — letzter Verkauf vor '
      || round(stats.days_since_last) || ' Tagen (laut Agent-Feedback).',
    jsonb_build_object('n', stats.n, 'avg_gap_days', stats.avg_gap_days, 'last_sale', stats.last_sale)
  from (
    select
      company_id,
      product_id,
      count(*) as n,
      extract(epoch from (max(created_at) - min(created_at))) / 86400 / nullif(count(*) - 1, 0) as avg_gap_days,
      max(created_at) as last_sale,
      extract(epoch from (now() - max(created_at))) / 86400 as days_since_last
    from feedback_sales
    where product_id is not null
    group by company_id, product_id
    having count(*) >= 3
  ) stats
  join companies c on c.id = stats.company_id and not c.do_not_contact and c.active
  where stats.avg_gap_days > 0
    and stats.days_since_last > stats.avg_gap_days * 1.25;

  -- seasonal_push: product.season × current-month window × category
  -- affinity from feedback. Convention (unconfirmed until the catalog
  -- season workshop): `products.season` holds a comma-separated list of
  -- month numbers, e.g. '3,4,5' for spring — revisit this match once real
  -- season data is seeded.
  delete from signals where type = 'seasonal_push';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    aff.company_id,
    p.id,
    'seasonal_push',
    1,
    'rule',
    2,
    'Saisonartikel — Kategorie „' || p.category_name || '" bereits laut Feedback nachgefragt.',
    jsonb_build_object('product_id', p.id, 'season', p.season)
  from products p
  join (
    select distinct sf.company_id, pr.category_code
    from sales_feedback sf
    join products pr on pr.id = sf.product_id
    where sf.outcome in ('sold', 'interested')
  ) aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.season is not null
    and (',' || p.season || ',') like '%,' || extract(month from now())::text || ',%'
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    );

  -- new_product_match: launched <90d ago × same category affinity pattern.
  delete from signals where type = 'new_product_match';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    aff.company_id,
    p.id,
    'new_product_match',
    1,
    'rule',
    2,
    'Neu im Sortiment (' || to_char(p.launched_at, 'DD.MM.YYYY') || ') — Kategorie „' || p.category_name
      || '" bereits laut Feedback nachgefragt.',
    jsonb_build_object('product_id', p.id, 'launched_at', p.launched_at)
  from products p
  join (
    select distinct sf.company_id, pr.category_code
    from sales_feedback sf
    join products pr on pr.id = sf.product_id
    where sf.outcome in ('sold', 'interested')
  ) aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.launched_at is not null
    and p.launched_at >= (current_date - interval '90 days')
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    );

  -- cross_sell (curated only — winner_derived deferred, see header note):
  -- company already sold product A, product_relations says A → B, B not
  -- already sold to that company.
  delete from signals where type = 'cross_sell';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select distinct
    fs.company_id,
    pr.related_product_id,
    'cross_sell',
    1,
    'rule',
    pr.weight,
    'Passt zu bereits verkauftem Artikel „' || p1.name || '"' || coalesce(' — ' || pr.note, '') || '.',
    jsonb_build_object('product_relation_id', pr.id, 'base_product_id', pr.product_id)
  from feedback_sales fs
  join product_relations pr on pr.product_id = fs.product_id and pr.relation_type = 'cross_sell'
  join products p1 on p1.id = pr.product_id
  join companies c on c.id = fs.company_id and not c.do_not_contact and c.active
  where not exists (
    select 1 from sales_feedback sf2
    where sf2.company_id = fs.company_id and sf2.product_id = pr.related_product_id and sf2.outcome = 'sold'
  );
end;
$$;
