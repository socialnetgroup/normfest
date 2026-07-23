-- M4 remainder (CLAUDE.md §7): winner stats feeding the generated
-- next-Fokus-list draft. security_invoker so it inherits sales_feedback's
-- existing select-all-authenticated RLS, same pattern as feedback_sales.
create view product_winner_stats with (security_invoker = true) as
  select
    product_id,
    count(*) as sold_count,
    sum(qty) as total_qty,
    sum(value_net) as total_value,
    max(created_at) as last_sold_at
  from sales_feedback
  where outcome = 'sold' and product_id is not null
  group by product_id;

-- Admin-adjustable threshold for "is this a winner yet" — starts at 1
-- since real feedback volume is still near zero (no agents onboarded in
-- production yet); raise once volume grows and 1 sale stops being
-- meaningful signal.
insert into settings (key, value) values
  ('focus_winner_min_sold', '1'::jsonb)
on conflict (key) do nothing;
