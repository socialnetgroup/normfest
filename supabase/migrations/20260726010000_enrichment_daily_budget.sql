-- Security audit (2026-07-26): /api/enrich had no daily cost cap, unlike
-- /api/chat's pre-call token budget (§10 M7). It's admin-gated, which covers
-- most of the risk, but a compromised/careless admin session could trigger
-- unlimited real-money Places + Anthropic calls with no ceiling. Mirrors the
-- chat pattern: a settings-driven daily limit checked before any paid work
-- starts.
insert into settings (key, value) values
  ('enrichment_daily_call_budget', '30'::jsonb)
on conflict (key) do nothing;
