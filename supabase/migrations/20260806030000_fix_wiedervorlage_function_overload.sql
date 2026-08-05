-- Fix for a real bug from 20260806020000_wiedervorlage.sql: CREATE OR
-- REPLACE FUNCTION does not replace a function whose parameter list
-- changed (adding p_wiedervorlage_date made this a different signature) -
-- it just adds an overload alongside the old one. fn_chat_log_sales_feedback
-- calls fn_log_sales_feedback positionally with the original 7 args, which
-- became ambiguous between the old and new overloads ("function ... is not
-- unique", caught by the real RLS test suite, not guessed). Explicitly drop
-- the old signatures before recreating with the new one.
drop function if exists fn_log_sales_feedback(uuid, text, uuid, int, numeric, text, text);
drop function if exists fn_update_sales_feedback(uuid, text, uuid, int, numeric, text, text);

create or replace function fn_log_sales_feedback(
  p_company_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null,
  p_wiedervorlage_date date default null
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
  insert into sales_feedback (agent_id, company_id, product_id, outcome, qty, value_net, objection, comment, wiedervorlage_date)
  values (auth.uid(), p_company_id, p_product_id, p_outcome, p_qty, p_value_net, p_objection, p_comment, p_wiedervorlage_date)
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
