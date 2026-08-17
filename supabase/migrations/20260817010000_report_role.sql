-- Anis, 2026-08-17: "Lets make a new user and a new view for that user...
-- report@social-net.ba... a kinda of viewing angle wheres the project at."
-- A third role, distinct from admin/agent - structurally read-only (no
-- write policy anywhere ever checks fn_is_report(), only SELECT/RPC access)
-- and always whole-book (never gebiet-scoped), for a CEO/board-style
-- overview: KPIs, Umsatz (bonus-gated same as the rest of the tool),
-- flywheel health, Anreicherung/Katalog coverage, Dialer aggregate,
-- AI-Assistent usage. Deliberately excludes Signale/Bestellungen/Fokus per
-- Anis's own framing ("they dont care so deep operational, they dont even
-- know that exists").
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('agent', 'admin', 'report'));

create or replace function fn_is_report()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'report'
  );
$$;

-- Most of what the report page needs (products, sales_feedback,
-- agent_daily_performance, agents, settings) is already shared-read for any
-- authenticated user (confirmed by reading the real RLS policies, not
-- assumed) - report@ gets those for free the moment the account exists.
-- The two real gaps are (1) `companies`/`company_enrichment` aggregates,
-- gated by the gebiet-scoped fn_company_visible(), and (2) chat_log, which
-- is deliberately private-per-agent (§10 - "closer to the agent's own
-- notebook") and must never expose raw transcripts here, only counts.
-- Rather than widen fn_company_visible() itself (used everywhere, including
-- agent-facing pages - a broad change with a bigger blast radius than this
-- one page needs) or chat_log's RLS, one narrow security-definer RPC
-- computes both aggregates directly, gated explicitly on admin-or-report.
create or replace function fn_report_stats()
returns table (
  companies_total bigint,
  places_resolved bigint,
  website_fetched bigint,
  ai_analyzed bigint,
  ambiguous bigint,
  chat_messages_total bigint,
  chat_messages_week bigint,
  chat_messages_today bigint,
  chat_active_agents bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (fn_is_admin() or fn_is_report()) then
    raise exception 'not authorized';
  end if;

  return query
  select
    (select count(*) from companies where active and soft_deleted_at is null),
    (select count(*) from companies c join company_enrichment ce on ce.company_id = c.id
       where c.active and c.soft_deleted_at is null and ce.places_resolved_at is not null),
    (select count(*) from companies c join company_enrichment ce on ce.company_id = c.id
       where c.active and c.soft_deleted_at is null and ce.website_fetched_at is not null),
    (select count(*) from companies c join company_enrichment ce on ce.company_id = c.id
       where c.active and c.soft_deleted_at is null and ce.analyzed_at is not null),
    (select count(*) from companies c join company_enrichment ce on ce.company_id = c.id
       where c.active and c.soft_deleted_at is null and ce.places_ambiguous),
    (select count(*) from chat_log where role = 'user'),
    (select count(*) from chat_log where role = 'user' and created_at >= date_trunc('week', now())),
    (select count(*) from chat_log where role = 'user' and created_at >= date_trunc('day', now())),
    (select count(distinct agent_id) from chat_log where role = 'user');
end;
$$;

grant execute on function fn_report_stats() to authenticated;
