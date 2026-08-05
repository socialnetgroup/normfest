-- Wiedervorlage (callback date), added 2026-08-06 - Anis: a deliberate
-- reversal of §1's original "no Wiedervorlagen/tasks, old dialer owns
-- follow-ups" MVP boundary. Motivated by real evidence: reviewing Alan's
-- own sales_feedback comments showed many genuine callback-date mentions
-- ("Sommerpause bis 17.08.2026", "habe den auf Wiedervorlage am 27.08.")
-- that nothing surfaced anywhere. v1 scope, per Anis's own choice: just a
-- date field + a "due today" banner on the Dashboard, not a full separate
-- Wiedervorlagen screen (that's a natural v2 if this proves useful).
alter table sales_feedback add column wiedervorlage_date date;
alter table sales_feedback add column wiedervorlage_done boolean not null default false;

create index idx_sales_feedback_wiedervorlage
  on sales_feedback (wiedervorlage_date)
  where wiedervorlage_date is not null and wiedervorlage_done = false;

-- fn_log_sales_feedback (new entries, via FeedbackForm + the AI assistant's
-- log_sales_feedback tool) gains an optional wiedervorlage date.
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

-- fn_update_sales_feedback (editing an existing row) gains the same two
-- fields - same "always overwrite from the edit form's current state"
-- pattern already used for every other field here, since the edit form
-- always pre-fills from the row being edited (nothing is silently lost).
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

-- Narrow, single-purpose RPC for the Dashboard banner's quick "Erledigt"
-- action - same reasoning as fn_dismiss_signal/fn_set_day_off: dismissing a
-- due Wiedervorlage shouldn't require re-sending the whole feedback row
-- through fn_update_sales_feedback.
create or replace function fn_set_wiedervorlage_done(p_id uuid, p_done boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  select agent_id into v_agent_id from sales_feedback where id = p_id;
  if v_agent_id is null then
    raise exception 'Feedback nicht gefunden';
  end if;
  if v_agent_id != auth.uid() and not fn_is_admin() then
    raise exception 'Nicht berechtigt';
  end if;

  update sales_feedback set wiedervorlage_done = p_done where id = p_id;
end;
$$;
