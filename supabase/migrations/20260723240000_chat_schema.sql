-- M7 — AI assistant (CLAUDE.md §10, §13). Chat tools are `security invoker`
-- RPCs under the user's own JWT (§3.2.4) — every read-tool below is a plain
-- `language sql`/`plpgsql` function with NO `security definer`, so Postgres
-- runs it as the calling role and existing table RLS (fn_company_visible,
-- shared-read policies, etc.) applies exactly as it would to a direct query.
-- Read-only except fn_chat_log_sales_feedback (§3.2.5) — even that one only
-- ever writes as auth.uid(), same constraint the existing insert policy on
-- sales_feedback already enforces.

create table chat_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles (id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_calls jsonb,
  input_tokens int,
  output_tokens int,
  model text,
  created_at timestamptz not null default now()
);

create index idx_chat_log_agent_id_created_at on chat_log (agent_id, created_at);

alter table chat_log enable row level security;

-- Private per agent (unlike sales_feedback's shared visibility) — a chat
-- transcript is closer to the agent's own notebook than a team flywheel
-- signal, and may reference companies/figures in an unfiltered way mid-
-- conversation. Admin can still see everything for cost/QA oversight
-- (§3.2.9 "usage counters in admin"), same precedent as agent_daily_performance.
create policy chat_log_select_own_or_admin
  on chat_log for select
  to authenticated
  using (agent_id = auth.uid() or fn_is_admin());

create policy chat_log_insert_own
  on chat_log for insert
  to authenticated
  with check (agent_id = auth.uid());

-- No update/delete policy — immutable log, same pattern as sales_feedback.

-- §3.2.9 cost discipline: a simple per-agent daily token budget the chat
-- route checks before calling Anthropic. Generous default; tune once real
-- usage exists.
insert into settings (key, value) values
  ('chat_daily_token_budget', '200000'::jsonb)
on conflict (key) do nothing;

-- ── chat tools ──────────────────────────────────────────────────────────

create or replace function fn_chat_search_companies(p_query text)
returns table (id uuid, name text, kundennummer text, ort text, plz text, branche_name text)
language sql
stable
as $$
  select id, name, kundennummer, ort, plz, branche_name
  from companies
  where name ilike '%' || p_query || '%' or kundennummer ilike '%' || p_query || '%'
  order by name
  limit 10;
$$;

-- One-shot company brief: core master data, recent feedback (Tier-1 proxy,
-- §4A), current signals, and enrichment incl. reconstructed {claim, quote}
-- pairs from analysis_raw — §10 requires enrichment facts always carry
-- their quote, but company_enrichment.strengths/weaknesses only store the
-- bare claim text (analysis_raw jsonb is where the quote survives).
create or replace function fn_chat_get_company_brief(p_company_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'company', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'kundennummer', c.kundennummer,
        'branche_name', c.branche_name, 'ort', c.ort, 'plz', c.plz,
        'gebiet', c.gebiet, 'brand_focus', c.brand_focus,
        'do_not_contact', c.do_not_contact, 'call_priority', c.call_priority,
        'revenue_prior_year', c.revenue_prior_year,
        'revenue_current_year', c.revenue_current_year,
        'last_contact_date', c.last_contact_date
      )
      from companies c
      where c.id = p_company_id
    ),
    'recent_feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'outcome', f.outcome, 'qty', f.qty, 'value_net', f.value_net,
        'objection', f.objection, 'comment', f.comment, 'created_at', f.created_at,
        'product_name', p.name
      )), '[]'::jsonb)
      from (
        select * from sales_feedback
        where company_id = p_company_id
        order by created_at desc
        limit 8
      ) f
      left join products p on p.id = f.product_id
    ),
    'signals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', s.type, 'score', s.score, 'reason', s.reason, 'tier', s.tier,
        'product_name', p.name
      ) order by s.score desc), '[]'::jsonb)
      from signals s
      left join products p on p.id = s.product_id
      where s.company_id = p_company_id
    ),
    'enrichment', (
      select case when e.id is null then null else jsonb_build_object(
        'places_rating', e.places_rating,
        'places_review_count', e.places_review_count,
        'places_website', e.places_website,
        'strengths', coalesce(e.analysis_raw -> 'strengths', '[]'::jsonb),
        'weaknesses', coalesce(e.analysis_raw -> 'weaknesses', '[]'::jsonb),
        'brand_focus_guess', coalesce(to_jsonb(e.brand_focus_guess), '[]'::jsonb),
        'external_opportunities', coalesce(e.external_opportunities, '[]'::jsonb),
        'verified', e.verified,
        'analyzed_at', e.analyzed_at
      ) end
      from company_enrichment e
      where e.company_id = p_company_id
    )
  ) into result;
  return result;
end;
$$;

create or replace function fn_chat_get_brand_profile(p_brand text)
returns table (category text, note text, weight int)
language sql
stable
as $$
  select category, note, weight
  from brand_consumption_profiles
  where brand ilike '%' || p_brand || '%'
  order by weight desc;
$$;

create or replace function fn_chat_search_products(p_query text, p_category text default null)
returns table (id uuid, sku text, name text, category_name text, pack_content text, description text)
language sql
stable
as $$
  select id, sku, name, category_name, pack_content, description
  from products
  where active
    and (p_category is null or category_name = p_category)
    and (name ilike '%' || p_query || '%' or description ilike '%' || p_query || '%')
  order by name
  limit 10;
$$;

create or replace function fn_chat_search_kb(p_query text, p_collection text default null)
returns table (collection text, doc_title text, heading text, content text)
language sql
stable
as $$
  select d.collection, d.title, c.heading, c.content
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where d.deleted_at is null
    and (p_collection is null or d.collection = p_collection)
    and c.search_vector @@ websearch_to_tsquery('german', p_query)
  order by ts_rank(c.search_vector, websearch_to_tsquery('german', p_query)) desc
  limit 8;
$$;

-- Only 8 objection cards exist (§8/M6) — cheap enough to hand the model the
-- whole list rather than build fuzzy matching on top.
create or replace function fn_chat_list_objection_cards()
returns table (objection text, response_de text, response_bs text, category text)
language sql
stable
as $$
  select objection, response_de, response_bs, category
  from objection_cards
  where deleted_at is null
  order by created_at;
$$;

-- The one write tool (§3.2.5). Always writes as the calling agent — no
-- agent_id parameter exists to spoof, and the underlying insert policy
-- (sales_feedback_insert_own) would reject anything else anyway.
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
declare
  new_id uuid;
begin
  insert into sales_feedback (agent_id, company_id, product_id, outcome, qty, value_net, objection, comment)
  values (auth.uid(), p_company_id, p_product_id, p_outcome, p_qty, p_value_net, p_objection, p_comment)
  returning id into new_id;
  return new_id;
end;
$$;
