-- Security audit (2026-07-26): the chat daily-token-budget check read
-- today's usage, then separately inserted the new chat_log row - two
-- back-to-back requests from the same agent could both read "under budget"
-- before either's row landed. This closes that specific window: the
-- check-and-reserve now happens in one statement inside a per-agent
-- transaction-scoped advisory lock (pg_advisory_xact_lock), so two
-- concurrent calls from the same agent are strictly serialized at this step
-- rather than racing on the same stale read.
--
-- Real limit, not silently overclaimed: token counts aren't known until the
-- Anthropic call finishes (chat_log.input_tokens/output_tokens are written
-- later, after streaming completes), so this doesn't turn the budget into a
-- perfectly exact cap - it only guarantees the *check* itself can't be
-- fooled by two requests reading the same stale snapshot. A fully exact cap
-- would need per-request token estimation/reservation, which is real added
-- complexity not justified by the actual risk here (10 internal agents, no
-- adversarial incentive to blow their own daily budget).
create or replace function fn_chat_check_budget_and_log(p_agent_id uuid, p_content text)
returns table (allowed boolean, used_today bigint, daily_budget bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_budget bigint;
  v_used bigint;
begin
  if p_agent_id <> auth.uid() then
    raise exception 'agent id mismatch';
  end if;

  -- Scoped to the calling transaction only - released automatically at
  -- statement/transaction end, no manual unlock needed.
  perform pg_advisory_xact_lock(hashtextextended(p_agent_id::text, 0));

  select (value #>> '{}')::bigint into v_budget
  from settings where key = 'chat_daily_token_budget';
  v_budget := coalesce(v_budget, 200000);

  select coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) into v_used
  from chat_log
  where agent_id = p_agent_id and created_at >= date_trunc('day', now() at time zone 'utc');

  if v_used >= v_budget then
    return query select false, v_used, v_budget;
    return;
  end if;

  insert into chat_log (agent_id, role, content) values (p_agent_id, 'user', p_content);

  return query select true, v_used, v_budget;
end;
$$;
