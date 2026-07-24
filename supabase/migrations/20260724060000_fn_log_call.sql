-- §14 follow-up (2026-07-24): Anis wants sales entered through the app end to
-- end, not via the monthly Team Dashboard Excel/Sheet import. fn_log_sale
-- already covers revenue/sales_count in real time; calls_count was the one
-- field still only ever populated by the import. Same increment-on-conflict
-- shape as fn_log_sale, just for the calls side.
create or replace function fn_log_call()
returns agent_daily_performance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_row agent_daily_performance;
begin
  select a.id into v_agent_id
  from agents a
  where a.profile_id = auth.uid();

  if v_agent_id is null then
    raise exception 'no agent linked to current user';
  end if;

  insert into agent_daily_performance (agent_id, date, calls_count, source_file)
  values (v_agent_id, current_date, 1, 'app')
  on conflict (agent_id, date)
  do update set
    calls_count = coalesce(agent_daily_performance.calls_count, 0) + 1
  returning * into v_row;

  return v_row;
end;
$$;
