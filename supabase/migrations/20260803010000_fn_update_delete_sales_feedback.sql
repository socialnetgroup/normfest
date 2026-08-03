-- Anis (2026-08-03): agents should be able to correct their own mistaken
-- feedback entries (wrong outcome/qty/value/objection, or delete entirely),
-- not just admin/service-role as the original §4.7 comment assumed.
--
-- Not exposed as a plain RLS update/delete policy: fn_log_sales_feedback
-- has a real side effect on 'sold' outcomes (increments
-- agent_daily_performance.revenue/sales_count for that day, which feeds the
-- Team Dashboard/leaderboard/bonus). A raw table-level update/delete would
-- silently desync that side effect from the corrected/removed row. Routing
-- both through security-definer RPCs keeps that one code path authoritative
-- - editing/deleting a 'sold' row always reverses its old contribution (on
-- the row's own date, not today) and applies the new one, so the two tables
-- can never drift.
create or replace function fn_update_sales_feedback(
  p_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null
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
      comment = p_comment
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

create or replace function fn_delete_sales_feedback(p_id uuid)
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

  if v_old.outcome = 'sold' and v_old.value_net is not null and v_old.value_net > 0 then
    select a.id into v_agent_id from agents a where a.profile_id = v_old.agent_id;
    if v_agent_id is not null then
      update agent_daily_performance
      set revenue = revenue - v_old.value_net,
          sales_count = greatest(sales_count - 1, 0)
      where agent_id = v_agent_id and date = v_old.created_at::date;
    end if;
  end if;

  delete from sales_feedback where id = p_id;
end;
$$;

grant execute on function fn_update_sales_feedback(uuid, text, uuid, int, numeric, text, text) to authenticated;
grant execute on function fn_delete_sales_feedback(uuid) to authenticated;
