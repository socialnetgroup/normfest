-- Real regression found in CI (2026-07-31): fn_refresh_signals() now takes
-- ~27.8s end to end (measured directly against production via clock_timestamp()),
-- well past the `authenticated` role's statement_timeout=8s, so both the RLS
-- test suite and any real admin click of "Empfehlungen aktualisieren" now fail
-- outright with a 57014 (statement timeout) error.
--
-- Root cause: the whole-book enrichment rollout (2026-07-27/28) grew
-- company_enrichment from ~494 to 1,432 analyzed rows. seasonal_push,
-- new_product_match, and cross_sell each independently re-run the exact same
-- expensive `cross join lateral jsonb_array_elements(external_opportunities)`
-- unnest (2.8s measured standalone) to compute company/category affinity from
-- enrichment data -- doing it 2-3 times per call instead of once. Verified via
-- EXPLAIN ANALYZE directly against production before writing this fix.
--
-- Fix: compute the category-level affinity (used by seasonal_push and
-- new_product_match) and the product-level cross_sell trigger set once each,
-- into temp tables, then have all three blocks join against those instead of
-- repeating the unnest. Also bump this function's own statement_timeout as a
-- safety margin for continued data growth -- `set local` only affects the
-- remainder of this transaction, not the role default.
create or replace function fn_refresh_signals()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '45s'
as $$
begin
  if auth.uid() is not null and not fn_is_admin() then
    raise exception 'admin only';
  end if;

  -- Real cost after the 2026-07-27/28 enrichment rollout: measured ~26-30s
  -- end to end (cross_sell alone now produces ~85k rows, up from ~17.6k, as
  -- company_enrichment grew 494 -> 1432 analyzed rows). This function's own
  -- `set statement_timeout` above (a function-level GUC override, applied
  -- BEFORE the call's statement-timeout deadline is armed) is what actually
  -- gives it headroom over the `authenticated` role's 8s default -- a plain
  -- `set local` inside the function body does NOT work for this, since the
  -- deadline for the top-level RPC statement is already latched by the time
  -- the function body starts running. Verified directly: without the
  -- function-level SET, every RPC call died at exactly ~8s with 57014.

  create temp table _category_affinity on commit drop as
  select distinct sf.company_id, pr.category_code, 'rule'::text as source_type
  from sales_feedback sf
  join products pr on pr.id = sf.product_id
  where sf.outcome in ('sold', 'interested')
  union
  select distinct ce.company_id, pc.category_code, 'enrichment'::text as source_type
  from company_enrichment ce
  cross join lateral jsonb_array_elements(coalesce(ce.external_opportunities, '[]'::jsonb)) as opp
  join product_categories pc on pc.category_name = opp ->> 'catalog_category'
  where opp ->> 'catalog_category' is not null;

  create index on _category_affinity (company_id, category_code);
  analyze _category_affinity;

  create temp table _crosssell_triggers on commit drop as
  select fs.company_id, fs.product_id, 'rule'::text as source_type
  from feedback_sales fs
  union
  select distinct ce.company_id, (mp ->> 'id')::uuid as product_id, 'enrichment'::text as source_type
  from company_enrichment ce
  cross join lateral jsonb_array_elements(coalesce(ce.external_opportunities, '[]'::jsonb)) as opp
  cross join lateral jsonb_array_elements(coalesce(opp -> 'matched_products', '[]'::jsonb)) as mp;

  create index on _crosssell_triggers (product_id);
  analyze _crosssell_triggers;

  delete from signals where type = 'focus_list_push';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    fli.company_id,
    null,
    'focus_list_push',
    1,
    'rule',
    3,
    'Auf aktueller Fokusliste „' || fl.name || '"' || coalesce(' - ' || fli.note, ''),
    jsonb_build_object('focus_list_id', fl.id, 'focus_list_item_id', fli.id)
  from focus_list_items fli
  join focus_lists fl on fl.id = fli.focus_list_id and fl.active
  join companies c on c.id = fli.company_id and not c.do_not_contact and c.active
  where not exists (
    select 1 from signal_dismissals sd
    where sd.company_id = fli.company_id and sd.type = 'focus_list_push' and sd.product_id is null
  );

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
    and c.revenue_current_year > 0
    and c.revenue_current_year < c.revenue_prior_year * 0.85
    and not exists (
      select 1 from signal_dismissals sd
      where sd.company_id = c.id and sd.type = 'revenue_trend_risk' and sd.product_id is null
    );

  -- feedback_replenishment: unchanged, deliberately. It's about actual
  -- repurchase CYCLES (avg gap between real sales), which enrichment has no
  -- substitute for — this one genuinely needs the feedback learning curve.
  delete from signals where type = 'feedback_replenishment';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select
    stats.company_id,
    stats.product_id,
    'feedback_replenishment',
    1,
    'rule',
    3,
    'Laut Feedback bisher alle ~' || round(stats.avg_gap_days) || ' Tage bestellt - letzter Verkauf vor '
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
    and stats.days_since_last > stats.avg_gap_days * 1.25
    and not exists (
      select 1 from signal_dismissals sd
      where sd.company_id = stats.company_id and sd.type = 'feedback_replenishment' and sd.product_id = stats.product_id
    );

  -- seasonal_push: category affinity now read from the pre-computed temp
  -- table instead of re-running the enrichment unnest.
  delete from signals where type = 'seasonal_push';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select distinct on (aff.company_id, p.id)
    aff.company_id,
    p.id,
    'seasonal_push',
    1,
    aff.source_type,
    case when aff.source_type = 'rule' then 2 else 1.5 end,
    case when aff.source_type = 'rule'
      then 'Saisonartikel - Kategorie „' || p.category_name || '" bereits laut Feedback nachgefragt.'
      else 'Saisonartikel - Kategorie „' || p.category_name || '" laut KI-Anreicherung relevant (nicht verifiziert).'
    end,
    jsonb_build_object('product_id', p.id, 'season', p.season, 'affinity_source', aff.source_type)
  from products p
  join _category_affinity aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.season is not null
    and (',' || p.season || ',') like '%,' || extract(month from now())::text || ',%'
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    )
    and not exists (
      select 1 from signal_dismissals sd
      where sd.company_id = aff.company_id and sd.type = 'seasonal_push' and sd.product_id = p.id
    )
  order by aff.company_id, p.id, case when aff.source_type = 'rule' then 0 else 1 end;

  -- new_product_match: same shared affinity source.
  delete from signals where type = 'new_product_match';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select distinct on (aff.company_id, p.id)
    aff.company_id,
    p.id,
    'new_product_match',
    1,
    aff.source_type,
    case when aff.source_type = 'rule' then 2 else 1.5 end,
    case when aff.source_type = 'rule'
      then 'Neu im Sortiment (' || to_char(p.launched_at, 'DD.MM.YYYY') || ') - Kategorie „' || p.category_name
        || '" bereits laut Feedback nachgefragt.'
      else 'Neu im Sortiment (' || to_char(p.launched_at, 'DD.MM.YYYY') || ') - Kategorie „' || p.category_name
        || '" laut KI-Anreicherung relevant (nicht verifiziert).'
    end,
    jsonb_build_object('product_id', p.id, 'launched_at', p.launched_at, 'affinity_source', aff.source_type)
  from products p
  join _category_affinity aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.launched_at is not null
    and p.launched_at >= (current_date - interval '90 days')
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    )
    and not exists (
      select 1 from signal_dismissals sd
      where sd.company_id = aff.company_id and sd.type = 'new_product_match' and sd.product_id = p.id
    )
  order by aff.company_id, p.id, case when aff.source_type = 'rule' then 0 else 1 end;

  -- cross_sell: trigger set read from the pre-computed temp table instead of
  -- re-running the (heavier, doubly-nested) enrichment unnest.
  delete from signals where type = 'cross_sell';
  insert into signals (company_id, product_id, type, tier, origin, score, reason, source)
  select distinct on (trig.company_id, pr.related_product_id)
    trig.company_id,
    pr.related_product_id,
    'cross_sell',
    1,
    trig.source_type,
    case when trig.source_type = 'rule' then pr.weight else greatest(1, pr.weight - 1) end,
    case when trig.source_type = 'rule'
      then 'Passt zu bereits verkauftem Artikel „' || p1.name || '"' || coalesce(' - ' || pr.note, '') || '.'
      else 'Passt zu einer laut KI-Anreicherung erkannten Chance („' || p1.name || '", nicht verifiziert)'
        || coalesce(' - ' || pr.note, '') || '.'
    end,
    jsonb_build_object('product_relation_id', pr.id, 'base_product_id', pr.product_id, 'affinity_source', trig.source_type)
  from _crosssell_triggers trig
  join product_relations pr on pr.product_id = trig.product_id and pr.relation_type = 'cross_sell'
  join products p1 on p1.id = pr.product_id
  join companies c on c.id = trig.company_id and not c.do_not_contact and c.active
  where not exists (
    select 1 from sales_feedback sf2
    where sf2.company_id = trig.company_id and sf2.product_id = pr.related_product_id and sf2.outcome = 'sold'
  )
  and not exists (
    select 1 from signal_dismissals sd
    where sd.company_id = trig.company_id and sd.type = 'cross_sell' and sd.product_id = pr.related_product_id
  )
  order by trig.company_id, pr.related_product_id, case when trig.source_type = 'rule' then 0 else 1 end;
end;
$$;
