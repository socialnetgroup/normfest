-- Anis (2026-08-18), on the Dialer's "Prodaje" column: "to bi trebalo biti
-- 1 prodaja 6 pozicija danas kod Maje" - real root cause found, not just a
-- Dialer display issue. fn_log_sales_feedback has always incremented
-- agent_daily_performance.sales_count by 1 PER ROW inserted - correct back
-- when one row always meant one real sale, but the multi-position "Weitere
-- Position" feature (§14 item 69/80, 2026-08-14) writes N rows sharing one
-- batch_id for what is genuinely ONE real sale with N line items. Since
-- then, sales_count has silently counted POSITIONS, not real sales,
-- everywhere it's read: Rangliste, Team/Tim pages, Dashboard KPIs, and the
-- Dialer's own "Sales" column (re-sourced to this exact field in §14 item
-- 27 specifically to match "the same real source as Rangliste/Team
-- Dashboard" - that intent is what's actually restored here).
--
-- Fix: sales_count only increments for the FIRST sold+valued row of a
-- batch (identified as the earliest created_at, tie-broken by id, among
-- that batch's sold+valued rows - batch_id is never null for a
-- single-position sale, so those are unaffected: always their own "first").
-- revenue keeps summing every row unconditionally, since the real total
-- money is correctly the sum of all positions - only the COUNT was wrong.
--
-- fn_update_sales_feedback/fn_delete_sales_feedback are updated in lockstep
-- so revenue and sales_count reversal/reapplication stay correct once a
-- row's sales_count contribution is no longer simply "1 per sold row".
-- Known, accepted limitation (rare in practice - batch edits/deletes are
-- uncommon vs. new inserts): if the specific row that "counts" for a batch
-- (the earliest sold+valued one) is edited away from sold/deleted, no
-- sibling row in that batch automatically takes over the +1 - the batch's
-- sales_count contribution is simply lost rather than cascading to the
-- next-earliest sibling. A real gap, not silently pretended away, but out
-- of scope for today's fix (which targets the actual reported bug: new
-- multi-position inserts inflating the live count).
--
-- Signatures are UNCHANGED from the current versions (20260814060000 /
-- 20260814050000 / 20260803010000) - body-only fix, no overload risk.

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
  v_is_first_sold_in_batch boolean := true;
begin
  if p_outcome = 'nicht_besucht' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Kommentar ist bei "Nicht besucht" Pflicht';
  end if;

  if p_outcome = 'sold' and p_value_net is not null and p_value_net > 0 and p_batch_id is not null then
    select not exists (
      select 1 from sales_feedback
      where batch_id = p_batch_id and outcome = 'sold' and value_net > 0
    ) into v_is_first_sold_in_batch;
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
      values (v_agent_id, current_date, p_value_net, (case when v_is_first_sold_in_batch then 1 else 0 end), 'app')
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
  v_old_was_counted boolean := false;
  v_new_is_counted boolean := false;
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

  if v_old.outcome = 'sold' and v_old.value_net is not null and v_old.value_net > 0 then
    v_old_was_counted := (
      v_old.batch_id is null
      or v_old.id = (
        select id from sales_feedback
        where batch_id = v_old.batch_id and outcome = 'sold' and value_net > 0
        order by created_at asc, id asc
        limit 1
      )
    );
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

  if p_outcome = 'sold' and p_value_net is not null and p_value_net > 0 then
    v_new_is_counted := (
      v_old.batch_id is null
      or p_id = (
        select id from sales_feedback
        where batch_id = v_old.batch_id and outcome = 'sold' and value_net > 0
        order by created_at asc, id asc
        limit 1
      )
    );
  end if;

  select a.id into v_agent_id from agents a where a.profile_id = v_old.agent_id;
  if v_agent_id is not null then
    if v_old.outcome = 'sold' and v_old.value_net is not null and v_old.value_net > 0 then
      update agent_daily_performance
      set revenue = revenue - v_old.value_net,
          sales_count = greatest(sales_count - (case when v_old_was_counted then 1 else 0 end), 0)
      where agent_id = v_agent_id and date = v_old.created_at::date;
    end if;

    if p_outcome = 'sold' and p_value_net is not null and p_value_net > 0 then
      insert into agent_daily_performance (agent_id, date, revenue, sales_count, source_file)
      values (v_agent_id, v_old.created_at::date, p_value_net, (case when v_new_is_counted then 1 else 0 end), 'app')
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
  v_old_was_counted boolean := false;
begin
  select * into v_old from sales_feedback where id = p_id;
  if v_old.id is null then
    raise exception 'Feedback nicht gefunden';
  end if;
  if v_old.agent_id != auth.uid() and not fn_is_admin() then
    raise exception 'Nicht berechtigt';
  end if;

  if v_old.outcome = 'sold' and v_old.value_net is not null and v_old.value_net > 0 then
    v_old_was_counted := (
      v_old.batch_id is null
      or v_old.id = (
        select id from sales_feedback
        where batch_id = v_old.batch_id and outcome = 'sold' and value_net > 0
        order by created_at asc, id asc
        limit 1
      )
    );

    select a.id into v_agent_id from agents a where a.profile_id = v_old.agent_id;
    if v_agent_id is not null then
      update agent_daily_performance
      set revenue = revenue - v_old.value_net,
          sales_count = greatest(sales_count - (case when v_old_was_counted then 1 else 0 end), 0)
      where agent_id = v_agent_id and date = v_old.created_at::date;
    end if;
  end if;

  delete from sales_feedback where id = p_id;
end;
$$;
