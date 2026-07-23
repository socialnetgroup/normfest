-- Anis (2026-07-23): "dont rely so much on agent logs a sale, try to make as
-- much as possible to work out of the box, without the learning curve if
-- possible. Later on added info ofc helps." Real gap this exposed:
-- seasonal_push, new_product_match, and cross_sell all gated their category/
-- product affinity purely on sales_feedback ('sold'/'interested') — with
-- real feedback volume near zero (2 rows total, checked directly), all three
-- were effectively dead on arrival for every company, no matter how good the
-- enrichment pipeline's output was.
--
-- Real numbers checked before writing this: 1,384 distinct (company,
-- catalog_category) affinity pairs already exist from M5 enrichment
-- (company_enrichment.external_opportunities[].catalog_category, itself
-- derived from Google reviews/website/name — zero agent action required)
-- across 345 companies, vs. 2 from feedback. This is the "out of the box"
-- data source that already exists; feedback-derived affinity stays as a
-- second, stronger-evidence source that improves things over time exactly
-- as feedback volume grows — not replaced, added alongside.
--
-- §6 "enrichment-origin discounted until verified" is honored explicitly:
-- rows sourced from enrichment get origin='enrichment' and a lower score
-- than the equivalent feedback-sourced row, with reason text that says so
-- ("laut KI-Anreicherung, nicht verifiziert") — never silently blended with
-- feedback-sourced provenance (§3.2.6 "two fact classes, never silently
-- mixed"). When both sources agree for the same (company, product), the
-- feedback-sourced (stronger) row wins via explicit priority ordering.
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
    and c.revenue_current_year < c.revenue_prior_year * 0.85;

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

  -- seasonal_push: category affinity now feedback OR enrichment-derived.
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
      then 'Saisonartikel — Kategorie „' || p.category_name || '" bereits laut Feedback nachgefragt.'
      else 'Saisonartikel — Kategorie „' || p.category_name || '" laut KI-Anreicherung relevant (nicht verifiziert).'
    end,
    jsonb_build_object('product_id', p.id, 'season', p.season, 'affinity_source', aff.source_type)
  from products p
  join (
    select distinct sf.company_id, pr.category_code, 'rule' as source_type
    from sales_feedback sf
    join products pr on pr.id = sf.product_id
    where sf.outcome in ('sold', 'interested')
    union
    select distinct ce.company_id, pc.category_code, 'enrichment' as source_type
    from company_enrichment ce
    cross join lateral jsonb_array_elements(coalesce(ce.external_opportunities, '[]'::jsonb)) as opp
    join product_categories pc on pc.category_name = opp ->> 'catalog_category'
    where opp ->> 'catalog_category' is not null
  ) aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.season is not null
    and (',' || p.season || ',') like '%,' || extract(month from now())::text || ',%'
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    )
  order by aff.company_id, p.id, case when aff.source_type = 'rule' then 0 else 1 end;

  -- new_product_match: same affinity source, same priority rule.
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
      then 'Neu im Sortiment (' || to_char(p.launched_at, 'DD.MM.YYYY') || ') — Kategorie „' || p.category_name
        || '" bereits laut Feedback nachgefragt.'
      else 'Neu im Sortiment (' || to_char(p.launched_at, 'DD.MM.YYYY') || ') — Kategorie „' || p.category_name
        || '" laut KI-Anreicherung relevant (nicht verifiziert).'
    end,
    jsonb_build_object('product_id', p.id, 'launched_at', p.launched_at, 'affinity_source', aff.source_type)
  from products p
  join (
    select distinct sf.company_id, pr.category_code, 'rule' as source_type
    from sales_feedback sf
    join products pr on pr.id = sf.product_id
    where sf.outcome in ('sold', 'interested')
    union
    select distinct ce.company_id, pc.category_code, 'enrichment' as source_type
    from company_enrichment ce
    cross join lateral jsonb_array_elements(coalesce(ce.external_opportunities, '[]'::jsonb)) as opp
    join product_categories pc on pc.category_name = opp ->> 'catalog_category'
    where opp ->> 'catalog_category' is not null
  ) aff on aff.category_code = p.category_code
  join companies c on c.id = aff.company_id and not c.do_not_contact and c.active
  where p.launched_at is not null
    and p.launched_at >= (current_date - interval '90 days')
    and not exists (
      select 1 from sales_feedback sf2
      where sf2.company_id = aff.company_id and sf2.product_id = p.id
    )
  order by aff.company_id, p.id, case when aff.source_type = 'rule' then 0 else 1 end;

  -- cross_sell: anchor-product trigger now feedback ('sold') OR enrichment
  -- (a real catalog product already matched in external_opportunities).
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
      then 'Passt zu bereits verkauftem Artikel „' || p1.name || '"' || coalesce(' — ' || pr.note, '') || '.'
      else 'Passt zu einer laut KI-Anreicherung erkannten Chance („' || p1.name || '", nicht verifiziert)'
        || coalesce(' — ' || pr.note, '') || '.'
    end,
    jsonb_build_object('product_relation_id', pr.id, 'base_product_id', pr.product_id, 'affinity_source', trig.source_type)
  from (
    select fs.company_id, fs.product_id, 'rule' as source_type
    from feedback_sales fs
    union
    select distinct ce.company_id, (mp ->> 'id')::uuid as product_id, 'enrichment' as source_type
    from company_enrichment ce
    cross join lateral jsonb_array_elements(coalesce(ce.external_opportunities, '[]'::jsonb)) as opp
    cross join lateral jsonb_array_elements(coalesce(opp -> 'matched_products', '[]'::jsonb)) as mp
  ) trig
  join product_relations pr on pr.product_id = trig.product_id and pr.relation_type = 'cross_sell'
  join products p1 on p1.id = pr.product_id
  join companies c on c.id = trig.company_id and not c.do_not_contact and c.active
  where not exists (
    select 1 from sales_feedback sf2
    where sf2.company_id = trig.company_id and sf2.product_id = pr.related_product_id and sf2.outcome = 'sold'
  )
  order by trig.company_id, pr.related_product_id, case when trig.source_type = 'rule' then 0 else 1 end;
end;
$$;
