-- Unify the two disconnected "log a sale" paths (Anis, 2026-07-24): logging
-- a 'sold' outcome via Feedback (company+product+amount - strictly more
-- data than the bare "Verkauf eintragen" quick amount) previously never
-- touched agent_daily_performance, so it didn't count toward the Team
-- Dashboard/leaderboard/bonus - only fn_log_sale's bare-amount entry did.
-- One real sale should be one real recording event.
--
-- fn_log_sales_feedback replaces the direct client-side
-- sales_feedback inserts (feedback-form.tsx, focus-product-sell-form.tsx)
-- and is the same signature fn_chat_log_sales_feedback already used, so
-- that one now just delegates here instead of duplicating logic. Security
-- definer only for the agent_daily_performance side-effect (mirrors
-- fn_log_sale's exact increment-on-conflict shape); the sales_feedback
-- insert itself still goes through RLS via agent_id = auth.uid().
create or replace function fn_log_sales_feedback(
  p_company_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null
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
  insert into sales_feedback (agent_id, company_id, product_id, outcome, qty, value_net, objection, comment)
  values (auth.uid(), p_company_id, p_product_id, p_outcome, p_qty, p_value_net, p_objection, p_comment)
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

create or replace function fn_chat_log_sales_feedback(
  p_company_id uuid,
  p_outcome text,
  p_product_id uuid default null,
  p_qty int default null,
  p_value_net numeric default null,
  p_objection text default null,
  p_comment text default null
)
returns uuid
language plpgsql
as $$
begin
  return fn_log_sales_feedback(p_company_id, p_outcome, p_product_id, p_qty, p_value_net, p_objection, p_comment);
end;
$$;
