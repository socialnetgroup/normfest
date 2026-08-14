-- Anis (2026-08-14), agent feedback after the "Weitere Position" feature
-- (§14 item 69): "Komprimirati verkauf kad upisujemo Artikal po artikal
-- pojavi se npr 3 verkaufa al je jedan u sustini sa 3 pozicije" - selling
-- 3 products in one call still correctly writes 3 separate sales_feedback
-- rows (each independently syncs agent_daily_performance, and per Anis's
-- own explicit call this session: "mi smo rekli da cemo u listu u bazu
-- upisivati jedno po jedno" - keep writing one row per position), but the
-- Feedback-Verlauf display showed them as 3 unrelated "Verkauft" entries
-- with no visual link between them.
--
-- batch_id ties together the rows from one multi-position submit purely
-- for DISPLAY grouping - nullable, only ever set when a form submission
-- actually produced more than one row (a single-position sale gets no
-- batch_id, same as before this migration).
alter table sales_feedback add column batch_id uuid;

create index idx_sales_feedback_batch_id on sales_feedback (batch_id) where batch_id is not null;

-- Same overload trap already hit multiple times on this table today -
-- drop the exact old (post-wiedervorlage_time) signature before adding
-- the new trailing parameter.
drop function if exists fn_log_sales_feedback(uuid, text, uuid, int, numeric, text, text, date, time);

create or replace function fn_log_sales_feedback(
  p_company_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null,
  p_wiedervorlage_date date default null,
  p_wiedervorlage_time time default null,
  p_batch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_agent_id uuid;
begin
  if p_outcome = 'nicht_besucht' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Kommentar ist bei "Nicht besucht" Pflicht';
  end if;

  insert into sales_feedback (agent_id, company_id, product_id, outcome, qty, value_net, objection, comment, wiedervorlage_date, wiedervorlage_time, batch_id)
  values (auth.uid(), p_company_id, p_product_id, p_outcome, p_qty, p_value_net, p_objection, p_comment, p_wiedervorlage_date, p_wiedervorlage_time, p_batch_id)
  returning id into new_id;

  if p_outcome = 'sold' and p_value_net is not null and p_value_net > 0 then
    select a.id into v_agent_id
    from agents a
    where a.profile_id = auth.uid();

    if v_agent_id is not null then
      insert into agent_daily_performance (agent_id, date, revenue, sales_count, source_file)
      values (v_agent_id, current_date, p_value_net, 1, 'app')
      on conflict (agent_id, date)
      do update set
        revenue = agent_daily_performance.revenue + excluded.revenue,
        sales_count = agent_daily_performance.sales_count + excluded.sales_count;
    end if;
  end if;

  return new_id;
end;
$$;
