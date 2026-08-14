-- Anis (2026-08-14): "Widervorlagen treba i Uhrzeit da mozemo oznaciti u
-- koliko firmu treba nazvati" - the original v1 (§14 item 21) was
-- deliberately date-only ("just a date field + a due-today banner, not a
-- full separate Wiedervorlagen screen"); real usage since (386 real rows)
-- shows agents want to note a specific callback time too, not just the day.
alter table sales_feedback add column wiedervorlage_time time;

-- Real overload trap already hit and documented twice on this same
-- table (Wiedervorlage's own original migration + the feedback outcome
-- taxonomy migration): `create or replace function` treats a changed
-- parameter list as a different signature, silently leaving the old
-- version in place alongside the new one instead of replacing it. Drop
-- the exact old signatures first, same as those two prior fixes.
drop function if exists fn_log_sales_feedback(uuid, text, uuid, int, numeric, text, text, date);
drop function if exists fn_update_sales_feedback(uuid, text, uuid, int, numeric, text, text, date, boolean);

create or replace function fn_log_sales_feedback(
  p_company_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null,
  p_wiedervorlage_date date default null,
  p_wiedervorlage_time time default null
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

  insert into sales_feedback (agent_id, company_id, product_id, outcome, qty, value_net, objection, comment, wiedervorlage_date, wiedervorlage_time)
  values (auth.uid(), p_company_id, p_product_id, p_outcome, p_qty, p_value_net, p_objection, p_comment, p_wiedervorlage_date, p_wiedervorlage_time)
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

create or replace function fn_update_sales_feedback(
  p_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null,
  p_wiedervorlage_date date default null,
  p_wiedervorlage_time time default null,
  p_wiedervorlage_done boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old sales_feedback%rowtype;
  v_agent_id uuid;
begin
  if p_outcome = 'nicht_besucht' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Kommentar ist bei "Nicht besucht" Pflicht';
  end if;

  select * into v_old from sales_feedback where id = p_id;
  if v_old.id is null then
    raise exception 'Feedback nicht gefunden';
  end if;
  if v_old.agent_id != auth.uid() and not fn_is_admin() then
    raise exception 'Nicht berechtigt';
  end if;

  update sales_feedback
  set outcome = p_outcome,
      product_id = p_product_id,
      qty = p_qty,
      value_net = p_value_net,
      objection = p_objection,
      comment = p_comment,
      wiedervorlage_date = p_wiedervorlage_date,
      wiedervorlage_time = p_wiedervorlage_time,
      wiedervorlage_done = p_wiedervorlage_done
  where id = p_id;

  select a.id into v_agent_id from agents a where a.profile_id = v_old.agent_id;
  if v_agent_id is not null then
    if v_old.outcome = 'sold' and v_old.value_net is not null and v_old.value_net > 0 then
      update agent_daily_performance
      set revenue = revenue - v_old.value_net,
          sales_count = greatest(sales_count - 1, 0)
      where agent_id = v_agent_id and date = v_old.created_at::date;
    end if;

    if p_outcome = 'sold' and p_value_net is not null and p_value_net > 0 then
      insert into agent_daily_performance (agent_id, date, revenue, sales_count, source_file)
      values (v_agent_id, v_old.created_at::date, p_value_net, 1, 'app')
      on conflict (agent_id, date)
      do update set
        revenue = agent_daily_performance.revenue + excluded.revenue,
        sales_count = agent_daily_performance.sales_count + excluded.sales_count;
    end if;
  end if;
end;
$$;
