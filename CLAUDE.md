# CLAUDE.md — Normfest Sales Assistant (SocialNet Sales Platform, MVP v2.3)

> Single source of truth for architecture, conventions, and scope.
> Claude Code: read fully before writing code. If a requested change contradicts this
> file, flag it — do not silently deviate.
> Changelog v2.3: SOLO build (Anis + Claude Code — no dev team; conventions simplified
> accordingly). Feedback-first data tiers (§4A): agent-logged outcomes are the primary
> truth; invoice/order data is Tier 2 if available. Catalog source is an 800-page PDF
> with 10k+ products → dedicated extraction pipeline (§11.1) that also feeds the KB.
> Customer master = "VIS LIST" file. Visibility default: shared. Focus-list approval:
> Anis. Added brand consumption profiles ("Mercedes focus → more oil") as curated
> mapping + signal type. Build order resequenced: feedback capture ships earliest.
> v2.2: LLM Enrichment (Places + website + review mining) as flagship #3.
> v2.1: KB + Skript, seasonal signals, RFM + standard signal set, Focus→Winner loop;
> Wiedervorlagen removed (old dialer); compliance de-scoped (agreed).

---

## 1. Project overview

**What we are building:** An internal web application for the Normfest outbound telesales
team (~10 agents in Sarajevo selling consumables / Verbrauchsmaterial to German
Kfz-Werkstätten). The app is each agent's **personal sales assistant**:

1. an advanced, interactive customer & product database (VIS-list customers, 10k+ product
   catalog, purchase data where available),
2. a **signal engine** telling each agent what to offer whom and why (§6),
3. an **LLM enrichment layer**: Google Places + website + reviews per company → who they
   are, strengths/weaknesses, brand focus, and concrete product opportunities
   ("dirty-floor review → floor cleaner"; "Mercedes focus → oil consumption") (§9),
4. a **focus-list feedback loop**: management pushes a focus list, agents log outcomes,
   winners emerge, next list generates itself (§7),
5. an internal **knowledge base** (Halilbegović tactics, objection handling, product
   docs from the catalog PDF) + the **call script** as its own menu item (§8),
6. a **conversational AI assistant** grounded in all of the above (§10).

**The data flywheel (core product thesis):** the tool's primary fuel is what agents put
into it. Every logged outcome makes signals, winners, and the assistant smarter. Adoption
is therefore a feature: feedback capture must be effortless (≤10s), visible in agents'
own results, and coached ("koristi tool → tool ti vraća bolje prijedloge").

**What we are NOT building (MVP):**
- ❌ No dialer/telephony (existing dialer stays; `telephony/` adapter stub stays empty).
- ❌ No Wiedervorlagen/tasks (old dialer owns follow-ups).
- ❌ No automated outbound messaging.
- ❌ No ML training — SQL rules + curated mappings + LLM shell under §9.5 guardrails.
- ❌ No multi-tenant platform yet.

**Deployment target:** `https://normfest.social-net.ba` (Vercel custom domain, CNAME in
social-net.ba zone).

**Builder:** Anis solo, with Claude Code. **Users:** ~10 agents, TL Sanin, admin Anis.
UI German labels; assistant mirrors DE/BS.

---

## 2. Goals and success criteria

### 2.1 Primary goals
1. One place per Werkstatt, reachable in <2s from one search box.
2. Evidence-backed suggestions — internal (feedback/orders) AND external (reviews/website/
   brand profile), each with visible source.
3. The flywheel spins: focus list → feedback → winners → next list, minutes of admin work.
4. "Show me you know me" brief before every call.
5. Knowledge + script at fingertips, cited.
6. Trust: every claim cites a record, a quote, or says "keine Daten".

### 2.2 Go-live criteria
- Agents log in (shared visibility); VIS list imported & calibrated; catalog extraction
  ≥90% of products usable (name, category, pack info where present in PDF).
- Feedback capture live and ≤10s; one full focus cycle simulated (≥30 feedback rows →
  winner report + generated draft).
- Signals: every active-status company has ≥1 signal from available tiers; enrichment
  pilot slice done (≥70% ok) with briefs spot-checked by Anis.
- KB ingested incl. script; assistant passes acceptance set (§13.4).
- p95 profile <2s; chat first token <3s.

---

## 3. Architecture

### 3.1 High-level

```
                normfest.social-net.ba  (Next.js App Router, TS, Vercel)
 ┌──────────────┬─────────────────┬────────────────┬────────────────┬───────────────┐
 │ UI pages(RSC)│ /api/chat (SSE) │ /api/import    │ /api/kb-ingest │ /api/enrich   │
 └──────┬───────┴───────┬─────────┴───────┬────────┴──────┬─────────┴──────┬────────┘
        │ supabase-js (anon+JWT, RLS)     │ server-side   │                │
        ▼               ▼                 ▼               ▼                ▼
 ┌─────────────────────────────────────────────────────────────────────────────────┐
 │                     Supabase (EU) — Postgres 15+                                 │
 │ core schema │ signal matviews │ focus/feedback │ kb (FTS+pgvector) │ enrichment  │
 │ chat_log │ pg_cron nightly │ Storage (KB files, catalog PDF, product images)     │
 └─────────────────────────────────────────────────────────────────────────────────┘
 External (server-only): Anthropic API · Google Places API · company websites ·
 embedding provider (KB Phase B)
```

### 3.2 Non-negotiable rules
1. RLS on every table; `fn_company_visible()` supports shared|gebiet modes (default:
   **shared** — one base, one search; per-Gebiet flip is a setting, not a migration).
2. Anon key + user JWT in browser; service-role / Anthropic / Places keys server-only.
3. All LLM & Places calls server-side.
4. Chat tools = `security invoker` RPCs under user JWT.
5. Chat tools read-only EXCEPT `log_sales_feedback` (confirm-before-write UX).
6. **Two fact classes, never silently mixed:** `rule` (SQL over feedback/orders/mappings —
   authoritative) vs `enrichment` (LLM from external sources — quote-backed, labeled,
   agent-verified). Enrichment never overwrites imported master data (fills empty fields
   only, logged, revertible).
7. Provenance everywhere (IDs internally; quotes+URLs externally).
8. Migrations through code. **Single Supabase project for now** (decision, 2026-07-22):
   no separate staging/prod split during solo build — one project (`ethykzocikyirmoztrtq`)
   serves both; re-split into staging+prod is a pre-go-live (M8) decision, not an M0 one.
9. **Cost discipline for AI calls:** every LLM-using feature declares its model tier in
   code (via the provider adapter, never hardcoded model strings in features); bulk jobs
   use the cheapest passing model; per-task token caps; usage counters in admin. New AI
   feature = benchmark cheap tier first, upgrade only on measured failure.
10. Solo-build discipline (replaces team conventions): work in small vertical slices;
   every slice ends green (typecheck+tests) and deployed to staging; commit after every
   working slice; never leave main red. Claude Code sessions start by reading this file.

### 3.3 Tech stack (fixed)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router) + TS strict | RSC default |
| Styling | Tailwind + shadcn/ui | |
| DB | Supabase EU: Postgres, Auth, Storage, pg_cron, pgvector | |
| LLM | **Provider-agnostic via thin `lib/ai/provider.ts` adapter.** Route by task, cheapest model that passes quality bar: bulk extraction/distill (catalog PDF, website text, KB cleanup) → cheapest capable tier of ANY provider (Anthropic Haiku, OpenAI mini-tier, Gemini Flash — benchmark on 10 real pages, pick winner on cost×accuracy); chat assistant + enrichment ANALYZE (quote fidelity, tool use) → stronger tier (Sonnet-class), downgrade only if acceptance set still passes. Cost leitmotiv: cheapest wins whenever output quality is measurably equal. | |
| External | Google Places (Text Search + Details incl. ≤5 reviews); server-side website fetch | |
| KB search | German FTS first; pgvector hybrid Phase B | |
| Data | supabase-js v2 + generated types; zod everywhere | |
| Files | SheetJS (VIS list, exports); PDF text via `pdftotext` CLI + LLM for catalog & KB; PDF page-to-image rendering via `pdfjs-dist` + `@napi-rs/canvas` (added 2026-07-25 for catalog photo crops - no poppler render tools/Python available in this environment) | |
| Hosting | Vercel + custom domain | |
| CI | GitHub Actions: typecheck, lint, vitest, migration dry-run | |
| PM | pnpm | |

### 3.4 Repository layout — as v2.2, plus `lib/catalog-ingest/` (PDF extraction pipeline).

---

## 4A. Data reality & tiers (governs the whole signal engine)

**Tier 1 — always present (the flywheel):**
- `sales_feedback` (agent-logged outcomes: sold/interested/rejected/not_relevant + qty +
  value + objection + comment) — primary truth for winners AND, in absence of Tier 2,
  the proxy for purchase behavior.
- VIS-list master data, catalog, curated mappings (product_relations,
  brand_consumption_profiles), enrichment.

**Tier 2 — if/when available (Anis checking invoice access):**
- Invoice/order-level history (`orders`/`order_items`). Unlocks: replenishment cycles,
  RFM, co-purchase mining, declining volume, basket comparison, first-order follow-up,
  and the feedback-vs-reality discrepancy report.

**Design consequences:**
1. Every signal type declares its tier (see §6 table). Tier-2 signals simply don't fire
   until data exists — no errors, no fake numbers.
2. `sales_feedback.outcome='sold'` (with qty/value) is written into a lightweight
   `feedback_sales` view treated as a weak purchase record: enough for
   feedback-replenishment (§6.2b), winner stats, and brand/category affinity — clearly
   separated from invoice-grade data in all reporting (label "laut Agent-Feedback").
3. If Tier 2 arrives as PDFs (invoices), a dedicated invoice-parse import is a
   post-MVP milestone (§14.2) — MVP imports Tier 2 only from tabular exports (Excel/CSV).
4. Import pipeline and schema are Tier-2-ready from day 1; nothing needs remodeling when
   the data shows up.

---

## 4. Data model

Conventions: uuid PKs, created_at/updated_at, soft-delete on companies/contacts/notes/
kb_documents; FKs indexed; snake_case.

### 4.1 Identity, visibility & settings — as v2.2, with:
```
-- settings seeded keys (delta):
--  'visibility_mode' : "shared"   (DEFAULT per decision; 'gebiet' switchable)
--  'brand_profile_weights', 'catalog_ingest' : {"batch_pages":10}
```

### 4.2 Companies & contacts — as v2.2 (VIS list is the master source; column mapping
calibrated on first import against the real file; `gebiet` mandatory; Kundennummer +
phone expected per Anis).

### 4.3 Products, relations & brand profiles

`products` and `product_relations` as v2.2, plus catalog-PDF specifics:

```sql
-- products additions:
--   source_page int          -- page in catalog PDF (provenance + KB link)
--   image_path text          -- Supabase Storage path if extracted (nice-to-have)
--   tech_specs jsonb         -- key/value specs extracted from PDF
--   extraction_confidence numeric(3,2)  -- 0–1 from ingest QA (§11.1)

create table brand_consumption_profiles (
  id uuid primary key default gen_random_uuid(),
  brand text not null,                    -- 'Mercedes','VW','BMW','Nutzfahrzeuge',…
  category text not null,                 -- product category with elevated consumption
  note text not null,                     -- why (shown to agents): 'MB-Motoren: höherer Ölverbrauch …'
  weight int not null default 3 check (weight between 1 and 5),
  unique (brand, category)
);
```
Seeded in a 1–2h workshop (Anis + Sanin + top agent); extended over time. Deterministic
mapping — the AI may *detect* a company's brand focus (enrichment), but what that focus
*implies* comes from this curated table, not from model imagination.

### 4.4 Purchase history — `orders`/`order_items` as v2.2 (Tier 2; dormant until data).

### 4.5 Signals & RFM — as v2.2 (`origin rule|enrichment`, `verified` status,
dedup index, company_rfm) with new type `brand_profile_match` added to the CHECK list.

### 4.6 Enrichment tables — as v2.2 (`company_enrichment` incl. brand_focus_guess,
`enrichment_jobs`, ambiguous queue).

### 4.7 Focus & feedback — as v2.2, plus:
```sql
create or replace view feedback_sales as
  select agent_id, company_id, product_id, qty, value_net, created_at
  from sales_feedback where outcome = 'sold';
```

**Product focus lists (added 2026-07-23, Anis):** a focus list is primarily a list of
**products** to push this cycle ("šta gurati ove sedmice") — the company list (§4.7
`focus_list_items`, M2) is useful but secondary. `focus_list_products` (focus_list_id,
product_id, note) is a sibling table, same shared-read/admin-write RLS pattern. The
Fokus page shows the product list first, each with a running "N× verkauft" count (from
`sales_feedback` where `product_id` matches and `created_at >= focus_lists.created_at`)
and an inline "Verkauft eintragen" quick-entry (company picker + qty/value →
`sales_feedback` insert with `outcome='sold'`) — this is how winners get identified: no
separate report yet, the count is visible in place. `focus_lists.active` is now enforced
unique at the DB level (`idx_focus_lists_single_active`, added same day after finding
nothing previously stopped two lists being active at once).

**Feedback self-correction (added 2026-08-03, Anis):** the original §4.7 design was an
immutable log ("corrections go through the admin/service-role path if ever needed, not
a self-serve edit") — reversed on Anis's explicit ask: an agent must be able to fix or
delete their own mistaken feedback entries (wrong outcome/qty/value/objection, or a
duplicate). Not exposed as a plain RLS update/delete policy, because
`fn_log_sales_feedback` has a real side effect on `outcome='sold'` rows (increments
`agent_daily_performance.revenue`/`sales_count` for that day, which feeds the Team
Dashboard/leaderboard/bonus) — a raw table-level update/delete would silently desync
that side effect from the corrected/removed row. `fn_update_sales_feedback`/
`fn_delete_sales_feedback` (security definer, `agent_id = auth.uid() OR fn_is_admin()`
check inside) keep the two tables in sync: editing or deleting a 'sold' row always
reverses its old contribution on the row's own date (not today) and applies the new one.
UI: `components/feedback-history-item.tsx` (Pencil/Trash icons, shown only on the
caller's own rows or to admin) on the Feedback-Verlauf list, `/firmen/[id]`. Verified
live end-to-end with real throwaway accounts (not just the RPCs in isolation): a
non-owner agent is correctly blocked from editing/deleting another agent's row; the
owner's edit (100€→50€) correctly nets `agent_daily_performance.revenue` from 100 to 50
and leaves `sales_count` unchanged (old contribution subtracted, new one added); delete
correctly zeroes both back out and removes the row - then the same flow re-verified
through the actual UI (edit form pre-fills, saves, and the row disappears on delete).

### 4.8 KB & script / 4.9 chat, imports, audit / 4.10 RLS — as v2.2. Focus-list draft
approval: **admin (Anis)**.

### 4.11 Agents & performance (added 2026-07-23, out-of-sequence addition —
Anis wants individual agent sales signals ahead of schedule)
```sql
-- reference dimension (name <-> Gebiet code), not login accounts; seeded
-- from companies.gebiet_agent_name. profiles will get its own per-agent
-- rows at M2+; agents may fold into profiles then.
create table agents (id uuid pk, full_name text, gebiet text unique, active boolean);

-- one row per agent per day, imported from the monthly "Team Dashboard"
-- Excel trackers (input/Team Dashboard/*.xlsx — recurring, new file each
-- month) via scripts/import-team-dashboard.mjs.
create table agent_daily_performance (
  id uuid pk, agent_id uuid references agents,
  date date, revenue numeric, sales_count int, calls_count int,
  conversion_rate numeric, source_file text,
  unique (agent_id, date)
);
```
Admin-only RLS (`fn_is_admin()`) on both — this is HR-adjacent performance
data, not for agents to see each other's numbers. Surfaced at §5 "Team"
admin screen. Intended future use: per-agent signal weighting (who's
converting well on what) once the signal engine (M4) exists — not wired up
yet, this milestone is just capture + a read-only dashboard.

---

## 5. Screens — as v2.2 (menu: Dashboard · Firmen · Katalog · Fokus · Wissen · Skript ·
Assistent · Admin), with:
- Katalog product page adds: PDF page reference link, tech specs table, image if present.
- Fokus (added 2026-07-23): products in the active list first (primary, with live
  "N× verkauft" count + quick sell-entry), companies second (secondary, optional).
- Admin adds: catalog ingest panel (upload PDF, batch progress, QA queue §11.1).
- Dashboard adds a small "Flywheel" widget: team feedback count this week (adoption
  visibility — social proof).
- **Team** (admin-only, §4.11): per-agent daily/monthly Umsatz, Sales, Anrufe, CR —
  ranked by revenue, one card per imported month.

**Pre-demo UX/QA pass (2026-07-24), Anis: "sutra inhouse mini demo, frontend malo
utegnemo".** Went through his punch-list top to bottom same day:
- **Nav rebuilt as a left sidebar** (`components/app-sidebar.tsx`, replaces the old
  horizontal top bar): Dashboard/Firmen/Katalog/Fokus/Wissen/Skript/Assistent always
  visible; admin section below with Team as its own item and a collapsible **Settings**
  submenu (Enrichment + VIS Import) — designed to grow as more admin-only screens show up.
  Feedback dropped from the nav entirely (still reachable from the company profile, per
  Anis — that was always the primary entry point anyway).
- **Global design pass**: added a `success` semantic color token (green) alongside the
  existing `warning`/`destructive`, plus a `success` Badge variant — used for
  qualified/positive states (sold feedback, opportunity-type signals) so the UI isn't
  all one accent color. New `StatTile` component (colored left bar + bold number) for
  KPI rows. Applied consistently: Dashboard, Firmenprofil section icons + revenue
  up/down coloring, Skript's warning-tinted objection cards, Fokus's success badge on
  sold-count.
- **Dashboard**: was "Team-Ziel → Empfehlungen → Rangliste" with little else. Added a
  4-tile KPI row up top (Team-Umsatz, Feedback diese Woche, Empfehlungen offen, **Nicht
  kontaktiert (2+ Monate)** — real count from `companies.last_contact_date`, currently
  ~2,987 of ~13.5k active companies, which is itself a real, honest signal of how early
  the flywheel still is). Leaderboard's #1 gets a gold-tinted rank badge. Signal badges
  in Top-Empfehlungen now color-coded via a new `signalTypeVariant()` helper
  (`lib/signals.ts`): risk types (`revenue_trend_risk`, `declining_volume`,
  `dormant_winback`) render `warning`, opportunity types render `success`.
  **Anis's open question resolved + shipped same night** (delete/dismiss
  recommendations vs. wait for next VIS list): recommended a dismiss action as a
  fast-follow, then built it once Anis said to keep going through the list. New
  `signal_dismissals` table (migration `20260724040000_signal_dismissals.sql`) keyed
  the same way as `signals`' own dedup index (company, type, product-or-zero-uuid);
  `fn_refresh_signals()` now excludes dismissed pairs in every insert block (also
  fixed em dashes in the reason strings it generates — missed in the tsx-only sweep,
  since these render straight into the Empfehlungen UI). A single
  `fn_dismiss_signal(company_id, type, product_id)` RPC
  (`20260724050000_fn_dismiss_signal.sql`) does both atomically: records the
  dismissal AND deletes the live `signals` row immediately (security definer, since
  `signals` itself is admin-only to write — an agent dismissing something they
  handled shouldn't have to wait for the next admin-triggered refresh to see it
  gone). New `SignalDismissButton` client component wired into both the Dashboard's
  Top-Empfehlungen and the Firmenprofil's Empfehlungen list. Verified live end-to-end:
  dismissed a real `revenue_trend_risk` signal through the actual UI, confirmed it
  disappeared immediately and the "Empfehlungen offen" counter ticked down, then
  re-ran `fn_refresh_signals()` for real and confirmed it did not come back.
- **Firmen search — real bug fixed.** `gebiet` was missing from the `.or()` search
  filter entirely (confirmed: searching a real Gebiet code returned 0 rows). Added it.
  Kundennummer search was tested directly (admin client, RLS-scoped anon client, and
  live in the running app) and worked correctly every time — couldn't reproduce that
  half of the report; flagged back to Anis in case it recurs with a specific number.
- **Firmenprofil**: icons on each section's CardTitle (Stammdaten/Segmentierung/
  Umsatz/Aktivität), a colored left border on the header card (orange if
  `call_priority`), revenue Plus/Minus now shows a colored up/down arrow, feedback
  outcome badges use the new success/destructive variants instead of generic
  secondary/muted.
- **Fokus — delete/edit shipped.** Active list: rename (inline pencil) and delete
  (trash, with confirm) on the list itself; an X to remove any single company/product
  row without touching the rest of the list. New **"Alle Fokuslisten"** admin card
  lists every list (not just the active one) with an "Aktivieren" action (deactivates
  the current active list first, respecting `idx_focus_lists_single_active`) and the
  same rename/delete controls. All three new client components
  (`focus-list-manage.tsx`, `focus-item-remove-button.tsx`,
  `focus-list-activate-button.tsx`) write directly via the RLS-scoped client — no new
  RPCs needed, `focus_lists`/`focus_list_items`/`focus_list_products` already had
  admin-only `for all` policies. Verified live: created a throwaway list through the
  real UI's delete button, confirmed it was actually gone in the DB.
- **Skript redesigned.** Objection cards get a warning-tinted left border + separate
  BS/DE sub-cards instead of a flat two-column split. The full-guide chunks were
  rendering as one dense `whitespace-pre-line` blob per section — replaced with a
  `ChunkContent` component (`app/(app)/skript/page.tsx`) that splits on newlines into
  real paragraphs, detects `WORD: rest of sentence` lead-ins (bolds the lead-in — a
  real pattern in the source content, e.g. "PRIPREMA: Pregledaj listu poziva...") and
  list-like lines (`-`/`•`/`1.` prefixes) for a bullet treatment. Section headings keep
  their own source numbering (`1.`, `3.1`, `Faza 2:` etc. — already meaningful) rather
  than adding a second, conflicting index.
- **Assistant — always-on floating panel added** (`components/floating-assistant.tsx`),
  per Anis: "ili oboje" (both the full `/assistent` page and a Notion-style
  quick-access widget). Bottom-right circular button on every authenticated page except
  `/assistent` itself (avoids a duplicate); expands into the same `ChatAssistant`
  component the full page uses — zero duplicated chat logic. Auto-detects company
  context when parked on a `/firmen/[id]` page (client-side lookup by id from the
  pathname, same "Kontext: {name}" injection the page version already had) so a quick
  question from a company profile doesn't need the "Im Assistenten fragen" link.
  Verified live: opens/closes correctly, context injection confirmed on a real company
  ("Kontext: Autohandel \"An der Schmiede\""), correctly absent on `/assistent`.
- **All em dashes (—) replaced with plain hyphens (-)** across every user-facing string
  in `app/` and `components/` (left source-code comments alone — not user-visible, out
  of scope for a "frontend" pass).
- **Katalog / Enrichment**: left as-is this pass, per explicit direction — Katalog
  "enrichment to final form" is the already-tracked webshop-rebuild backlog item
  (§14 item 12), and Enrichment is an admin-only utility screen agents never see, not
  worth design time before a sales-facing demo.

**Live feedback after the demo prep (2026-07-24), Anis: "Es funktioniert! ... perfekt"**
— confirmed the assistant now answers only from real grounded data, no hallucinated
info. Three small follow-ups from the same message, all shipped same day:
- **Firmenprofil font sizes bumped** — field values `text-sm`→`text-base`, labels
  `text-xs`→`text-sm`, plus the Firmenbrief's Stärken/Schwächen/Externe Chancen lists
  and the Empfehlungen/Feedback-Verlauf list rows. Secondary/meta text (subtitles,
  empty states) deliberately left smaller — the ask was "the important stuff is hard to
  read," not "make everything bigger."
- **Fokus redesigned**: active list header now its own colored (primary-accent) card
  with an "Aktiv" badge instead of a plain `CardTitle`; section headers get icons
  (`Package`/`Building2`/`ListChecks`); each product category inside "Katalog des
  Fokus" gets its own tinted background block with a left accent bar and a count badge
  instead of a plain uppercase label; "Alle Fokuslisten" rows get a left accent bar
  (green when active) instead of a flat divided list.
- **Team Dashboard — real gap found and closed: no bonus was shown per agent
  anywhere except "today."** Bonus is fundamentally a daily, team-wide calculation
  (each day's budget + each agent's share depends on the WHOLE team's revenue that
  day), so showing it per agent per day/month required computing it across every
  agent for every date, not just the one agent being viewed. Added
  `computeBonusByDate()` to `lib/team/bonus.ts` (groups daily rows by date, runs the
  existing `computeDailyBonus()` per day, returns date→agentId→bonusKm). Wired in
  two places: `/admin/team`'s monthly tables now show a Bonus (KM) column per agent
  and a team-month total; `/admin/team/[agentId]` now shows a monthly bonus total in
  the stats line and a real per-day bonus in both the calendar's day-detail expand and
  the full day-list table (`components/team/month-calendar.tsx`'s `DayEntry` gained a
  `bonusKm` field). Verified with real data: per-agent monthly totals match between
  the overview and per-agent pages, and clicking two different real days on the
  calendar showed genuinely different bonus amounts (9,22 KM on the one day it was
  actually earned, "-" on a neighboring day with revenue but no bonus) — confirming
  it's real per-day data, not a stale total repeated everywhere.

---

## 6. Signal engine (flagship #1) — with tier awareness

`score = base(type_weight) × strength × rfm_or_segment_multiplier` (RFM only when Tier 2
exists; otherwise a feedback-recency multiplier). Enrichment-origin discounted until
`verified`. `do_not_contact` excluded everywhere.

| Type | Tier | Trigger |
|---|---|---|
| `focus_list_push` | 1 | active list × fitting companies (category affinity from feedback or Tier 2) |
| `feedback_replenishment` | 1 | §6.2b: repeated 'sold' of same product → cycle estimate from feedback dates |
| `brand_profile_match` | 1 | company brand_focus (imported or verified enrichment) × brand_consumption_profiles → category not yet sold/bought |
| `seasonal_push` | 1 | product.season × season window × (category affinity: feedback, Tier 2, or brand profile) |
| `new_product_match` | 1 | launched_at <90d × company category affinity |
| `external_opportunity` | 1 (enrichment) | §9 review/website mining, quote-backed |
| `category_gap` | 1* | peers-by-branche buy category, company shows no affinity (*needs enough peer data: Tier 2 or dense feedback) |
| `replenishment_due` | 2 | invoice-grade cycles (≥3 purchases) |
| `dormant_winback` | 2 | was active, 12 mo silent |
| `cross_sell` | 1/2 | curated + winner_derived (Tier 1); mined co-purchase lift (Tier 2) |
| `upsell_pack` | 1/2 | repeated small-pack ('sold' feedback or invoices) × pack_rank ladder |
| `declining_volume` | 2 | rolling 90d revenue drop |
| `revenue_trend_risk` | 1 | **added M4 (2026-07-23):** annual `revenue_current_year` vs `revenue_prior_year` from the VIS import down >15% (and current year > 0, to exclude already-fully-dormant companies — see caveat below) — a labeled proxy for `declining_volume`'s concept using data that already exists, not a Tier-2 replacement |
| `first_order_followup` | 2 | first invoice 14–45d ago, no second |
| `basket_expansion` | 2 | avg order value vs peer median |

**§6.2b feedback_replenishment:** for (company, product) with ≥3 'sold' feedback entries,
cycle = avg gap of feedback dates; overdue at ×1.25 — same math as invoice version,
weaker source, labeled "laut Feedback". Auto-superseded by `replenishment_due` when
Tier 2 covers the pair.

**M4 build note (2026-07-23) — implemented vs. deferred:** `fn_refresh_signals()`
(`supabase/migrations/20260723190000_fn_refresh_signals.sql`, admin-triggerable via the
"Empfehlungen aktualisieren" button on Dashboard, not yet on a pg_cron schedule) computes
real SQL for `focus_list_push`, `revenue_trend_risk`, `feedback_replenishment`,
`seasonal_push`, `new_product_match`, and `cross_sell` (curated only). Types NOT
implemented yet, by design (data prerequisite missing, not a bug — same "don't fire
without data" principle as §4A):
- `brand_profile_match` — needs `companies.brand_focus`, part of M5 enrichment (§4.6),
  column doesn't exist yet. Also needs the brand workshop (§14 item 5, not scheduled).
- `replenishment_due`, `dormant_winback`, `declining_volume`, `first_order_followup`,
  `basket_expansion`, `category_gap` — Tier 2, `orders`/`order_items` doesn't exist yet.
- `external_opportunity` — M5 enrichment output.
- `upsell_pack`, `cross_sell` (winner_derived) — needs pack_rank ladder / focus-loop
  winner stats, neither meaningful yet with real feedback volume near zero (no agents
  onboarded in production yet).

**`revenue_trend_risk` caveat:** first run fired 1000 signals; 621 of those were
companies at `revenue_current_year = 0` (already fully dormant this year, not "at risk"
— conflating the two would mislead agents), so the query now requires
`revenue_current_year > 0` too. Still ~1000 companies (~7% of the active book) flag at
score 5 — worth a sanity pass with Anis before this is treated as fully tuned.

**Enrichment-derived affinity, reducing reliance on feedback (added 2026-07-24, Anis:
"dont rely so much on agent logs a sale, try to make as much as possible to work out of
the box... later on added info ofc helps"):** `seasonal_push`, `new_product_match`, and
`cross_sell` all gated their category/product affinity purely on `sales_feedback`
('sold'/'interested') — with real feedback at 2 rows total, all three were effectively
dead regardless of how good the enrichment pipeline's output was. Checked before building
anything: 1,384 distinct (company, catalog_category) affinity pairs already exist from M5
enrichment (`company_enrichment.external_opportunities[].catalog_category`, derived from
Google reviews/website/name — zero agent action needed) across 345 companies, vs. 2 from
feedback. Migration `20260723260000_fn_refresh_signals_enrichment_affinity.sql` adds
enrichment as a second, parallel affinity source (UNIONed with feedback, not replacing
it) for all three types, plus a second `cross_sell` trigger path (an enrichment-matched
real catalog product on `external_opportunities[].matched_products`, alongside the
existing "already sold the anchor product" trigger). Provenance kept honest per §3.2.6
("never silently mixed"): enrichment-sourced rows get `origin='enrichment'`, a discounted
score, and reason text that says "laut KI-Anreicherung, nicht verifiziert" — when both
sources agree for the same (company, product), the feedback-sourced row wins via explicit
priority ordering, never silently blended. `feedback_replenishment` deliberately untouched
— it's about real repurchase *cycles* (avg gap between actual sales), which enrichment has
no substitute for.

Verified with real data, not just a passing function call: `seasonal_push`/
`new_product_match` still return 0 rows after this fix — checked directly and confirmed
it's a *different*, pre-existing gap (`products.season`/`launched_at` are 0% populated,
zero rows in either column — the workshop-seed prerequisite noted above, unrelated to
this affinity change).

**`products.season` filled (2026-07-25, Anis: "products.season, see if you can do own
research"):** `seasonal_push` was permanently dead regardless of feedback/enrichment
affinity volume since `season` was 0% populated. Filled via
`scripts/backfill-product-season.mjs` — deliberately narrow, only genuinely
well-established, generic automotive seasonality (never a brand/model-specific claim):
tire changeover (entire `Reifenmontage` category, 142 products, season `3,4,9,10,11` —
spring + autumn changeover windows), antifreeze/de-icer (name-keyword match, 9 products,
`9,10,11,12,1,2`), AC service (name+subcategory match, 63 products, `3,4,5,6,7`), and
cold-weather battery failure (name-keyword match, 14 products, `10,11,12,1,2`) — 228
products total. A wiper-blade rule was drafted and dropped before running: the catalog
has zero real wiper-blade products, and its only keyword hit was a wiper-**arm-removal
tool**, not a genuinely seasonal item. Two rules (Frostschutz, Batterie) were narrowed to
name-only matching after a sanity check found their natural subcategory buckets mix in
unrelated products (a leak-detection spray sharing a "Vereiserspray" bucket; a generic
distribution box sharing a "Batterieklemmen" bucket) — kept to name-only to avoid tagging
those. Verified end-to-end, not just inserted: re-ran `fn_refresh_signals()` afterward —
`seasonal_push` went from 0 to **2,835 real signal rows** (July falls inside the AC-service
window, so `Klima`-category affinity fired immediately). `new_product_match` remains at 0
— separate, still-unaddressed gap (`products.launched_at` is 0% populated; unlike season,
there's no generic-knowledge way to backfill real launch dates without a data source). `cross_sell` verified working end-to-end via a throwaway test:
temporarily attached a matched-product opportunity to a real company's enrichment row,
confirmed the signal fired correctly (`origin='enrichment'`, discounted score, correctly
labeled reason), then reverted the test data and re-ran the refresh to restore the true
state. The 5 real seeded pairs (§7) don't yet overlap with any of the 492 companies'
actual enrichment matches, so real `cross_sell` rows are still 0 today — the mechanism is
proven, it just needs either more seeded pairs or more enrichment coverage to produce
visible rows, not more feedback.

Reason templates: as v2.1/2.2, plus
`brand_profile_match`: "Fokus auf {Marke} — {Kategorie} mit erhöhtem Verbrauch
({Begründung aus Profil}). Noch nicht im Sortiment des Kunden."

---

## 7. Focus loop — as v2.2 (≤10s feedback UX; winner thresholds in settings; objection
clustering; winner_derived relations; generated drafts **approved by Anis**; "Extern
bestätigt" column; discrepancy report activates only with Tier 2). Product lists are the
primary Fokus mechanism (§4.7, added 2026-07-23).

**Winner stats + generated draft (added 2026-07-23):** `product_winner_stats` view
aggregates sold_count/qty/value per product from `sales_feedback`; a product qualifies
once `sold_count >= settings.focus_winner_min_sold` (starts at 1, admin-adjustable —
real feedback volume is still ~2 rows total). `/fokus/neu` shows qualifying winners with
an "Übernehmen" button that adds them into the new list's product picker with a
"Winner — Nx verkauft" note; the admin's normal review-and-submit on that same form **is**
the approval step — no separate draft/approval state was built, since the existing
create flow already requires a human to look before a list goes active. The
winner-derived `cross_sell` relation (product_relations origin='winner_derived') is
still not built — needs enough repeat-winner history to derive a meaningful pairing,
which doesn't exist yet.

---

## 8. Knowledge base & script — as v2.1/2.2. Additional source: the catalog PDF's
product texts flow into `produkte` collection chunks **linked to product records**
(chunk metadata carries sku) so the assistant answers tech questions with catalog
citations. Script = the existing single file (bilingual Agent Sales Guide lineage),
collection `skript`, own menu.

**M6 status (2026-07-23):** schema shipped (`kb_documents`, `kb_chunks` with generated
German-FTS `search_vector`, `objection_cards`), all admin-write/shared-read RLS. Ingested
so far: the Agent Sales Guide (`2. Normfest - Agent - Sales Priručnik & Skripta.docx`) →
collection `skript`, 21 heading-chunked sections + 8 objection_cards (objection + BS/DE
response pairs), extracted via `scripts/ingest-kb.mjs` (docx→XML text extraction, no
pandoc/soffice dependency — see script header). `/skript` page live (objection cards +
full guide with TOC anchors).

**Wissen seed content (added 2026-07-23):** rather than leave Wissen empty until the
Operativni Priručnik question resolves, Anis asked for a first non-empty pass aimed at
new-agent onboarding: general Normfest company facts, a telesales-is-relationship-not-
just-hard-selling framing, and the tool landscape (Speedy CRM, the existing dialer, this
app). Seeded via `scripts/seed-wissen.mjs` (hand-written content, not extracted from a
source doc) — 3 documents / 9 chunks: "Normfest — Unternehmensüberblick" (summarized,
not copied, from normfest.de/en: founded 1948, Velbert HQ, 26,000+ products, Kfz/Caravan/
Landtechnik + "Dress and Safe" workwear brand, European subsidiaries incl. Bosnia,
sustainability/PV-system fact, digital services), "Telesales bei Normfest — Beziehung
statt nur Verkauf" (relationship-building framing, points to Skript for the actual call
structure/objection handling rather than duplicating it), "Werkzeuge im Arbeitsalltag"
(Speedy = existing CRM/lead DB, the dialer stays the calling system, this app's role as
prep/knowledge companion + the feedback-flywheel pitch). Deliberately excludes any
commission/bonus/KPI-scorecard specifics — same HR-adjacent-sensitivity reasoning as the
Operativni-Priručnik skip below. `/wissen` page now also renders a default browse view
(grouped by document) when there's no search query, not just search results.
**Resolved (2026-07-24):** the Priručnik mixes genuine sales methodology with real agent
earnings/MBTI-profiles/personnel lists (same HR-adjacent sensitivity as
`agent_daily_performance`, §4.11); Anis skipped ingesting it entirely rather than have it
manually curated ("Preskoci ovaj dokument za sad"). Anis has since clarified the document
stays out of the app and Wissen for good, not pending a later curation pass — it serves as
background context for Claude Code sessions only ("više tebi kao intel, a ne za app i
wissen, to smo riješili drukčije").

**Visual redesign + new "how to use this tool" document (2026-07-26), Anis: "graphicaly
update the Wissen part like we did for the script and focus... if you happen to find
some knowledge for example how to use the app could be added as a separate part."**
`/wissen` reused the exact same `ChunkContent` component already proven on `/skript`
(paragraph spacing instead of one dense blob, bullet detection, "WORD: rest" lead-in
bolding) instead of its own separate rendering, so both knowledge areas read
consistently. Each document in the browse view now gets an icon in its `CardTitle`, a
chunk-count badge, and each chunk section gets the same `border-l-4 border-l-primary/30`
accent already used on Skript's full-guide sections. Added a document-level TOC nav
(anchor links) at the top, matching Skript's section TOC, since Wissen now has 4
documents instead of 3. Search results get the same accent-bordered treatment instead of
a plain `Card`.

New document **"So nutzt du dieses Tool"** (8 chunks: Dashboard, Firmen, Katalog, Fokus,
Feedback erfassen, Empfehlungen, Assistent, Wissen & Skript) — a genuine screen-by-screen
walkthrough of the app itself, distinct from "Werkzeuge im Arbeitsalltag"'s one brief
paragraph placing the tool next to Speedy/the dialer. Every claim describes a real,
currently-shipped screen/behavior, not anything planned-but-not-built. `scripts/seed-wissen.mjs`
was made idempotent (checks for an existing title before inserting) so it's now safely
re-runnable — running it again correctly skipped the 3 pre-existing documents and
inserted only the new one. Verified live end-to-end (throwaway test account): browse
view renders all 4 documents with the new TOC, search correctly finds and highlights a
chunk from the new document with its document badge.

---

## 9. LLM Enrichment ("Show me you know me", flagship #3) — as v2.2 (pipeline, worked
floor-cleaner example as canonical test, anti-hallucination guardrails, batching/cost,
≤5-review honesty), plus:
- ANALYZE also outputs `brand_focus_guess[]`; on agent/admin verification it is written
  to `companies.brand_focus` (if empty) and immediately powers `brand_profile_match`
  signals via the curated table — the "Mercedes → oil" chain is: AI detects focus →
  human verifies → deterministic mapping fires.

**Same-address auto-merge for the ambiguous queue (2026-07-25).** Anis, while working
through the 75-company ambiguous queue: several "ambiguous" pairs are actually the same
real business with two Google Business Profiles at the identical address (live example:
"Krebs & Riedel Schleifscheibenfabrik" — its main profile plus a separate profile for the
EV charging station on the same premises; both carry real reviews). `pickResolution()`
(`lib/enrichment/places.mjs`) previously only auto-resolved via exact-count (1 result) or
PLZ-uniqueness; extended it to also auto-resolve when every candidate shares the same
street+house-number+postal-code (ignoring a district-name suffix Google sometimes adds to
only one listing, e.g. "Bad Karlshafen" vs "Bad Karlshafen-Diemelhöhe" for the literal same
building) — same address is high-confidence "same physical place", not a guess. New shared
`mergeCandidates()` combines the review sets from all matched listings (every quote stays
real and individually dated, tagged with `source_listing` for traceability — never blended
into a fabricated summary quote), picks the higher-review-count listing as the primary
contact-info source, fills phone/website from the other only if the primary lacks it.

The same picker UI (`components/ambiguous-candidate-picker.tsx`) also gained a manual
version of this for the genuinely-ambiguous remainder — Anis: sometimes 2 candidates both
look right with real reviews on each, and forcing a single pick throws away real data.
Checkboxes + an "Ausgewählte zusammenführen" button let the admin merge any subset by hand
using the same `mergeCandidates()` function, so the automatic and manual paths can never
drift apart.

`scripts/rescan-ambiguous-same-address.mjs` re-checked all 74 then-current ambiguous rows
against the new rule using only already-stored `places_candidates` (zero new Places API
calls, free) — **19 of 74 (26%) were genuinely the same address and auto-merged** (mostly
multi-brand dealerships and sister listings at one location, e.g. "Autohaus Geiger" with
separate Peugeot/Fiat sub-listings), leaving 55 as real, different-address ambiguity for
manual review. Safely re-runnable any time (only touches rows still flagged ambiguous).

---

## 10. AI assistant — as v2.2 (tools incl. `get_company_brief`, `request_enrichment`,
`log_sales_feedback` with confirm; grounding: rule facts from tools only, enrichment
facts always attributed with quote; objection flow via cards; persona German/BS;
company-context injection). New tool: `get_brand_profile(brand)` → curated consumption
categories + notes (for pitch preparation).

**M7 status (2026-07-23):** shipped. `lib/ai/provider.mjs` is the §3.2.9 cost-tier
adapter (`bulk`/`analyze`/`chat` → model id) — `lib/enrichment/analyze.mjs` and
`scripts/extract-catalog.mjs` now read their model through it instead of a hardcoded
string, closing a gap from M3/M5. Schema: `chat_log` (private per agent, admin can read
all for cost/QA oversight — deliberately NOT shared-visibility like `sales_feedback`,
since a chat transcript is closer to a personal notebook) + 7 `security invoker` RPC
tools (`fn_chat_search_companies`, `fn_chat_get_company_brief`, `fn_chat_get_brand_profile`,
`fn_chat_search_products`, `fn_chat_search_kb`, `fn_chat_list_objection_cards`,
`fn_chat_log_sales_feedback`) — none is `security definer`, so RLS applies exactly as it
would to a direct query under the caller's JWT (§3.2.4). `fn_chat_get_company_brief`
reconstructs {claim, quote} pairs from `company_enrichment.analysis_raw` (the plain
`strengths`/`weaknesses` text[] columns drop the quote at storage time) so the assistant
can satisfy the "enrichment facts always carry their quote" rule.

`/api/chat` (SSE, manual tool loop, ≤6 round-trips) runs under the user's own session —
not the admin client — for exactly this reason. Read tools execute inline; `log_sales_feedback`
and `request_enrichment` never execute inside the route (§3.2.5) — they only emit a
`pending_action` SSE event, and the model is instructed never to claim the action already
happened. `/api/chat/confirm` executes the confirmed `log_sales_feedback` via the RPC
under the user's session (zod-validated payload); confirming `request_enrichment` instead
calls the existing admin-gated `/api/enrich` route directly from the client — no second
enrichment code path was built. Per-agent daily token budget (`chat_daily_token_budget`
setting, default 200k) checked before every call, tracked via `chat_log.input_tokens`/
`output_tokens`. `/assistent` page + nav item; company-context injection via
`?company=<id>` (a "Im Assistenten fragen" link now sits on the Firmenprofil header) —
the server component resolves the id to `{id, name}` and the client always sends it back
to `/api/chat` so the assistant can skip a search round-trip when the question is clearly
about that company.

**Scope decisions (flagged, not silent deviations):** (1) conversation history is held
client-side only for v1 — no session list/resume UI; `chat_log` exists for audit/budget,
not as the source of truth the client reloads from. Reload = fresh conversation. (2) The
confirm-gate was extended from `log_sales_feedback` (the only tool §3.2.5 names) to also
cover `request_enrichment`, since it's real-cost + write and the same UX applies naturally.
(3) If the model proposes two confirm-only tool calls in the same turn, only the last
`pending_action` survives (the variable is overwritten) — accepted as a rare edge case for
v1, not handled with an array of pending actions.

**Acceptance-set run (2026-07-23, credit restored same day):** the tool-loop logic was
extracted into `lib/chat/core.mjs` (shared by `/api/chat` and a new
`scripts/chat-acceptance-test.mjs`) so the CLI test exercises the exact production code
path via a throwaway test-agent Supabase session, not a re-implementation.
`chat-acceptance-test.mjs` runs a self-drafted ~24-question DE/BS set (§13.4 doesn't
specify the literal questions, only the categories) covering company briefs, the
tier-honesty trap, quote-attributed enrichment facts, the canonical brand-profile
question, objection handling, catalog search (incl. honest no-match), KB/Skript/Wissen
lookups, both confirm-gated tools (incl. admin-only refusal), company-context injection,
and an out-of-scope honesty check (no tool exists for a total company count). Ran twice
(233 → run 2 numbers below); total cost both runs ≈ $1.22 at current Sonnet-5 intro
pricing — cheap enough to re-run freely.

**Result: strong pass on every correctness-critical rule.** No fabricated facts, dates,
SKUs, or brand-profile categories anywhere across 48 answers (2 runs × 24) — every "no
data" case (unmatched brand, no-match product search, tier-2 order dates, aggregate
counts) was answered honestly instead of guessed. Enrichment answers correctly carried
the literal quote alongside every strength/weakness/opportunity. Both confirm-gated tools
behaved correctly: `log_sales_feedback` never claimed a save happened and correctly
paused for confirmation; `request_enrichment` correctly refused a non-admin and (in the
`--admin` pass) correctly proposed rather than executed. Company-context injection
worked — the context-injection question skipped `search_companies` and went straight to
`get_company_brief`. Token usage per full 24-question run: ~213k–234k input / ~16k
output.

**Real findings — QA/QoL pass (2026-07-24), 3 of 4 closed:**
1. **Objection-card language mirroring — fixed.** `systemPrompt()` (`lib/chat/core.mjs`)
   now explicitly instructs: when presenting a bilingual (DE+BS) objection card, always
   lead with the agent's own language, not German by default. Not re-run through the full
   acceptance set yet (would cost real API spend) — logic-level fix only, worth
   re-verifying live next time the acceptance set runs.
2. **Non-deterministic empty reply — diagnostics added, not otherwise "fixed"** (there was
   nothing to fix — model-level variance, not a code bug). `runChatTurn` now logs
   `stop_reason` + response content-block types whenever `assistantText` stays empty, so
   if/when this recurs there's finally something to debug from instead of a silent
   fallback message.
3. **`log_sales_feedback` disambiguation — left as-is**, per the original judgment call:
   arguably correct behavior (avoids guessing a specific SKU), not a defect.
4. **CSV-escape company-name artifact — fixed.** Scanned all 13,573 companies for the same
   pattern first (only this one row had it — confirmed genuinely isolated, not a
   pipeline-wide import bug). `"Autohandel ""An der Schmiede"""` → decoded (strip outer
   quote, `""`→`"`) → `Autohandel "An der Schmiede"`, updated directly
   (`companies.id = 8e0f9581-05e8-4de2-a9ca-fb0090804c8d`). One other company
   (`"Hösie" Höfer und Sielaff Transportgesellschaft m.b.H.`) matched the same search
   pattern but is a genuine company name with a quoted nickname, not an artifact — left
   untouched.

**Two real bugs found + fixed during pre-demo QA (2026-07-24), reported by Anis as
"Assistent ne radi — Could not resolve authentication method":**
1. **Root cause was a stale dev server, not missing config.** `ANTHROPIC_API_KEY` was
   correctly set in `.env.local` the whole time (confirmed via a fresh Node process); the
   long-running `next dev` process just hadn't picked it up. Restarting the dev server
   fixed it immediately — flagging here in case it recurs, since a stale local process is
   an easy thing to misdiagnose as a real config problem. Not expected to affect a real
   Vercel deploy, where env vars are read fresh at boot.
2. **Real bug: `kb_chunks.search_vector` used German FTS (`to_tsvector('german', ...)`)
   for BOTH collections, but the `skript` collection (Agent Sales Guide) is written in
   Bosnian/Croatian, not German** — `wissen` is genuinely German, `skript` is not. German
   stemming doesn't match Bosnian word forms, so `search_kb` on real Skript questions
   silently returned 0 rows almost every time. The model's response to repeated empty
   results was to keep calling `search_kb` with rephrased queries instead of giving up,
   which burned through `maxTurns` and landed on the generic "couldn't produce an answer"
   fallback — the exact symptom that made this look like a broken assistant rather than a
   search bug. Fixed in two migrations
   (`20260724020000_kb_search_simple_config.sql`,
   `20260724030000_fn_chat_search_kb_simple_config.sql`): switched both the generated
   column and `fn_chat_search_kb`'s query to the `'simple'` FTS config (plain tokenization,
   no language-specific stemming) — correct for both languages at the cost of losing
   German stemming quality, an acceptable trade given the alternative was silently broken
   search for an entire collection. Also updated `/wissen`'s own search query to match
   (`app/(app)/wissen/page.tsx`), and reworded the `search_kb` tool description
   (`lib/chat/core.mjs`) to tell the model explicitly that `skript` content is BS/HR and
   `wissen` is DE — it should phrase search queries in the collection's own language, not
   the agent's question language — plus a cap of ~1-2 retries instead of looping. Bumped
   `runChatTurn`'s default `maxTurns` from 6 to 8 as a cheap safety margin. Verified live
   via a direct `/api/chat` call (bypassing the flaky browser-automation input path): the
   same question that previously exhausted 6, then 8, turns with zero output now returns a
   full, correctly-grounded, quote-accurate answer citing the real 5-phase Skript structure
   in one pass.

**Acceptance-set re-run at current catalog scale (2026-07-26), Anis: "re-run the chat
acceptance test set" (my own suggestion when he asked what could be improved).**
Motivation: the catalog and `product_relations` have grown enormously since the last run
(4,011 → 11,909 products, 21,794 → 141,794 relations, from the webshop merge §13 M4) —
worth confirming grounding still holds at this scale rather than assuming it does.
Re-ran `chat-acceptance-test.mjs --admin` (24 questions + 1 admin case, real cost
~$0.74 at Sonnet-5 intro pricing, 284,789 input / 17,214 output tokens).

**Result: same strong pass as before** — every correctness-critical rule held across
all 25 answers: no fabricated facts/dates/SKUs, every "no data" case (unmatched brand
"Lamborghini", no-match products "Bremsenquietschen"/aircraft parts, tier-2 order dates,
total-company-count) answered honestly, every enrichment claim carried its literal
quote, both confirm-gated tools behaved correctly (agent refusal + admin proposal, no
premature execution), context injection worked. The 2026-07-24 objection-card
language-mirroring fix (lead with the agent's own language) is now confirmed live too —
the BS objection question got a BS-first response. One nice emergent behavior not seen
before: asked `get_brand_profile('VW')` and got no match, the model retried with the
full name `Volkswagen` on its own and found the real profile — a good sign the "VW" vs
"Volkswagen" naming-variant gap (flagged as future work in §13 M4/M5's brand-profiles
note) is partially self-healing at the LLM layer, though the underlying data-normalization
gap is still real and unaddressed.

**One real anomaly investigated, confirmed not a code bug:** question 1 (DE) failed to
find "Autohandel "An der Schmiede"" ("keine Firma gefunden"), but question 2 (BS, same
company, one turn later) found it correctly with a full, accurate brief. Checked the
underlying `fn_chat_search_companies` directly rather than assuming: it's a simple
`ilike '%query%' order by name limit 10` — verified every plausible substring the model
could have reasonably sent (`Autohandel` → the real company ranks 7th of 51 matches,
well inside the limit; `Schmiede` → ranks 2nd of 15; `An der Schmiede` → the *only*
match) all correctly return the company well within the 10-row cap. Since the search
function itself can't produce a false negative for any reasonable substring here, this
was very likely a one-off model-level miss (the LLM either skipped or malformed the tool
call that turn) — the same class of variance already documented above (item 2,
2026-07-24), not a reproducible system defect. No code change made.

**Still open:** real per-turn latency (p95 profile <2s / chat first-token <3s, §2.2) —
the CLI harness bypasses the SSE-streaming path entirely, so it can't measure real
first-token latency. That needs a browser-based check through `/assistent`, which this
environment can't do (the sandboxed preview browser hits the login wall and this
assistant does not enter credentials into it, per its own operating rules) — someone with
a real login needs to check that directly.

---

## 11. Import & ingestion pipelines

Order: VIS list → catalog PDF → KB materials → (Tier 2 orders when available).

### 11.1 Catalog PDF pipeline (10k+ products, ~800 pages — dedicated component)
```
1. UPLOAD    PDF to Storage; register catalog_ingest run (admin panel).
2. SEGMENT   Page-by-page text+layout extraction (poppler/pdfjs); detect product blocks
             (SKU pattern anchors — Normfest Artikelnummern).
3. EXTRACT   Batches of ~10 pages → LLM structured extraction per product:
             {sku, name, category, subcategory, unit, pack_size, tech_specs{}, description}
             zod-validated; SKU regex-verified; confidence per record.
4. STAGE     Into staging table with source_page; dedupe on sku (last page wins, both logged).
5. QA        Admin QA queue: low-confidence records + category outliers + missing pack
             info; spot-check sample per category. Bulk-approve the clean rest.
6. COMMIT    Upsert products (source_page, tech_specs, extraction_confidence).
7. KB FEED   Per-product description chunks → kb 'produkte' with sku metadata.
8. IMAGES    (nice-to-have, later pass) page-image crops → Storage → products.image_path.
```
Expectations: ≥90% auto-clean is realistic with anchor-based segmentation; the QA queue
absorbs the rest. Pack_rank + season may not exist in the PDF → seed via workshop for the
categories that matter (focus lists first), not all 10k at once.

### 11.2 VIS list (customer master) — mapping wizard on first real file; dedup on
Kundennummer, fallback normalized name+PLZ; collisions → manual merge queue; save mapping
for re-imports. Calibration session with Anis on first import.

### 11.3 KB materials — §8 pipeline (many files expected; script file included).

### 11.4 Tier 2 orders — tabular exports only in MVP (Excel/CSV, idempotent on order no).
PDF-invoice parsing = post-MVP milestone if that's the only form (§14.2).

### 11.5 No scraping of external CRMs or review sites. Official APIs + native exports only.

---

## 12. Security — engineering hygiene as v2.2 (RLS CI-asserted, key hygiene, zod, typed
RPCs, no self-signup, audit incl. enrichment + master-data fills, PITR + restore drill).

**M8 pre-checklist audit (2026-07-23, done ahead of M8 while the M5 backlog ran in the
background):** every item checked against the real codebase/project, not assumed.

- ✅ **RLS CI-asserted** — `.github/workflows/ci.yml` runs the full `supabase/tests/rls.test.ts`
  suite (35+ tests covering every table's policies) against the real project on every
  push/PR, with typecheck+lint gating first.
  **Real regression found + fixed (2026-07-25):** a routine perf sweep re-ran the suite
  and found 2 of the `signals RLS + fn_refresh_signals` tests newly failing (previously
  green) — not the documented `chat_log` flakiness, a genuinely different issue.
  Root-caused with `EXPLAIN ANALYZE` (via `npx supabase db query --linked`, not guessed):
  `fn_refresh_signals()`'s `cross_sell` block now legitimately produces **~17,600 real
  signal rows (up from 0)**, a direct, expected consequence of the webshop cross-sell
  merge (§13 M4: `product_relations` grew 21,794 → 141,794 rows same week) finally giving
  the `cross_sell` type real data to fire on — not a bug in the signal logic itself. The
  bigger join + bigger insert simply now takes longer than the 5s vitest default. Added
  `idx_product_relations_product_id_type` (composite `(product_id, relation_type)`,
  migration `20260725070000_product_relations_type_index.sql`) since the join filters on
  both columns and only a single-column `product_id` index existed; bumped the two
  affected tests' timeouts to 15s (real cost after the index: ~2.8s / ~4.4s for the
  idempotency test's two back-to-back full refreshes). Verified: full suite green again,
  40/40 passing.
  **Second real regression, same test (2026-07-31), CI red again:** the whole-book
  enrichment rollout (§13 M4/M5: `company_enrichment` analyzed rows grew 494 → 1,432)
  pushed `fn_refresh_signals()` to ~27.8s end to end (measured directly via
  `clock_timestamp()` against production, not estimated) — the `authenticated` role's
  `statement_timeout=8s` (used by the RPC call in tests and by the real "Empfehlungen
  aktualisieren" admin button) killed every call outright with `57014`. Root cause:
  `seasonal_push`, `new_product_match`, and `cross_sell` each independently re-ran the
  exact same expensive `cross join lateral jsonb_array_elements(external_opportunities)`
  unnest to compute company/category affinity — 2-3x redundant work. Fixed in migration
  `20260731010000_fn_refresh_signals_perf_fix.sql`: the affinity computation (category-
  level, used by seasonal_push/new_product_match) and the cross_sell trigger set are now
  each materialized once into a temp table (with `analyze` immediately after — without it
  the planner picks a much worse plan on the fresh temp table) and all three blocks join
  against those instead of repeating the unnest.
  **Real, load-bearing finding along the way:** a plain `set local statement_timeout` at
  the top of the function body does NOT extend the timeout for that same top-level RPC
  call — the deadline for the current statement is already latched at invocation time
  before the function body starts running (confirmed directly: with only `set local`, the
  test still died at almost exactly 8s despite the higher setting). What actually works is
  a function-level `set statement_timeout = '45s'` in the `CREATE FUNCTION` signature
  itself (a GUC override applied when the function's execution context is set up, not
  mid-body) — added and verified: the same test now runs the RPC to completion instead of
  hitting `57014`.
  **cross_sell now legitimately produces ~85,500 rows (up from ~17,600 in the July 25
  fix)** — a further, expected consequence of the same enrichment rollout, not a bug;
  confirmed via `select type, count(*) from signals group by type`. The insert itself, not
  just the join, is now genuinely heavy. Bumped the two affected tests' timeouts again
  (60s single-refresh, 150s for the idempotency test's two back-to-back refreshes — real
  measured range was ~26-30s/~63-76s across several runs, so real variance is wide).
  Verified: full suite green again (only the pre-existing, already-documented `chat_log`
  describe-block flakiness reproduced once, immediately fixed by an isolated re-run of just
  that test — confirmed not caused by this change).
  **Two real bugs found + fixed in the test file itself (2026-07-24)**, surfaced while
  re-running the suite after the day's data changes: the `chat_log RLS` describe block's
  `beforeAll` picked a company via `select("id, name").limit(1)` with no `order by` and no
  filter — undefined order without `ORDER BY`, so across the real ~13.5k-row table it could
  land on a `do_not_contact=true` row (fails the `sales_feedback` insert check) or a company
  whose name is common enough to fall outside `fn_chat_search_companies`' top-10-by-name
  cap. Fixed: filter `active=true, do_not_contact=false`, `order by id` for determinism, and
  search by `kundennummer` (unique) instead of a name prefix. **Separately — still open, not
  fixed:** 2-4 of the same describe block's tests fail intermittently even after that fix,
  always on an `auth.uid()`-dependent check immediately after a fresh
  `signInWithPassword` (symptom: RLS violation or a null insert result, as if the session
  wasn't yet recognized server-side). Confirmed NOT caused by this session's changes — no
  edits touched `chat_log`/`sales_feedback`/auth in that pass — and confirmed NOT a general
  auth rate-limit (the exact same sign-in-then-query pattern runs 30+ times elsewhere in the
  same file without issue). Root cause not found; smells like a session-propagation timing
  quirk specific to this describe block. Re-run the suite once or twice if it goes red on
  exactly these assertions before assuming a real regression.
  **Real GitHub Actions CI failure investigated (2026-08-06), not just local flakiness
  this time.** Anis shared a screenshot of a real failed CI run (#114, commit `9090e6c`)
  on `fn_refresh_signals is idempotent`, a count-comparison assertion coming back with
  one side `null` instead of the real row count - meaning one of the test's two
  `select("id", {count:"exact", head:true})` calls itself failed (PostgREST returns
  `count: null` on an error) without the test surfacing that error, not a hard RPC
  failure. Investigated properly rather than dismissing it as the already-documented
  local variance: timed `fn_refresh_signals()` directly against production multiple times
  today (single call: 39.2s, 26.1s; back-to-back double-call sequences: 56.4s and 61.2s
  total) - all comfortably inside the 220s JS test timeout and the function's own 75s
  DB-level timeout, with 3-4x margin every time, including in the full suite run right
  after (41/41 green, idempotency test at 61.171s). Given the consistent, healthy local
  margin across every measurement today, concluded this was a one-off CI-runner-side
  transient (most likely a brief connection/count-query hiccup under GitHub Actions'
  resource constraints, not a systemic timeout risk) rather than a regression needing a
  timeout bump or query fix - no code change made for this specific failure at the time.
  **It recurred the same day, this time reproduced locally** (`expected null to be
  86478` - one of the two `count` queries came back `null` with no surfaced error,
  exactly the failure mode predicted above) - with two real occurrences now (one CI, one
  local), fixed properly instead of noting it a third time. Added a `countSignals()`
  helper in the idempotency test that checks the count query's own `error` explicitly
  (previously only the RPC's `error` was checked) and retries once after a 1s delay
  before throwing a clear, labeled error - a single transient hiccup self-heals, a
  second consecutive failure fails loudly instead of producing a confusing
  null-vs-number mismatch. Also bumped the two other describe blocks that sit
  immediately downstream of the heavy signals insert and had shown the same
  DB-contention symptom before (`product_relations / brand_consumption_profiles RLS`,
  `company_enrichment / enrichment_jobs RLS`) from the vitest default 5s timeout to 20s
  each. Verified: full suite green (41/41) on the next run, `visibility_mode` integrity
  re-checked after.
- ✅ **Key hygiene** — `.env*` gitignored except `.env.example` (confirmed: no `.env` variant
  ever tracked in git). `SUPABASE_SERVICE_ROLE_KEY` usage is confined to
  `lib/supabase/admin.ts`, CLI scripts, and the test file — confirmed zero client-component
  imports of the admin client; only `app/api/enrich/route.ts` imports it, and that route is
  admin-role-gated server-side.
- ✅ **zod everywhere** — fixed the one real gap found: `app/api/enrich/route.ts` had no
  input validation (`const { companyId } = await request.json()` with a bare `typeof`
  check). Added `enrichRequestSchema` (zod, `.uuid()`). Every API route now validates its
  body with zod; also swapped its raw `new Anthropic()` for the shared
  `getAnthropicClient()` adapter for consistency with §3.2.9.
- ✅ **Typed RPCs** — `lib/supabase/types.ts` regenerated after every migration; every
  `supabase.rpc()` call in the app is typed against it (verified while building M7's tools).
- ✅ **No self-signup** — confirmed zero `signUp`/self-registration code paths anywhere in
  the app. Accounts only come from `admin.auth.admin.createUser()` (service-role, CLI-only)
  → the `fn_handle_new_user` DB trigger creates the `profiles` row.
- ⚠️ **Audit (enrichment + master-data fills) — partial, still no general log.**
  `company_enrichment.verified`/`verified_by`/`verified_at` gives an implicit audit trail
  for `companies.brand_focus` (§9). §14 item 11 (Places → `telefon`/`website` fill-empty
  write-back) resolved and shipped 2026-07-24 — now 2 master-data-fill features exist, both
  still without a general-purpose `audit_log` table. Deliberately not built this pass
  either: both are the same fill-empty-only shape, re-runnable and traceable via
  `scripts/backfill-places-contact-data.mjs`'s own console output rather than a persisted
  log — real audit infrastructure still feels like premature scope for 2 narrow features.
  Revisit if a third master-data-fill feature shows up, or before an actual go-live.
- ✅ **CI migration dry-run — working (2026-07-25).** Anis: "do CI migration if you can
  solo, i did in supabase the keys if thats the same" — checked directly: what he did
  (generating a token in the Supabase dashboard) was only half of it. The missing half
  was a **GitHub Actions repository secret**, which needs a token *value* pasted into
  GitHub's own secret store (`Settings -> Secrets and variables -> Actions`) — something
  I have no `gh` CLI or GitHub write access to do myself in this environment. Added the
  workflow step (`.github/workflows/ci.yml`: `npx supabase link --project-ref
  ethykzocikyirmoztrtq && npx supabase db push --dry-run`, reading
  `SUPABASE_ACCESS_TOKEN` from `secrets`); Anis added the `normfest-cli` token
  (distinct from his personal one, which was already authenticating my local CLI
  session all along) as that secret same day.

  **Real bug found + fixed after the secret was added, run still failed:** Anis shared
  the actual failed-run log (CI #76) — `link` itself succeeded ("Finished supabase
  link.") but the step still exited 1, with only a `Timeout while shutting down
  PostHog. Some events may not have been sent.` line before the generic error. Root
  cause confirmed by local repro (`SUPABASE_TELEMETRY_DISABLED=1 npx supabase link
  --project-ref ...` vs. without it): the Supabase CLI's own exit-time telemetry flush
  to PostHog can't reach it from this CI runner's network and the CLI treats that as a
  fatal error on exit, even though the actual command had already completed
  successfully — a real CLI rough edge, not anything wrong with our command or
  credentials. Fixed by adding `SUPABASE_TELEMETRY_DISABLED: "1"` to the step's `env`
  block (confirmed locally: exit code drops to 0 and the PostHog line disappears
  entirely with the var set).
- ✅ **Full code + security audit, all findings fixed (2026-07-26).** Anis asked for a
  detailed audit "with knowledge of the actual code" then "fix everything... even if
  small impact." Read the real RLS policies, ran `pnpm audit`, checked real index
  coverage against real table sizes (not assumptions) before writing anything up.

  **Dependencies (2 real runtime CVEs, not dev-tooling noise):**
  1. `xlsx` (SheetJS) pinned at `^0.18.5` had known ReDoS + prototype-pollution CVEs.
     npm's registry stalled at 0.18.5 years ago — SheetJS ships patched releases only
     via their own CDN now. Repointed `package.json` to
     `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (the officially documented
     distribution method). Verified by dry-running `parseVisWorkbook` against the real
     `input/VIS.xlsx` and a real Team Dashboard file — identical parse results
     (13,573/1 skipped) to the pre-patch baseline.
  2. `sharp` 0.34.5 (pulled in transitively by `next@16.2.11`, `^0.34.5`) has known
     libvips CVEs fixed in 0.35+ — directly relevant since P1a (this session) turned on
     `next/image` optimization, so sharp now actively processes every product photo
     request. No stable Next patch exists yet that bumps it, so added a `pnpm-workspace.yaml`
     override forcing `sharp: 0.35.3`. Verified via a real `/_next/image` request against
     a real product photo (200 OK, correctly optimized output) after reinstalling.
  `pnpm audit`: 13 → 10 vulnerabilities; the remaining 10 are dev-only build tooling
  (vitest/vite/esbuild/postcss/`@hono/node-server` via the `shadcn` CLI) with zero
  runtime exposure in the deployed app.

  **Security:**
  3. `/api/enrich` had no daily cost cap, unlike `/api/chat`'s existing per-agent token
     budget — admin-gated, but a careless/compromised admin session could trigger
     unlimited real-money Places + Anthropic calls. Added `enrichment_daily_call_budget`
     setting (default 30/day) + wired up the previously-unused `enrichment_jobs` table
     (existed in schema since M5, never actually written to) as the real per-day counter.
     Verified live: temporarily zeroed the budget, confirmed a real request got a clean
     429 with zero `enrichment_jobs` rows written (no side effects from a blocked call),
     restored the real budget.
  4. All 4 API routes (`/api/chat`, `/api/chat/confirm`, `/api/enrich`,
     `/api/admin/vis-import`) had an unguarded `request.json()`/`request.formData()` call
     — malformed input threw an unhandled exception instead of a clean 400. Wrapped all
     four in try/catch. Verified live: malformed JSON to `/api/chat` and
     `/api/chat/confirm` both now return clean 400s with zero server errors logged.
  5. The chat daily-token-budget check had a real TOCTOU race: two near-simultaneous
     requests from the same agent could both read the same stale "under budget"
     snapshot before either's `chat_log` row landed. New `fn_chat_check_budget_and_log()`
     RPC does the check-and-insert in one statement inside a per-agent
     `pg_advisory_xact_lock`, closing that specific window (real, bounded scope, not
     silently overclaimed — the migration's own comment spells out what this does and
     doesn't fix, since exact token counts still aren't known until the Anthropic call
     completes). Verified live end-to-end: a real chat message still flows through
     correctly with real token counts recorded, and a zeroed-budget test still gets a
     clean 429 with no `chat_log` row written.

  **Performance:**
  6. Firmen search (13,573 companies) and Katalog search (11,909 products, tripled this
     session) both use leading-wildcard `ilike '%query%'` — plain btree indexes can't
     serve that pattern, so every search was a full sequential scan, masked only by
     table size. Added `pg_trgm` + GIN trigram indexes on every searched column.
     Verified via `EXPLAIN ANALYZE` on the real search queries: rare search terms now
     correctly use `Bitmap Index Scan` on the new trigram indexes (91 buffer reads,
     ~4ms) instead of a sequential scan; common terms still correctly use whichever
     plan Postgres finds cheapest — confirmed this is healthy query planning, not a
     sign the fix didn't work.
     **Real regression on top of this, found 2026-07-31 (Anis: "taj search request
     traje malo više"):** the trigram indexes above were real and correct, but
     `/firmen` search was still measured at ~3-9s end to end, both in production and
     locally — confirmed via direct `EXPLAIN ANALYZE` this was NOT the indexes
     (33ms without RLS on the identical query) but RLS itself: once
     `companies_select_visible`'s `fn_company_visible(gebiet)` predicate is ANDed in
     (as it always is for a direct client query against `companies` as
     `authenticated`), Postgres abandons the `BitmapOr`-across-trigram-indexes plan
     entirely and falls back to a near-full scan evaluating the opaque per-row
     function on nearly every one of the 14k+ rows — reproduced with `set local role
     authenticated` + a real `request.jwt.claims`, confirmed independent of
     `ORDER BY`/`LIMIT` shape. Fixed via a new `security definer` RPC,
     `fn_search_companies()` (migration `20260731020000_fn_search_companies_perf.sql`),
     that replicates the exact same visibility rule (`soft_deleted_at is null` +
     the same shared/gebiet/admin logic as `fn_company_visible`) but evaluates the
     admin-check/visibility-mode/caller's-own-gebiet once into plain variables
     instead of an opaque per-row function call — since there's no RLS security
     barrier and no per-row function opacity, the planner uses the trigram indexes
     normally again. Measured with the same harness: 8.5ms (vs ~2.9s) at the SQL
     level; ~170-250ms end to end via a real RPC call (network + auth included);
     ~500-800ms full page load in the actual browser (vs ~8-9s before). `/firmen`
     now calls this RPC instead of `.from("companies").select()...or()`. Re-verified
     live: search results, total count, and pagination (25/page) all still correct,
     including the Gebiet-code search path from the July 24 fix above (1,307 hits
     for a real Gebiet code, unchanged). This RPC also happens to be the right
     foundation for the Gebiet-scoped visibility Anis is planning to pilot with one
     agent (§14 item 10 context) — the per-row check is a plain column comparison,
     not an opaque function call, so flipping `settings.visibility_mode` to 'gebiet'
     later will stay fast, unlike the RLS-policy path which would hit this exact
     regression again for gebiet-scoped agents. Not flipped yet — still 'shared' for
     everyone, per Anis's explicit "not ready yet" on the Alan pilot.

  **Code quality:**
  7. Replaced `select("*")` with explicit columns in 4 single-row detail pages
     (`firmen/[id]`, `katalog/[id]`, `admin/brand-profiles`,
     `admin/qa-bewertungen/[id]/bearbeiten`) — read each file fully to enumerate every
     field actually used before narrowing, since guessing wrong on `firmen/[id]`
     (485 lines, the largest page in the app) would have silently broken a UI section.
     One real gotcha hit along the way: Supabase's typed query builder needs the
     `select()` string to be a single literal (template literal is fine, string
     concatenation with `+` is not — TypeScript widens a concatenated string to plain
     `string`, and the client falls back to an untyped `GenericStringError` result).
     Verified all 4 pages live afterward — every section renders identically to before.

  **New admin tools (audit's "what to add" suggestions):**
  8. `/admin/reviews` ("Offene Reviews") — consolidates the three separate
     pending-human-decision queues (ambiguous enrichment matches, unverified brand
     profiles, Katalog dedup candidates) that previously lived on three unconnected
     pages into one landing page with live counts, each linking to its real screen.
     Nothing merges/verifies/dismisses from here — purely a navigation aid. Verified
     live: real counts (4/22/30 = 56 open) matched each source page exactly.
  9. `/admin/katalog-qualitaet` — data-quality overview across all 11,909 products
     (photo/description/season/category completeness, own-vs-borrowed-vs-generated
     breakdown). Verified live: every figure matched already-documented real numbers
     exactly (228 products with season - the exact count from this session's
     `products.season` backfill; the one uncategorized "Hoodie weiß" merch item; ~9,540
     generated descriptions).

  All 9 items verified with real data via throwaway admin test accounts (created and
  deleted each time, per this session's established pattern) — nothing here is
  "typechecks, therefore done." Full test suite (40/40), typecheck, and lint stayed
  green throughout.
- 🔴 **PITR / backups — NOT enabled, zero backups exist. Explicitly deferred (2026-07-23).**
  Checked directly via the Supabase Management API
  (`GET /v1/projects/{ref}/database/backups`): `pitr_enabled: false`, `backups: []`. Real
  cost to fix: the org is on the **Free** plan, so this needs a Pro upgrade ($25/mo) *plus*
  the PITR add-on itself ($100/mo for 7-day retention, up to $400/mo for 28-day) — a
  ~$125/mo floor, checked via `GET /v1/projects/{ref}/billing/addons`. There is currently
  no way to recover this database (13.5k+ companies, full catalog, all feedback/signals/
  enrichment data) if something goes wrong — Anis reviewed this real cost and explicitly
  chose to defer: "at the moment, in the testing MVP phase I don't need that." Revisit
  before an actual go-live, not before — the "restore drill" half of this checklist item
  is meaningless until backups exist to drill against, and won't exist until this is
  revisited.

---

## 13. Build plan (solo: Anis + Claude Code — vertical slices, earliest value first)

Sequenced so the flywheel starts turning ASAP: agents log in and log feedback within the
first weeks, while heavier pipelines (catalog, enrichment) land behind them.

### M0 — Foundation (slice week 1)
Repo, CI, Supabase EU staging+prod, Vercel + subdomain DNS, auth, profiles, settings,
RLS skeleton (`fn_company_visible`, shared default), seed.
**Done:** login works on staging subdomain; RLS tests green.

### M1 — Customers live (week 1–2)
VIS-list import + mapping wizard + merge queue; Firmen search + profile skeleton
(master data + Notizen).
**Done:** real VIS data browsable; 10 spot-checked companies correct.

### M2 — Flywheel on (week 2–3)  ← earliest agent value
sales_feedback model + 2-tap capture UI (profile + standalone) + Fokus menu v1 (active
list view, manual list creation by Anis) + Dashboard v1 (search + flywheel widget).
**Done:** agents can log outcomes in ≤10s; first real focus list active in production
(yes — go live to agents at M2 with this thin slice; everything after upgrades in place).

### M3 — Catalog online (week 3–5, background-friendly)
Catalog PDF pipeline §11.1 through QA + commit; Katalog UI; KB 'produkte' feed.
**Done:** ≥90% products committed; QA queue drained for focus categories.

### M4 — Signals v1 (week 5–6)
Tier-1 signal set (focus_list_push, feedback_replenishment, brand_profile_match after
workshop seed, seasonal_push, new_product_match, cross_sell curated/winner) + scoring +
Empfehlungen tab + dashboard ranking. Winner stats + generated draft (Anis approves).
**Done:** signal list plausibility-checked (30 samples, Anis+Sanin); first winner report
from real feedback.

**Status (2026-07-23):** schema + scoring + UI shipped (see §6 M4 build note for exactly
which types compute real rows today vs. are deferred on data). Winner stats + generated
draft also shipped same day (see §7) — with only 2 real `sales_feedback` rows in
production so far, `focus_winner_min_sold` starts at 1 (admin-adjustable in `settings`)
so the feature is demonstrably useful rather than empty; raise the threshold once real
volume grows.

**Plausibility check — done (2026-07-23), partial by necessity:** of the 6 Tier-1 types,
only `revenue_trend_risk` had any real rows to check (1,000 of them) — the other five
(focus_list_push, feedback_replenishment, seasonal_push, new_product_match, cross_sell)
are still at zero rows, waiting on data prerequisites, so there was nothing to plausibility-
check for them yet. Reviewed 31 real `revenue_trend_risk` samples (mix of top-score and
spread-score) via an interactive review artifact — **Anis: all plausible.** The
small-looking absolute revenue values (e.g. 134.78 → 45.28) are real, not a units bug —
these are genuinely small independent shops, per Anis directly. Still open: Sanin hasn't
reviewed anything yet (this pass was Anis solo) — worth a second pass once he's available,
and the other 5 types still need their own check once they have real data to look at.

**Cross-sell/upsell data-source clarification (same day, Anis asked):** neither
`cross_sell` nor `upsell_pack` is Tier-2-locked by design — `cross_sell`'s `curated` origin
(admin-defined pairs in `product_relations`, same pattern as the brand-profile workshop) is
already built and computing, just empty because nobody's seeded any pairs yet; its
`winner_derived` origin and `upsell_pack` both have Tier-1 paths (repeat "sold" feedback)
that are simply unbuilt/unfired for lack of volume, not lack of a Tier-1 path. Only the
Tier-2 "mined co-purchase lift" variant of `cross_sell` strictly needs real invoice data.
Anis confirmed enrichment-derived suggestions (`external_opportunity`, already built —
the Firmenbrief's quote-backed catalog matches) are a fine general mechanism independent
of this.

**`product_relations` first real seed (same day):** since Anis didn't have pairs
memorized off-hand, built a quick browsable catalog reference (all 17 categories,
~10 sample real products each, search filter + notes panel) rather than asking him to
recall SKUs blind. He came back with 7 pairs in plain language; 5 resolved cleanly to real
SKUs and are now seeded via `scripts/seed-product-relations.mjs` (`origin='curated'`,
`relation_type='cross_sell'`, weight 3): Aderendhülse isoliert→Federbandschellen-Zange,
Bremsenreiniger→Zellstoffrolle (Putzpapier), Reifenventil→Schlagschrauber, Autoschwamm
Hydro→Airspray-Druckflasche, Druckluft-Ausblaspistole→Nass-Trocken-Staubsauger. 2 pairs
left unresolved rather than force a guess: "Schlagschrauber → Nuss-Set" (no generic
impact-socket-set product found in the catalog under that or related names — only
insulated EV-specific Steckschlüssel-Sätze, which don't fit) and "Lackierer Nitro →
Abdeckungsfolie" (no product literally matching "Nitro" lacquer; found a real
"Abdeckpapier vollgeleimt" for the covering half, but didn't want to guess the lacquer SKU
without Anis confirming which one he means). **Closed, not pursued further (2026-07-24):**
Anis pointed out these are the same kind of catalog gap the webshop cross-sell mining
attempt (below) surfaced generally — not worth chasing two specific pairs by hand when the
underlying catalog-completeness question is already tracked as its own backlog item
(§14 item 12, webshop rebuild). Dropped as an open TODO.

**Verified end-to-end, not just inserted:** ran `fn_refresh_signals()` after seeding —
correctly produced 0 `cross_sell` rows, because the type also requires a real 'sold'
`sales_feedback` entry on the anchor product (not just the pair existing) — confirmed this
is real gating, not a bug, by inserting one throwaway test feedback row (Bremsenreiniger,
a real company), re-running the refresh, confirming the `cross_sell` signal fired with the
correct related product and reason text, then deleting the test row and re-refreshing to
restore the true empty state. `cross_sell` is proven working end-to-end; it simply won't
show real rows until an agent actually logs a 'sold' outcome on one of these 5 anchor
products for some company — expected, given real feedback volume is still tiny.

**Webshop cross-sell mining attempt (2026-07-24) — mechanism works, yield too low to run
at scale today:** Anis pointed out normfest-shop.com (the live public storefront) has its
own "Könnte Sie auch interessieren" merchandising — real, already-curated cross-sell data.
Checked feasibility first: robots.txt is permissive (`Allow: /`, publishes a sitemap,
~14,700 URLs) and this is Normfest's own site powering Normfest's own internal tool, not
third-party scraping — reasonable to use. Decided (Anis) to defer a full catalog rebuild
from the shop to backlog and scope today to just scaling `product_relations` mining.

Built `scripts/mine-shop-crosssell.mjs`: searches the shop for each of our catalog's
products (`/shop/de/produktsuche?SearchTerm=`), lands on the canonical product page, and
parses the real `<!-- G16_Crossseller Anfang/Ende -->` section (clean HTML comment
delimiters, reliably parseable). v1 matched by exact SKU only — **~1% hit rate on random
samples** (0/20, then 0/100). Root cause found and confirmed with concrete examples: our
PDF-extracted catalog has multiple pack-size/variant SKU rows per product family (e.g. 5
separate "Thermotape" rows, 3 separate "Frostschutz-Konzentrat" rows), but the shop's
search index surfaces roughly one canonical SKU per family — exact-SKU search mostly
misses even when the product genuinely exists under a sibling SKU.

v2 switched to name-based matching (word-overlap scoring, SKU-exact preferred when it
works) — **didn't meaningfully improve the yield** (1/30 in the most consumer-facing
categories, 0/30 on a repeat). Diagnosed why: every miss consistently returned "15
candidates at 0.00 similarity" — the search's no-match behavior falls back to a fixed
generic bestseller widget rather than an honest empty result, and the matching algorithm
correctly rejects it (0.00 score, well under the 0.5 threshold — no fabricated matches,
same principle as everywhere else in this project). The real bottleneck isn't matching
precision, it's that a large share of our catalog (variant SKUs, small hardware/DIN
fastener items, O-rings, individual accessories) simply isn't independently searchable on
the retail storefront's search — likely a genuine assortment/indexing gap, not fixable by
smarter fuzzy-matching. Total real evidence: ~1% hit rate across ~215 random test
lookups, all traced to real, understood causes, not left as an unexplained failure.

**Left as working, reusable code — not run at full scale.** The script is correct and
will matter far more once the deferred "rebuild catalog from the shop" backlog item
happens (crawling the shop's own category/sitemap structure directly, rather than
searching backward from our PDF-extracted SKUs, would naturally have much higher overlap
with itself). Not deleted; just not worth ~30-40 min of crawling today for an estimated
~30-40 real pairs. `scripts/seed-product-relations.mjs`'s manual/curated pairs (above)
remain the practical near-term path for `product_relations`.

**Full webshop catalog crawl (2026-07-24/25) — the deferred item above, done properly.**
Anis decided to go ahead with a real crawl of the shop's own sitemap/category structure
(not search-backward from our SKUs) rather than more one-off mining, specifically to (1)
get real cross-sell coverage at scale and (2) source real product photos instead of
re-cropping the PDF. Also decided: skip the free name/branche-only enrichment shortcut
entirely (real Places-based enrichment for the 1000+ backlog stays queued behind an
explicit internal GO, not started this session) — the webshop crawl was the actual
priority.

`scripts/crawl-webshop-catalog.mjs` (rewritten to v2 after a v1 stall — see below) fetches
`https://www.normfest-shop.com/shop/sitemaps/de_DE/sitemap-de_DE.xml` (gzip, decompressed
via `zlib.gunzipSync`): 14,238 total `/produkte/` URLs, split by regex on whether the slug
ends in a real numeric SKU (`/-([0-9]{3,}(?:-[0-9]+)*)$/`) into 9,630 direct product pages
and 4,608 category-hub pages. **v1 bug (caught before any DB writes via `TaskStop`):**
treated every `/produkte/` URL as a category and ran tile-extraction against direct
product pages too, scraping an unrelated bestseller widget instead of the page's own
product — unique-product count stalled at 243 after 2,200+ pages. v2's 3-phase design:
Phase A fetches all 9,630 direct product pages directly (own name + image + cross-sell
tiles from each page); Phase B scans the 4,608 category hubs for any additional product
tiles not already covered; Phase C fetches those extras (116 found). Each product page's
cross-sell section (`<!-- G16_Crossseller Anfang/Ende -->`, same delimiter pattern as
`mine-shop-crosssell.mjs`) is captured into a new `cross_sell_candidates jsonb` column
alongside name/image, in the same page fetch — no extra requests. Politeness: 250ms
delay, concurrency 5, 20s timeout per request, resumable (skips SKUs already staged).
Staged into `webshop_products_staging` (new table, `matched_product_id` nullable FK to
`products`) — mirrors the established PDF-pipeline STAGE→QA→COMMIT pattern (§11.1);
nothing in the crawl/match scripts ever inserts, deletes, or renames rows in the live
`products` table itself. **Full run result: 9,735 products staged (9,630 direct + 116
extra-from-category), 0 errors**, 9,732 with an image (99.97%).

`scripts/match-webshop-staging.mjs` then does the actual comparison + write-back, exact-
SKU matched:
- **1,837 of the 9,735 staged products already exist in our 4,011-product PDF catalog**
  (same Art.-Nr.) — **7,898 are genuinely new/unique**, not in our catalog at all. (Merging
  those 7,898 into the live `products` table is intentionally NOT done here — a separate,
  later, Anis-reviewed step per the existing §14 item 12 backlog plan, same as before.)
- **1,837 of our 4,011 existing products now have a real photo** (`products.image_path`,
  new column — `alter table products add column image_path text`, migration
  `20260724130000_products_image_path.sql`; CLAUDE.md §4.3 had already documented this
  column but it was never actually migrated in before now). The other 2,174 have no image
  from this crawl — no PDF re-crawl needed to get these 1,837 (the webshop match is a
  strictly better source than re-cropping the PDF: real product photography vs. a PDF
  page crop), but the remaining 2,174 are a real, still-open gap; possible future recovery
  path is fuzzy name-matching against the 7,898 new products (not built).
- **Cross-sell**: 27,521 candidate pairs found across all staged products' crossseller
  sections; 21,789 resolved to real matched-product pairs (both sides existing in our
  catalog) and written into `product_relations` (`origin='curated'`, `relation_type=
  'cross_sell'`, weight 2, `note` cites the source) — pushing this well past the 5
  hand-picked pairs from the earlier manual seed. Real, already-curated Normfest
  merchandising data, not invented.

**PostgREST partial-upsert bug found + fixed while building the matcher**: `.upsert(rows,
{onConflict})` with a partial-column payload (e.g. just `{id, matched_product_id}`) always
issues an INSERT-shaped statement under the hood even when every row already exists, so it
trips NOT NULL on every column not included — confirmed directly (`23502`, "null value in
column sku violates not-null constraint"). Fixed with two dedicated SQL bulk-UPDATE RPC
functions instead (migration `20260724140000_fn_bulk_update_helpers.sql`:
`fn_bulk_set_matched_product`, `fn_bulk_set_image_path`, both `language sql`, one
`UPDATE ... FROM jsonb_array_elements(pairs)` per batch of 500) — a real UPDATE has no such
issue. Caught via a proactive 3-row dry-run before committing to the full ~1,800-row batch.

**Katalog product page (`app/(app)/katalog/[id]/page.tsx`) now shows both**: the product's
own photo (from `image_path`, resolved via `supabase.storage.from("product-images").
getPublicUrl()`) in the header, and a "Könnte auch interessieren" grid (up to 12, from
`product_relations` joined to `products`) with each related product's own photo, name, and
SKU, linking to that product's own Katalog page — labeled "Laut normfest-shop.com". Both
images use `next/image` with `unoptimized` (avoids needing `next.config.ts`
`images.remotePatterns` changes for the Supabase Storage host). Verified live end-to-end
in a real browser (throwaway admin test account, deleted after): a real product
("Schneidezange für Polyamidrohre") renders its own photo plus 12 real cross-sell tiles
with their own photos, names, and SKUs, matching the DB exactly — confirmed the whole
tile (image included) is one `<Link>`, so clicking the photo navigates too.

**Fuzzy image recovery for the remaining 2,174 imageless products (2026-07-25):** Anis
asked to close this gap now rather than leave it, but explicitly not via blind web image
search — real risk of a wrong product's photo with no way to verify 2,000+ matches, same
"don't fabricate" principle as the rest of the project (§11.5 already restricts external
data sourcing to official APIs/exports). Instead: `scripts/match-webshop-images-fuzzy.mjs`
name-matches (Jaccard word-overlap on normalized German product names) each imageless
product against the 7,884 already-crawled webshop products that didn't exact-SKU-match
(root cause of the original miss: our PDF SKU sometimes differs from the webshop's SKU
for the same real product) — reuses images already sitting in the `product-images`
storage bucket, zero new requests/downloads. Two thresholds, chosen after inspecting real
output: `>= 0.6` auto-write (e.g. "Alu-Dichtring DIN 7603 Form A" ← "Alu-Dichtring DIN
7603", a real same-family match at different dimensions, same photo-reuse pattern already
accepted in the exact-match case), `0.4–0.6` logged but never written — spot-checked this
band and confirmed it's genuinely risky (e.g. "Kupfer-Fülldichtring **Form C**" would have
matched a "Form A" product's photo — different shape, wrong photo), so holding it back was
the right call, not overcaution. **Result: 115 more products got a real photo** (now 2,059
still without). The much larger remainder (154 held-back + 1,905 with zero name overlap at
all) confirms the same finding as the earlier cross-sell mining attempt (above): a large
share of our catalog — DIN/hardware parts, dimension variants — genuinely isn't
independently represented on the retail storefront, not a matching-algorithm limitation.
For that true remainder, PDF crop remains the one source guaranteed correct per-product;
not run this pass (targeted, smaller-scope job vs. the ~2,000-wide gap here).

**Representative-image fallback for the rest (2026-07-25):** Anis wanted the gap closed
now rather than deferred to a PDF crop, explicitly ruling out blind web image search but
fine with a same-category "similar product" photo standing in so the Katalog isn't empty.
Added `products.image_is_representative boolean` (migration
`20260725010000_products_image_representative.sql`, fixed same day in
`20260725020000_fix_fn_flag_representative_images.sql` — Supabase's safe-update guard
rejects an UPDATE with no WHERE clause even inside a `security invoker` SQL function,
needed an explicit `where true`) so a borrowed photo is never silently presented as the
product's own — same "never silently mixed" provenance rule as everywhere else (§3.2.6).

`scripts/fill-representative-images.mjs` picks the closest match by name-word-overlap
(Jaccard) within the same subcategory first, falling back to the same top-level category
only if the subcategory has no photographed member at all. **Critical guardrail added
after spot-checking the first pass:** a same-category-only match was accepted even at
0.00 name overlap, and inspection caught real bad matches this way — e.g. a specific
paint-color spray can ("MB 9147 arktikweiss") matched to a generic spray-nozzle
accessory just because both sit under "Lackierung", and worse, "Ringzunge" (ring-terminal
electrical connectors) matched to "Flachstecker" (a visually different spade connector)
purely on category, not actual similarity. Fixed: a candidate is only ever accepted if it
shares at least one real word with the product's own name (score > 0) at either tier;
zero-overlap candidates are refused and the product is left with no image rather than a
wrong one. Real result: **1,975 more products got a real (borrowed) photo, 84 were
honestly left with none** (no name-similar product exists anywhere in their category —
mostly `Gewindestift` grub-screw variants, whose only category-mates are unrelated
threadlocker/sealant products). Verified live in a real browser (throwaway admin test
account, deleted after): a representative photo renders with a small "Beispielbild" badge
(tooltip explains it's a similar product's photo, not the item's own) on both the Katalog
detail page and the cross-sell tiles on other products' pages.

**Final photo coverage across the 4,011-product catalog: 1,837 own real photos (exact
webshop SKU match) + 2,090 representative/borrowed photos (115 fuzzy webshop name-match +
1,975 in-catalog similar-product fallback) = 3,927 of 4,011 (97.9%) now show a photo; 84
(2.1%) still show none.**

**PDF crop for the true remainder (2026-07-25):** Anis asked to close the last 84 by
cropping each product's own real photo out of the catalog PDF itself (rather than
relying only on the webshop/similar-product fallbacks above) - no PDF-rendering tool was
available in this environment (no poppler/`pdftoppm`, no working Python), so
`pdfjs-dist` + `@napi-rs/canvas` were added as dev dependencies and
`scripts/render-catalog-page.mjs` renders any PDF page to PNG directly in Node.
`scripts/crop-catalog-images.mjs` groups the 83 real products (excludes SKU 1957-001-0,
a table-of-contents cross-reference entry, not a physical product) by their recorded
`source_page`, renders that page plus neighbors (confirmed during this same pass that
`source_page` is occasionally off by 1-2 pages - not just the ±1 already known from the
M3 QA note, above), and sends the page image(s) to Sonnet (vision, §3.2.9 "analyze" tier)
to locate each product's own photo as a normalized bounding box, with an automatic
±2-page-window retry for anything not found on the first pass.

**Real, load-bearing finding: the vision bounding-box call is meaningfully
non-deterministic run-to-run on identical input** - re-running the exact same script
against the exact same pages flipped several results between "correctly finds the real
photo" and "confidently returns a text/table fragment instead" (e.g. SKU `07`'s
Sicherheitsmesser knife photo vs. an unrelated replacement-blade order table; `7101-005-
004`'s Wandverankerungs-Set photo vs. just its own section heading with no image). This
was only caught because every crop was spot-checked visually via a generated contact
sheet (`scripts/make-contact-sheet.mjs`, tiles crops into labeled grids so ~80 images can
be reviewed in a few screens instead of one file at a time) before any upload - a
byte-size-based sanity check alone (reject anything under ~1.5KB) caught the fully-blank
crops but not these confident-but-wrong ones. **Fix that also closed the reliability gap
for future runs:** `scripts/upload-verified-crops.mjs` uploads the exact, already-
reviewed crop files sitting on disk from one specific dry run rather than re-invoking the
LLM at upload time - once a batch is visually approved, nothing about it can silently
change between review and going live.

**Result: 76 of 83 got a real, own, PDF-cropped photo** (bringing total catalog photo
coverage to 4,003 of 4,011 = 99.8%). 7 genuinely could not be resolved to a real photo
and were left with none rather than guessed: 2 confirmed cases where the product simply
has no distinct photo anywhere near its recorded page after a wide search (`3555-999-1`
Feuerzeugpistole, `3558-952-4` Drahtstifthülsen - both only ever return unrelated text/
diagram fragments), and 5 more found only as low-confidence/degenerate crops across
multiple runs (`07`, `6429`, `6590-103`, `7101-005-004`, `7101-010`) - rejected after
direct visual inspection rather than trusted. Verified live in a real browser (throwaway
admin test account, deleted after): a cropped product (`6057-10-20`, one of the shared-
photo `Gewindestift`/hex-bolt family) renders correctly with no "Beispielbild" badge,
confirming it's correctly tracked as the product's own photo, not a borrowed one.

### M5 — Enrichment (week 6–8)
Places resolver + ambiguous queue; website fetch/distill; analyze + guardrails; Brief-
Karte; external_opportunity + brand_focus verification chain; admin enrichment panel;
pilot slice (~200 companies, one Gebiet).
**Done:** ≥70% pilot ok; 20 briefs spot-checked; floor-cleaner canonical test passes.

**Status (2026-07-23):** Google Cloud project + Places API key provisioned by Anis,
whole pipeline built and piloted same day. `lib/enrichment/*.mjs` (Places resolver,
website fetch/distill, Sonnet ANALYZE) shared between CLI scripts and the on-demand
`/api/enrich` route (admin-only "Jetzt anreichern" button on `/firmen/[id]`). Brief-Karte
on the company profile; ambiguous-queue admin screen at `/admin/enrichment`.

**Pilot run (Gebiet 130022 / Emina Berilo, 200 companies, ~10.5 min, $ low-single-digits):**
149 resolved cleanly (74.5%, clears the ≥70% bar), **48 ambiguous (24%)**, 3 no-match.
113/149 resolved had a website (76%), 137 analyzed (12 skipped — no reviews/website
text to work from), 120 produced at least one quote-backed external opportunity. Zero
pipeline errors. The ambiguous rate is real and higher than expected going in — likely
structural (many small Kfz shops share generic naming patterns in the same city) rather
than a resolver defect; 48 real cases now sit in the admin queue for Anis to work
through. Full DB total after pilot: 212 companies enriched (200 new + 12 from earlier
manual testing).

**20-brief spot-check — done (2026-07-23):** reviewed via an interactive artifact showing
real source (reviews/website) next to each AI claim, 20 companies mixed across
review-based/website-only/name-branche-only evidence. **Anis: "Analyzen generell sauber
und gut und auch immer konstant"** (quote-fidelity holds up, consistently) — with one real
finding along the way, the `external_opportunities` branche-fallback gap, now fixed (see
above). Floor-cleaner canonical test specifically not separately re-verified — the
underlying quote→opportunity→matched-product chain it was meant to prove is the same
mechanism spot-checked here, just not that literal example again.

Also caught and fixed a real prompt bug while testing: the model was citing this
codebase's own "(keine Website verfügbar)" placeholder text as if it were customer
evidence, fabricating a weakness from the absence of data. Tightened the ANALYZE prompt
to explicitly reject placeholder text as evidence — re-verified fixed.

**Concrete product matching (added 2026-07-23, Anis):** `external_opportunities` used to
stop at a free-text category label ("Lackier- und Aufbereitungsprodukte") — useful, but
left the agent to manually search the Katalog. Each opportunity now also carries
`catalog_category` (the model must pick one of the 17 real `product_categories`, enforced
via json_schema enum — never invented) and `search_terms` (1-3 German words it expects in
a real product name). `matchCatalogProducts()` then does a real `ilike` lookup against
`products` scoped to that category, attaching up to 3 real SKU matches
(`matched_products`) shown as clickable Katalog links on the Firmenbrief. Real hit rate on
one test company: 4/6 opportunities matched a real product (Politur, tire-valve parts,
engine-oil-circuit cleaner, cable connectors); the other 2 correctly came back empty
(search terms like "Bremsscheibe"/"Stoßdämpfer" don't exist in the catalog's PKW-parts
naming) — no fabricated matches, consistent with the "don't fire without data" principle.
Not yet re-run across the full 200-company pilot — only the schema/matching logic is
proven on a single company so far.

**`external_opportunities` branche-fallback fix (added 2026-07-23, from the M5 spot-check):**
Anis's spot-check flagged that opportunities aren't always returned even when they should
be. Checked against real data: 94.1% of the 492 analyzed companies get ≥1 opportunity, and
the 5.9% that don't split into two groups — genuinely-irrelevant businesses (potato
wholesaler, energy co-op — correctly empty, forcing a Kfz pitch there would be exactly the
fabrication §9's guardrail exists to prevent) and a smaller, real gap: logistics/fleet
companies (e.g. "SeaLand Project Logistics") that plausibly operate vehicles needing NFZ
parts, but got zero opportunities because the prompt only allowed branche-derived
`evidence_source: "name_branche"` reasoning when there was ZERO Google data — the moment
any reviews/website text existed, that fallback silently stopped being offered, even if
the actual text said nothing about fleet maintenance. Fixed in `buildPrompt()`
(`lib/enrichment/analyze.mjs`): branche-derived opportunity reasoning is now always
available in parallel with review/website evidence, not gated behind having zero Google
data (strengths/weaknesses remain untouched — still strictly evidence-bound). Verified by
re-analyzing SeaLand directly: 0 → 5 opportunities, correctly mixing real website quotes
("6 Volvo-Zugmaschinen der neuesten Generation") with branche-derived reasoning, all
matched to real catalog SKUs. Not yet re-run across the other ~26 previously-empty
companies to confirm the fix generalizes — cheap to do (~$0.04/company) whenever useful.

**Name/branche-only analysis + purchase-priority batching (added 2026-07-23):** not
every company has a Google Business Profile, and the company name/branche alone is often
real signal (Anis's example: "Ausbeultechnik" in the name → dent/body repair → Karosserie
products) — verified on a real no-match company ("Bernd Honekamp Fahrzeugausbau"): empty
strengths/weaknesses (correctly — name says nothing about service quality) but 3 real
opportunities derived from the name alone, quote-tagged `evidence_source: "name_branche"`
so the UI never blends this with Google-sourced claims. `analyzeCompanyEnrichment` now
always runs regardless of Places outcome. `scripts/enrich-pilot.mjs` also now orders
targets by purchase recency (bought this year > last year > year before > never) rather
than arbitrary order — Anis wants real spend prioritized where the flywheel has a live
relationship first, ahead of a go-live funding decision.

**Rollout-readiness batch #1 (2026-07-23) — blocked mid-run on Anthropic billing:**
attempted 788 companies (targeting ~1000 enriched total to get a bigger pre-go-live
sample; Anis has $300 GCP credit for Places, separate from Anthropic). Places resolution
ran to completion for all 788 (699 resolved, 85 ambiguous, 4 no-match, 475 website
fetches) — that data is real and saved, no wasted Places spend. **The Anthropic account
ran out of credit around company #29** and every ANALYZE call failed for the rest of the
batch (760 of 788). Current DB state: 1076 companies have an enrichment row total, 220
genuinely analyzed, **856 have real Places data but are waiting on an ANALYZE pass**.
Anis chose to pause enrichment here rather than top up billing immediately — next step
whenever resumed: top up Anthropic Console billing, then re-run analysis-only (no new
Places calls needed) over the 856 backlog before doing more Places-resolution batches.

**Full agent-book enrichment kickoff, Alan Sacic pilot (2026-07-27):** Anis secured real
project funding; first real test is fully enriching one agent's entire book before
scaling further. Alan Sacic (Gebiet `130023`): 980 companies, 78 already had some
enrichment (39 fully analyzed, 37 Places-resolved-only), leaving **902 genuinely
untouched**. GCP Places spend so far project-wide: a real, checked $3.50 across 1,078
already-processed companies (~$0.00325/company) — Anis's own real billing-console number,
not an estimate, and far cheaper than the earlier "low single-digit $ per 200" guess.
Anthropic card top-up lands the next day, so the run was deliberately split along the
pipeline's real cost boundary: Places resolution + website fetch (`lib/enrichment/
places.mjs`, `website.mjs`) touch zero Anthropic — confirmed directly (`grep` for
`anthropic`/`getAnthropicClient` in both files returns nothing) — only
`analyzeCompanyEnrichment` (`lib/enrichment/analyze.mjs`) spends Anthropic credit.

Added `--places-only` to `scripts/enrich-pilot.mjs` (skips the ANALYZE call entirely,
leaving `places_resolved_at` set and `analyzed_at` null so `scripts/analyze-backlog.mjs`
picks the row up later) and a `[gebiet]` filter to `analyze-backlog.mjs` (previously
whole-book only) so tomorrow's Anthropic-only pass can stay scoped to just his Gebiet
instead of pulling in every other agent's pending backlog too.

**Two real bugs found during the 3-company smoke test (caught before the full run, per
the established "test 2-3 companies before scaling" discipline):**
1. `--places-only` was parsed in `main()` but never threaded into the `pool()` call site
   — the flag existed but did nothing, so the first smoke-test batch ran the full
   pipeline anyway and spent a real (small) $0.1279 in Anthropic credit a day early.
   Fixed by passing `placesOnly` through to `processCompany`.
2. **Separately, a real pre-existing bug**, same class as the earlier
   `company_gebiet_coverage` 1000-row cap fix: the script's `alreadyEnriched` lookup
   (`.from("company_enrichment").select("company_id")`) had no pagination and silently
   capped at PostgREST's default 1000 rows — with 1,078 real rows, 78 were invisible to
   the "already enriched" check, so up to 78 already-done companies could have been
   reprocessed as if new during the full run (wasted spend, not data corruption, since
   it's an upsert — but real money nonetheless). Fixed by paginating the same way the
   companies query below it already does. Verified directly: before the fix the script
   reported "1000 already enriched overall"; after, it correctly reports "1078".

Verified both fixes live against real companies (not a dry run) before scaling: a
follow-up 3-company `--places-only` batch showed `analyzeInputTokens: 0` /
`analyzeOutputTokens: 0` / real cost `$0.0000`, and the candidate count matched the
expected math exactly (899 remaining after 3 test companies, `978 eligible - 79 with any
enrichment`). Full run then kicked off in the background for the real remaining 899
companies: `node scripts/enrich-pilot.mjs 1000 130023 --places-only`. Plan: once
Anthropic billing tops up, run `node scripts/analyze-backlog.mjs <limit> 130023` to
analyze all ~939 Places-resolved-but-unanalyzed rows in his Gebiet (the original 37 + the
~899-902 new ones from today), spending zero additional Places credit since that data is
already saved.

**Full whole-book Places rollout, same day (2026-07-27):** after Alan's pilot proved
clean, Anis asked to run `--places-only` for the remaining 9 agents too (Emina Berilo,
Lejla Piric, Maja Biso, Rijalda Halilovic, Elida Karovic, Arnela Orucevic, Muhamed Lepic,
Merima Zulfic, Nejra Adzemovic), one Gebiet at a time with a go/no-go between each (two
run concurrently once — Arnela + Muhamed — since they're fully independent). Each
verified directly against the DB before moving to the next, same discipline as the Alan
run. **Result: 13,546 of 13,573 active companies (99.8%) now have Places data**, 7,424
with a successful website fetch, 494 already fully analyzed (the pre-existing backlog);
the remaining ~13,050 are Places-resolved-only, waiting on the Anthropic analyze pass.
Zero Anthropic spend across all 10 runs (confirmed `$0.0000` every time via the
`--places-only` flag).

**Real GCP cost correction (2026-07-27, Anis checked the actual billing console, corrected
twice same day as the real total came into focus):** total project-wide GCP spend to date
is **$197 of the $300 credit** — first reported as ~$180, refined to the exact $197
figure. Isolating today's rollout: $197 - the earlier ~$3.50 baseline (before today) ≈
$193.50 for the ~12,466 companies processed today (sum of each run's candidate count) →
real rate ≈ **$0.0155/company** — about 4.8x higher than the earlier $3.50/1,078 ≈
$0.00325/company estimate. Same class of correction as the Anthropic ANALYZE cost
surprise (§13 M8: initial estimate from a small sample turned out ~4x too low once
measured at real scale) — small-batch extrapolations for external API costs keep
underestimating here; trust a real bill over a small sample every time.
**Remaining GCP credit: $103** of the original $300 project credit. No in-app budget cap
exists for Places spend (unlike `/api/enrich`'s `enrichment_daily_call_budget` for
Anthropic) — worth adding before any further large batches, since at ~$0.0155/company the
remaining $103 covers roughly 6,600 more companies, not an unlimited runway.

**Ongoing Places usage after this rollout, assuming no new companies get added (2026-07-27,
Anis asked directly):** everything that still needs to happen from here — tomorrow's
Anthropic analyze pass, resolving the ambiguous queue (manual merge or same-address
auto-merge), retrying failed website fetches — touches zero Places credit; verified via
the code (`resolveForCompany`/`fetchWebsiteForCompany` calls and the ambiguous-merge
scripts don't call the Places API again). The one place that still genuinely calls Places
every time it runs is the on-demand "Jetzt anreichern" button
(`components/enrich-now-button.tsx` → `/api/enrich`) — it always re-resolves regardless of
whether `places_resolved_at` is already set, by design (lets Anis intentionally refresh a
company's Google data, e.g. new reviews, rather than being stuck with a stale snapshot
forever). **Confirmed this is a non-issue, not a fix-it item:** the button only renders for
`isAdmin` (`app/(app)/firmen/[id]/page.tsx`) — agents don't see it at all, today or once
real agent accounts exist — so the only person who can trigger a redundant Places spend is
Anis himself, deliberately. Decided not to add a skip-if-already-resolved guard: it would
block the legitimate refresh use case for a cost risk (~$0.0155/click) that's already
fully contained by the existing admin-only gate.

### M6 — KB + Skript (week 8–9)
KB ingest of the material folder; objection_cards extraction; Wissen + Skript menus.
**Done:** all supplied materials published; objection cards searchable.

**Status (2026-07-23):** shipped — schema, Skript (21 chunks + 8 objection cards from the
Agent Sales Guide) and Wissen (seeded onboarding content) both live. Full detail in §8's
M6 status block. "All supplied materials published" is intentionally not 100%: the
Operativni Priručnik was deliberately skipped (mixes real methodology with sensitive HR/
comp data) — Anis's call, not a gap.

### M7 — Assistant (week 9–10)
Chat route + full toolset + citations + context injection + feedback-confirm + budgets.
**Done:** acceptance set passes (§13.4); latency targets met.

**Status (2026-07-23):** built (see §10 M7 status for the full breakdown) — provider
adapter, schema + 7 tool RPCs, `/api/chat` + `/api/chat/confirm`, `/assistent` page +
company-context link. Billing was topped up same day; the acceptance set ran twice (48
answers total) with a strong pass on every correctness-critical rule (grounding, no
fabrication, tier-honesty, quote-attribution, both confirm-gates, admin-gating,
context-injection) — 4 real but non-blocking findings logged in §10, none silently
patched. **Still not done:** real first-token/p95 latency measurement — needs a
browser-based check through `/assistent` with a real login, which isn't available in
this environment.

### M8 — Hardening & full go-live (week 10–11)
Security checklist, restore drill, remaining-Gebiet enrichment batches, Tier-2 import if
invoices confirmed tabular, hypercare 2 weeks.

**Status (2026-07-23):** security checklist done — see §12 for the full audit (one real
code gap fixed, everything else clean except the two flagged items). Everything else in
this milestone is blocked on a decision that isn't mine to make, not on missing code:
- **Restore drill** — can't drill a restore that doesn't exist; PITR/backups explicitly
  deferred until go-live (§12, ~$125/mo, Anis's call given the MVP testing phase).
- **Remaining-Gebiet enrichment batches** — paused. The 856-company analyze-only backlog
  (§10/§13 M5 status) got to 487/1076 analyzed before hitting the Anthropic billing wall a
  second time same day; Anis flagged the per-company cost as too high to keep pushing on
  right now, so this is on hold pending a cost-model decision, not a technical blocker.
- **Tier-2 import** — still waiting on Anis confirming invoice access/format (§14 item 1).
- **Hypercare** — not applicable until an actual go-live date exists.

**Cost investigation (2026-07-23, same day):** Anis reported the $10 top-up got fully
consumed by the M7 acceptance runs + this backlog batch combined and asked why. A
character-count estimate from real stored prompts (avg ~6,176 chars/prompt, ~2,417
chars/output) put the expected cost at only ~$1.83–2.21 per 200 companies — a real gap
from what was actually spent, and one I couldn't fully close: the free `count_tokens`
endpoint that would give an exact number is *also* blocked at zero credit balance, so
there was no way to verify the true chars-per-token ratio for German/mixed text against
this specific pricing tier. Rather than keep guessing, fixed the actual gap — **no
durable token-usage tracking existed anywhere**, despite §3.2.9 promising "usage counters
in admin." Added `company_enrichment.analysis_input_tokens`/`analysis_output_tokens`
(migration `20260723250000_enrichment_token_usage.sql`), wired through
`analyzeCompanyEnrichment`'s return value, and every enrichment script
(`analyze-backlog.mjs`, `enrich-pilot.mjs`, `enrich-analyze.mjs`) now prints/persists the
*real* per-call cost instead of an estimate. Also swapped every remaining raw
`new Anthropic()` in the enrichment scripts for the shared `getAnthropicClient()` adapter
while touching these files (§3.2.9 consistency). Confirmed the instrumentation is wired
correctly with a 1-company test call, credit ran out again immediately after, Anis topped
up $5 more, and a 5-company real test with the new instrumentation resolved this cleanly:

**Real cost is $0.0433/company for ANALYZE-only — my char-count estimate (~$0.01) was
off by ~4x.** The gap is almost certainly structured-output/json_schema enforcement
overhead that isn't visible in the prompt/response text itself (real output tokens/company
came in ~4.5–5x higher than the stored `analysis_raw` JSON's character count would
suggest) — something only a live call could reveal, which is exactly why the earlier
estimate (made while credit was unavailable) missed it. This number fully reconciles the
original mystery: 200 companies × $0.0433 ≈ $8.66, plus the ~$1.20 from the two M7
acceptance-test runs ≈ $9.86 — matches the original $10 spend almost to the dollar. It
was never a bug or wasted spend, just the real price, now stored durably instead of
needing to be re-derived from console totals. Real cost to finish the remaining 584-company
backlog: ~$25.30. Anis chose to stop here for now rather than spend further today
("Stani ovdje za sad") — resume is a cost decision, not a technical one.

### M9 — Call QA / Coaching Assistant (backlog, post-MVP, added 2026-07-23)
Not scoped yet — revisit when we get here, at which point Anis picks/provisions the
external ASR service. Concept: TL manually uploads a saved call recording (mp3/wav —
**not** a live dialer/telephony integration, that stays out of scope per §1) →
external ASR transcribes with speaker diarization (agent vs. customer) — needs German
support, e.g. Deepgram Nova-3 or Whisper; not yet chosen — → Claude (Sonnet-class per
§3.2.9 cost-tier rule) analyzes the transcript against the documented call methodology
(§8's source material: 5-phase call structure, 5S objection technique, the 8 scripted
objection responses, banned-phrase list, vocabulary-substitution table) → structured QA
report for the TL: phase timestamps, objections raised + how handled, scorecard-style
score, coaching notes. Rough cost estimate: ~$0.05–0.15/call all-in (ASR ~$0.005–0.01/min
+ Sonnet analysis ~$0.02–0.03/call) — trivial even at the TL's documented ≥15 QA
reviews/week cadence. **Blocked on:** Anis choosing an ASR provider — nothing else is
needed to start.

**Placeholder shipped (2026-07-24):** `/admin/qa-anrufe` — nav item (badged "Bald")
+ concept explainer + a mock report, built purely so the concept is demoable before
the real ASR integration exists. Uses `input/Osnovna dokumentacija/Elida.mp3` as the
example filename in the mock upload card, but the audio itself is deliberately **not**
embedded or served anywhere in the app (it's a real customer call recording; copying
it into `public/` would expose it at an unauthenticated static-asset URL on the live
domain — not worth the risk for a placeholder). The example transcript and QA
scorecard shown are entirely fictional/illustrative, clearly labeled as such, not a
real transcription of that file. No functional change otherwise — this is scope
exactly as described above, still blocked on the same ASR-provider decision.

Weeks assume steady part-time solo work with Claude Code; slices are independent enough
to pause/resume without breaking main (rule §3.2.9).

### 13.4 Acceptance set (~24 q, DE/BS) — as v2.2 incl. enrichment items + one
brand-profile item ("Firma ima Mercedes fokus — šta gurati i zašto?") + one tier-honesty
trap ("Wann hat {X} zuletzt bestellt?" without Tier 2 → assistant answers from feedback,
explicitly labeled "laut Agent-Feedback", or says no data).

---

## 14. Open items
1. **Invoice access (Tier 2):** Anis checking — format matters: tabular (MVP import) vs
   PDF-only (post-MVP invoice parsing milestone §14.2).
2. Post-MVP backlog: PDF-invoice parser · per-agent personalization · TL dashboards ·
  dialer attach via `telephony/` · assistant write-tools beyond feedback · live call
  assist · product images pass · embeddings Phase B (multilingual provider choice).
3. **Google Cloud account** for Places key: existing org account or new project —
   needed at M5, not before.
4. VIS list + catalog PDF + KB folder handover — needed at M1/M3/M6 respectively.
5. brand_consumption_profiles workshop (1–2h, Anis+Sanin+top agent) — needed before M4.
   **Checked directly 2026-07-24** (Anis believed this was already done, asked to be
   corrected if not): `brand_consumption_profiles` has **0 rows** — the workshop has not
   happened yet. This is why `brand_profile_match` still doesn't fire (§6 M4 build note) —
   not just missing `companies.brand_focus`, but the curated table itself is empty too.
   **Preliminary fill + editor shipped (2026-07-25), workshop still not done — Anis:
   "do your own research for each specific brand and use this information as
   preliminary, i will give some input afterwards with sanin and agents".** Added
   `verified boolean default false` + `source text` columns (migration
   `20260725080000_brand_consumption_profiles_verified.sql`) so a preliminary,
   Claude-researched claim about a real brand is never silently presented as
   confirmed — same honesty pattern as `image_is_representative`/
   `description_is_generated` (§13 M4/M3). `scripts/seed-brand-consumption-profiles.mjs`
   seeded 10 rows across the brands that actually show up most in real
   `company_enrichment.brand_focus_guess` data (Audi 24x, BMW 20x, Mercedes 12-16x,
   VW 13x, etc.) — restricted to genuinely well-documented trade knowledge only (EA888
   TSI/TFSI oil consumption, BMW N47 timing-chain wear, common NFZ van models per
   brand, Tesla → pure EV), never a fabricated specific. New `/admin/brand-profiles`
   screen (linked under Settings in the sidebar) lists all rows with a
   Vorläufig/Bestätigt badge, inline note/weight edit, a verified-toggle, delete, and
   an add-new form (manually-added rows default `verified=true`,
   `source='Manuell erfasst (Admin)'`). Verified live end-to-end (throwaway admin
   account): add, edit, verified-toggle, and delete all confirmed working against the
   real table, test row cleaned up after. **Still not built:** the `brand_profile_match`
   signal block itself in `fn_refresh_signals()` — that's separate, bigger work blocked
   on `companies.brand_focus` being populated (still 0% - needs M5 enrichment
   verification flow to actually run), not on this table being empty. Also worth noting
   for whoever builds that block later: this table's `brand` values (e.g.
   "Mercedes-Benz") aren't yet normalized against the variant spellings that show up in
   real `brand_focus_guess` data ("Mercedes", "VW" vs "Volkswagen", "SEAT" vs "Seat") -
   that join-normalization is real future work, not solved here.
6. **Team Dashboard data source — RESOLVED 2026-07-23:** confirmed manual (agents
   type in each sale as it happens), so the Excel hand-off is now replaced by the
   in-app `fn_log_sale` entry (§4.11) — no dialer/CRM export integration needed.
7. **Katalog / Team Dashboard drill-down UI — shipped (2026-07-24).** Originally deferred
   2026-07-23 ("to necu sad"); Anis explicitly asked for it in the 2026-07-24 backlog QA
   pass. (a) `/admin/team/[agentId]` — per-agent monthly history (not just the team-wide
   leaderboard on `/admin/team`), each month rendered via `MonthCalendar`
   (`components/team/month-calendar.tsx`): compact calendar grid by default (small bar per
   day scaled to that day's revenue), click a day for an inline detail row, or toggle
   "Vollständige Liste anzeigen" for a full sortable day-by-day table — the Genesys-style
   depth-of-view Anis asked for. (b) `/admin/team/tag/[date]` — the daily cross-agent
   Tagesbonus view (same bonus table that used to only show "today" on the overview), now
   with prev/next-day arrow navigation (`←`/`→`) and a "Heute" jump-back link; next-day
   arrow disables at today (no future dates). `computeDailyBonus` extracted to
   `lib/team/bonus.ts` so the overview page and the new daily page share one
   implementation instead of drifting. Agent names on `/admin/team` (both the today-bonus
   table and the monthly tables) now link to their `/admin/team/[agentId]` page; a
   "Tagesansicht →" link on the overview jumps to today's daily page. Verified live in
   browser (logged in via a throwaway admin test account, deleted after) — calendar
   rendering, day-detail expand, full-list toggle, and prev/next/today navigation all
   confirmed working against real `agent_daily_performance` data.
8. **M3 QA gate — retroactive scoring + spot-check done (2026-07-23), gate now partially
   closed:** `extraction_confidence` was null for all 4,011 rows (never computed at ingest
   time). Rather than re-running the LLM extraction (real cost, no new data),
   `scripts/score-catalog-confidence.mjs` computes a deterministic 0–1 completeness/sanity
   score from already-committed fields (SKU shape 0.35, name sanity 0.35, description 0.15,
   pack_content 0.15) and has been run against all 4,011 products. Distribution: 1694 at
   1.0, 1795 at 0.85, 509 at 0.7, **13 at 0.5** (the low bucket — SKU doesn't match the
   catalog's real Art.-Nr. shape).
   **Spot-check result (30 samples: all 13 low-confidence rows + 1 random high-confidence
   row per category, verified against actual PDF pages via `pdftotext`):**
   - All 13 low-confidence rows are genuinely defective, confirming the heuristic works —
     two distinct root causes: (a) 2 rows (page 220/221, Verglasung — "Cuttermesser schmal
     aus Stahlblech" / "Sicherheitsmesser Martor-Qualität") have no printed Art.-Nr. in the
     extractable text at all; the LLM fell back to the item's list position number ("06"/
     "07") as a placeholder. (b) 11 rows (page 758, DIN- & Normteile nut/washer family)
     have an Art.-Nr. that's a **parametric base number** needing a Gewinde-Ø/Steigung
     suffix to be a real orderable SKU (confirmed NOT a category-wide problem — page 753's
     Gewindestift table, by contrast, fully enumerates real complete per-variant SKUs).
     **Decided (2026-07-24, Anis: "ostaviti"):** leave them as reference-only family
     entries, no exclusion built — not worth the extra filtering logic for 11 rows.
   - All 17 random high-confidence samples check out correctly on name/category/
     pack_content/description. 2 of 17 (~12%) have `source_page` off by exactly one page
     (SKU 3502-14: DB says 349, real page is 350; SKU 7713-000: DB says 641, real page is
     642) — likely from wide multi-column tables spanning a page boundary. Doesn't affect
     name/pack/description accuracy, but matters for the PDF-citation link (Katalog page,
     future KB citations in M6) landing one page early.
   Still open: no QA queue admin screen exists (spot-check was done manually via script,
   not through a UI) — build one if/when this becomes a recurring need rather than a
   one-off pass. 41% of rows have no `description`, 29% no `pack_content` — spot-check
   suggests this is genuine catalog reality (many product cards simply don't have prose
   description text), not an extraction failure.

   **Description gap closed — generated, not extracted (2026-07-25).** After the webshop
   merge (item 12 below) the gap grew to 9,545 of 11,909 products (80%, since none of the
   7,898 new webshop-origin rows carry description text either) — Anis asked for these to
   be filled with a generated sales-facing description even without real Normfest source
   text, specifically to give agents talking points on generic items (his example:
   "AUSBLASPISTOLE"). `scripts/generate-product-descriptions.mjs` (Haiku bulk-tier, 2-4
   bullet points per product, explicitly instructed to use only generic product-category
   knowledge and never invent specific technical data/certifications that could be wrong
   for the real SKU) + new `products.description_is_generated` column so the Katalog UI
   badges these "KI-generiert" and never presents them as real Normfest documentation —
   same provenance discipline as `image_is_representative`. Ran across two billing
   top-ups (same pattern as the M5 enrichment backlog): **9,544 of 9,545 generated**, one
   left blank rather than guessed.
9. **Standalone VIS-list upload CMS — shipped (2026-07-24).** `/admin/vis-import`: upload
   the weekly VIS Excel export, get back parsed/written/skipped counts + a sample of
   skipped rows, no dev session needed. Simpler shape than the catalog-ingest panel
   deliberately — no staging table/QA queue, since the underlying import has always been a
   synchronous parse-validate-upsert (on `kundennummer`), not a batched LLM-extraction
   pipeline; building a QA queue for logic that already either parses a row correctly or
   skips it with a stated reason would have been premature scope.
   Parsing/mapping/upsert logic extracted from `scripts/import-vis.mjs` into
   `lib/vis-import/core.mjs` (`parseVisWorkbook`, `writeCompanies`) so the CLI script and
   the new `app/api/admin/vis-import/route.ts` share exactly one implementation — verified
   the refactor changed nothing by dry-running the CLI script against the real
   `input/VIS.xlsx` both before and after (13,573 parsed / 1 skipped, identical). Route is
   admin-gated the same way as `/api/enrich` (session check → profile role check → service-
   role client for the actual write); `maxDuration = 300` since the full ~13.5k-row refresh
   upserts in batches of 1000. Verified end-to-end three ways: (1) a throwaway Node script
   exercising `parseVisWorkbook`/`writeCompanies` directly, including an idempotency check
   (re-running the same insert updates instead of duplicating); (2) the actual `/admin/vis-
   import` page in a real browser (logged in via a throwaway admin test account, deleted
   after) with a synthetic file attached to the real `<input type="file">` via a
   `DataTransfer`/`File` injection (browser file-picker dialogs aren't scriptable, but this
   produces a real `File` the input and its `change` handler see exactly as if a person had
   picked it) — full click-through: page loads with the real company count, submit posts
   real `multipart/form-data` to the route, response renders in the UI ("Zeilen gelesen: 1,
   Übernommen: 1, Übersprungen: 0"); (3) confirmed the row actually landed in `companies`
   via the service-role client, then deleted the test row and the test admin user. Nav
   link added ("VIS Import") under the admin section.
10. **Role model stays admin/agent only for now (decided 2026-07-23):** Anis floated TL
    being able to build Fokus lists too, but there's no TL account yet — his call was
    "ti pravi sve u ovom jednom nalogu, master... ne opterećuj se userima za sad." Build
    everything as admin (single account = master) until he decides roles later. Do not
    add a `team_leader` role or split permissions unless explicitly asked.
11. **Should Places data write into `companies` master data? — resolved + shipped
    (2026-07-24).** Anis: "moze kad vec imamo, ali iz VIS liste kao default ostaviti ako
    odstupa" — yes, write it back, but the VIS import always wins on conflict (fill-empty-
    only, same fill-empty-only pattern as the existing `brand_focus` write-back in §9, just
    without a verification gate — Places phone/website are direct factual pulls from a
    Google Business Profile, not an LLM interpretation, so there's nothing to verify the
    way there is for a brand-focus guess). Scope: **telefon + website only** — address
    deliberately excluded (migration `20260724010000_companies_website_places_backfill.sql`
    comment has the full reasoning): Places only offers one formatted address string,
    while `companies` already has structured `strasse`/`plz`/`ort`/`land` from the VIS
    import, and parsing the former into the latter risks silently corrupting good VIS data
    for no clear benefit — safer to just not attempt it. Added `companies.website` (didn't
    exist before). `scripts/backfill-places-contact-data.mjs` does the fill (re-runnable
    any time more companies get enriched — only ever touches null fields): first real run
    filled `telefon` on 44 companies and `website` on 705, out of 889 companies with
    Places phone/website data (166 already had both fields from VIS). Website now also
    shown as a clickable link on the Firmenprofil (`/firmen/[id]`).
12. **Rebuild/extend Katalog from the live webshop — DONE (2026-07-25).** Followed
    exactly the approach specified when this was deferred: (1) full extraction of the
    shop's own category/sitemap structure (§6/§13 M4: 9,735 products crawled, not
    search-backward from our SKUs), (2) compared against the existing 4,011 (§13 M4:
    1,837 exact-SKU matches, 7,898 genuinely new/unique), (3) merge. Anis: "compile now
    everything in the final form of the katalog with full products from webshop and
    catalogue pdf and finish it."

    `scripts/merge-webshop-products.mjs` inserted all 7,898 new products into the live
    `products` table (new `products.source` column, `'catalog_pdf' | 'webshop'` —
    genuine provenance distinction, §3.2.7, defaults existing rows to `'catalog_pdf'`
    accurately). Each new product needed a category assignment the webshop crawl never
    captured (`category_breadcrumb` confirmed 0% populated across all 7,898) — classified
    via a cheap Haiku bulk-tier pass into the 17 real catalog categories (closed
    `json_schema` enum, never invented). HTML entities in webshop names (e.g.
    `R&uuml;ckstell-Profil`) decoded before insert. 6 of 7,898 had only a generic
    Normfest-CI-logo "photo" (not a real product photo) — detected via the image URL and
    dropped rather than shown as if it were the product's own image.

    **Ran into the same Anthropic billing wall as the M5 enrichment backlog (§10/§13 M5),
    mid-classification (~93 of 99 batches).** Anis: "can you finish without the missing
    few, then we refill" — rather than block the whole merge on billing, made the
    classification step resilient (a failed batch leaves those SKUs uncategorized,
    `category_code`/`category_name` are nullable, rather than crashing the run) and
    inserted all 7,898 regardless. Because the account was actually at zero (not just low)
    at insert time, every classification batch failed and all 7,898 new products briefly
    had no category — still fully searchable/browsable via the Katalog's "Alle" view and
    name/SKU search, just not filterable by category tab in the meantime.

    **Backfilled the same day, right after Anis topped up billing** (his call on amount:
    asked what was needed, given a real token-based estimate of well under $1 for this
    specific pass — not a measured number, the crashed run never got far enough to log
    real billing — and told $5 was a comfortable, shared-with-everything-else top-up, not
    a per-task minimum; he added $5). `scripts/backfill-webshop-categories.mjs` (+
    migration `20260725040000_fn_bulk_set_product_category.sql`, same safe bulk-UPDATE
    pattern as `fn_bulk_set_image_path` — PostgREST upsert would trip NOT NULL on a
    partial payload) ran clean: **7,897 of 7,898 classified, 0 failed batches.** The one
    exception (`270-01`, "Hoodie weiß") is genuine merch, not a real automotive-parts
    product — none of the 17 categories actually fit it, so the model reasonably left it
    out rather than force a wrong category; left as the one honest gap, matching the same
    "don't fabricate" principle as everywhere else. Distribution is real, not a
    default-bucket artifact — spot-checked the largest category (`15 Werkzeuge`, 5,095 of
    7,898 = 65%) directly: genuine full hand-tool ranges (socket sets, wrench sets, Torx
    screwdrivers) that our narrower 4,011-product PDF extract never carried at all, so the
    skew reflects the webshop's real broader assortment, not a classification defect.

    Also re-resolved cross-sell across the full, now much larger SKU universe (old 4,011 +
    new 7,898) — **141,794 cross-sell pairs total, up from 21,794** before the merge, since
    many pairs previously had one side in the "new" bucket that couldn't resolve.

    **Result: Katalog is now 11,909 products** (4,011 PDF-origin + 7,898 webshop-origin),
    up from 4,011. Verified live in a real browser (throwaway admin test account, deleted
    after): searched and opened a real merged product (`2026-0000-094`, "Backofen- und
    Grillreiniger WM 2026") — real photo, real cross-sell tiles linking to other real
    products, category filter tabs still show the correct original 17 (view is
    `category_code is not null`, unaffected by the uncategorized rows).

    **Category backfill completed same day**, once billing was topped up:
    `scripts/backfill-webshop-categories.mjs` classified **7,897 of 7,898** webshop-origin
    products into the 17 real categories (closed `json_schema` enum, never invented). The
    one exception (`270-01`, "Hoodie weiß") is genuine merch, not an automotive part — none
    of the 17 categories fit it, correctly left uncategorized rather than forced. Spot-
    checked the resulting distribution before trusting it — the biggest category
    (`15 Werkzeuge`, 65% of the new products) is real: full hand-tool ranges (socket sets,
    wrench sets, Torx screwdrivers) our narrower 4,011-product PDF catalog never carried at
    all, not a classifier defaulting to a catch-all bucket.

13. **Dialer placeholder — shipped (2026-07-25).** New standalone nav item (`/dialer`,
    "Bald" badge) — Anis wants an eventual in-app softphone wired to the existing dialer's
    API so agents can call without leaving this tool. Concept explainer card (same pattern
    as the QA-Anrufe placeholder, §13 M9) + a working dial-pad demo
    (`components/softphone-dialpad.tsx`): the numeric keypad and backspace genuinely append/
    remove digits from the display, the "Anrufen" button is deliberately disabled (no real
    connection exists yet) — purely to show the interaction shape, no telephony
    functionality, consistent with §1's "no dialer/telephony" MVP boundary. Verified live.

    **Live-Status added (2026-08-05).** Anis got a real URL from the dialer dev
    (`http://socialnet.dialer.ba/agents.php`) and asked whether it's a realtime-monitor
    API — checked directly: unauthenticated GET, real JSON body (mislabeled
    `Content-Type: text/html`) with per-agent live status (`INCALL`/`PAUSED`/`DISPO`),
    time in status, campaign, sales/calls/conversion, and a pause/wait/dispo/dead/talk/
    active-inactive time breakdown — confirmed against real agent names in the response.
    Flagged back to Anis that the endpoint has no visible auth, exposing real per-agent
    productivity data to anyone with the URL — worth asking the dialer dev whether
    there's IP-level protection this session can't see. Read-only mirror shipped same
    day: `lib/dialer/status.ts` (`fetchDialerAgentStatuses()`, `matchDialerAgent()` -
    dialer names carry no diacritics, e.g. "Alan Sacic" vs our "Alan Sačić", matched via
    NFD-normalized comparison rather than exact string) + a new "Live-Status" card on
    `/dialer`, admin-only (same HR-adjacent-data reasoning as `agent_daily_performance`,
    §4.11), auto-refreshing every 15s via the existing `AutoRefresh` component. Does not
    start, control, or route calls — purely a read-only status mirror, does not touch the
    "no dialer/telephony" MVP boundary (§1). Verified live end-to-end with real data:
    correct sort (in-call first), correct German status labels, correct diacritic-aware
    name matching linking to `/admin/team/[agentId]`.

    **Real production crash found + fixed same day.** Anis reported `/dialer` itself
    failing to load ("This page couldn't load"). Reproduced locally rather than guessed
    at a network/timeout cause: server logs showed a real `TypeError: Cannot read
    properties of null (reading 'toUpperCase')` on `row.status.toUpperCase()` — a live
    agent (Nejra Adzemovic, logged out of the dialer) had `status: null` and
    `campaignID: null` in the real API response, a state the single earlier sample
    response never exhibited. `RawDialerRow` was typed as if every field were always a
    string; fixed by typing every field nullable and coalescing at the mapping boundary
    (`status ?? "OFFLINE"`, `campaignID ?? "-"`, etc. in `fetchDialerAgentStatuses()`) so
    a null can never reach `.toUpperCase()` downstream — added an `OFFLINE` → "Abgemeldet"
    label alongside the existing three. Also tried wrapping the card in its own
    `<Suspense>` boundary (isolating a slow/unreachable dialer host from the rest of the
    page) but reverted it after live testing showed the boundary never resolved in this
    dev environment (Turbopack dev-server streaming quirk, not explained, not worth
    shipping unverified) — reverted to the plain inline-await structure that every other
    page in this app already uses, keeping only the null-safety fix. Verified live twice:
    the exact reproduction case (null-status agent present) now renders "Abgemeldet"
    correctly instead of crashing, and server logs show zero errors afterward.

    **"Sales" column re-sourced (2026-08-06).** Anis: the dialer's own `sales` field is
    the dialer's internal counter, disconnected from what this app actually tracks -
    should pull from the same real source as Rangliste/Team Dashboard instead. Added a
    third query (`agent_daily_performance.sales_count` for today, keyed by `agent_id`)
    alongside the existing dialer fetch + agents query; each row now shows that number
    for its matched agent (falling back to the dialer's own count only if a name doesn't
    match a real agent - shouldn't happen in practice). Also dropped the auto-refresh
    interval to 10s per Anis's ask (then to 4s the same day, matching the dialer's own
    refresh rate - "toliko je i na dialeru samom, pa zasto da ne, ako nemamo neke
    troskove" - it's a plain unauthenticated GET with no per-call cost, so no reason not
    to). Verified live against the real `agent_daily_performance` values for today
    (Arnela 4, Lejla 1, Maja 2, Muhamed 2, everyone else 0) - matched exactly.

    **Konversion re-derived too, same day.** The dialer's own `conversionRate` field is
    computed from ITS internal sales counter - once Sales switched to the real number,
    Konversion silently went stale relative to it (Anis caught this: "'Konversion'
    vjerovatno isto mora sam racunati na osnovu poziva i salesa, jer ne moze to direktno
    iz dialera jer tamo nisu pravi salesi"). Now computed as `realSales / totalCalls`
    with the same `de-DE` percent formatter used elsewhere in the app. Verified live:
    Arnela 4/33=12,1%, Maja 2/53=3,8%, Muhamed 2/45=4,4%, Lejla 1/23=4,3% - all correct.
    Incidentally also confirmed the null-safety fix from the crash fix above is holding
    against real-world status values not seen before ("CLOSER" appeared live and fell
    back to the muted badge correctly, no crash).

    **Historical stats — not built, real answer is to ask the dev, not to snapshot
    ourselves (2026-08-06).** Anis asked whether we could hypothetically browse past
    live-status-style stats (a specific day, a whole month like June/July). agents.php
    only ever returns the CURRENT live snapshot - there is no historical data behind it
    on our side, and building our own periodic-snapshot table would only start
    collecting from whenever it's switched on, never backfilling June/July. The right
    move is to fold this into the same outreach already in flight for call-log/recording
    access (see the ViciDial memory) - ViciDial itself commonly retains this kind of
    agent-time/session history in its own reporting tables, so ask the dev whether an
    export/API for it already exists before building a self-snapshotting system here.

14. **QA-Bewertungen — shipped (2026-07-25).** New standalone admin menu item (real feature,
    not a placeholder — unlike QA-Anrufe/M9, nothing here is blocked on an external vendor
    decision): the TL's mandatory monthly per-agent call-quality evaluation. Anis referenced
    a Genesys evaluation-form screenshot as shape inspiration only (unrelated project, not a
    content source) and a much broader existing "Coaching 1:1" concept doc
    (`input/Osnovna dokumentacija/Normfest_Coaching_1on1_v1.docx`) as the real content
    source — v1 is deliberately smaller than both: just that document's §4 "CALL KVALITET
    RUBRIKA", the same 5-phase call structure (F1 Vorstellung, F2 Eröffnungsfrage, F3
    Bedarfsanalyse, F4 Lösungspräsentation, F5 Abschluss) the Skript/Agent Sales Guide
    already documents elsewhere in this app, 2 points/phase = 10 max. The broader monthly
    50-point KPI scorecard from the same document is a natural v2, not built now.

    New `agent_evaluations` table (admin-only RLS, same HR-adjacent reasoning as
    `agent_daily_performance` §4.11 — Anis is the sole admin/TL account for now, §14 item
    10): one row per reviewed call (agent, call date/duration/reference, 5 phase scores +
    per-phase observation notes, total /10, overall comment). `/admin/qa-bewertungen` shows
    a per-agent monthly-compliance overview (evaluated this month: yes/no, based on
    `created_at`, not the reviewed call's date) plus the full evaluation history;
    `/admin/qa-bewertungen/neu` is the scoring form; `/admin/qa-bewertungen/[id]` a
    read-only detail view. No edit/delete in v1, matching how other v1 features here
    started minimal (e.g. Fokus lists). Verified live end-to-end: created a real evaluation,
    confirmed the compliance badge flipped to "Erledigt", confirmed the detail view renders
    all 5 phases correctly — then deleted the test data.

    **Edit/delete added (2026-07-25).** `AgentEvaluationForm` gained an `initial` prop —
    when present it pre-fills every field from the existing row and switches the submit
    from insert to update, redirecting to the detail page instead of the list afterward;
    new `/admin/qa-bewertungen/[id]/bearbeiten` reuses the same form in this edit mode.
    New `EvaluationDeleteButton` (confirm-gated, same pattern as `FocusListManage`'s
    delete) added to both the detail page (redirects to the list after) and each list
    row. No new RLS needed — `agent_evaluations_admin_all` already grants admin
    update/delete. Verified live end-to-end: created a real test evaluation (3/10),
    edited it through the real edit page (scores changed, total recalculated to 9/10,
    confirmed on the detail page after redirect), then deleted it via the detail page's
    delete button (native `confirm()` is suppressed in this sandboxed browser, so verified
    by overriding `window.confirm` to return true — the same limitation that applied to
    every other confirm-gated delete tested this session) and confirmed it was gone from
    the DB.

15. **Katalog dedup detection + review UI — shipped (2026-07-25), P6 of the M8 follow-up
    plan.** Per the earlier decision (§13 M4, "solo or by hand?"): detection stays
    automated and read-only, the actual merge/delete decision stays with Anis.

    New `product_duplicate_candidates` staging table (migration
    `20260725090000_product_duplicate_candidates.sql`, admin-only RLS) +
    `scripts/detect-catalog-duplicates.mjs` — reuses the same Jaccard word-overlap
    approach already proven in `scripts/fill-representative-images.mjs`, restricted to
    cross-source pairs (one `catalog_pdf` + one `webshop` product) within the same
    `category_code` at similarity ≥0.6, keeping only each PDF product's single best
    webshop match, capped to the top 300 by score. **Real run result: only 30
    candidates found** across the full 11,909-product catalog — consistent with the
    already-documented finding (webshop cross-sell mining attempt, §13 M4) that most of
    the catalog genuinely isn't cross-represented between the two sources, not a
    detection-threshold problem. Spot-checked the full list directly before trusting
    it: several genuine 100%-name-match pairs (e.g. "Benzin-Additiv OT 100",
    SKU `2897-371` vs `100-2897-371`) alongside real one-to-many cases worth flagging to
    Anis specifically — 7 different `Blindnietmuttern-Sortiment Aluminium` size variants
    all fuzzy-matching the same one generic webshop `Blindnietmuttern-Sortiment` listing
    (67% similarity) — a real product-family-vs-generic-assortment ambiguity, exactly why
    this needs a human per pair, not an auto-merge.

    New `fn_merge_duplicate_products(keep_id, remove_id)` RPC (security definer,
    admin-gated inside the function body since security definer bypasses RLS — same
    reasoning as `fn_dismiss_signal`) atomically re-points every real FK reference
    (`sales_feedback`, `signals`, `signal_dismissals`, `focus_list_products`,
    `webshop_products_staging.matched_product_id`, `product_relations` on both
    `product_id` and `related_product_id`, deduping any would-be unique-constraint
    collision first) from the removed product to the kept one, then deletes the loser.
    New `/admin/katalog-dedup` (linked under Settings) lists every pending candidate
    side-by-side (SKU/name/category/source) with "Zusammenführen (PDF-Katalog
    behalten)" / "Zusammenführen (Webshop behalten)" / "Kein Duplikat" per row — nothing
    merges without an explicit click, and rejecting just marks the row (`status=
    'rejected'`), it never touches `products`.

    Verified live end-to-end with throwaway test products (never against real
    candidates for the merge path): created two fake products with a real
    `product_relations` row pointing at the "loser," ran the actual merge through the
    real UI, confirmed via direct DB query that the loser was deleted, the survivor
    intact, and the `product_relations` row correctly re-pointed to the survivor.
    Separately verified the reject path on one real candidate through the real UI, then
    restored it to `pending` immediately after (rejecting a real candidate was only to
    prove the button works — the actual call on that pair belongs to Anis, not a test
    click). **Known trade-off, not a bug:** `product_duplicate_candidates`'s FKs are
    `on delete cascade`, so a merged candidate's row disappears entirely rather than
    surviving with `status='merged'` as a historical record — acceptable for v1 since
    the safety-critical part (nothing merges without a click) is intact, but means there's
    currently no audit trail of past merges beyond `products`' own history.

16. **Gebiet-scoped visibility flipped on for Alan's pilot (2026-07-31).** Anis: "Napravi
    također, kad se uđe u Firmen da odmah stoji spisak firmi dostupnih (admin sve, alan
    samo alanove)" + "treba agent vidjeti samo signale za svoje firme, ne tudje" —
    `settings.visibility_mode` flipped from 'shared' to 'gebiet' for the first time since
    the very first migration (§3.2.1 always documented this as "a setting, not a
    migration", deliberately deferred until now).

    **Real, blocking bug found before the flip could work at all:** every function that
    reads the caller's own Gebiet (`fn_company_visible`, and the new RPCs below) did
    `select gebiet from profiles where id = auth.uid()` — but `profiles.gebiet` is **NULL
    for every real agent account** (confirmed directly for Alan and Elida both). The real,
    authoritative Gebiet has always lived on `agents.gebiet` (populated from the VIS
    import, linked via `agents.profile_id`, §4.11) — `profiles.gebiet` is a column that
    exists in the schema but was never actually populated. Never caught earlier because
    `visibility_mode` had been 'shared' this entire build, so the gebiet-comparison branch
    never actually ran for a real request. Flipping the setting without this fix
    (migration `20260731050000_fix_gebiet_visibility_source.sql`) would have locked every
    single agent out of every company.

    **Real performance work required before the flip, matching the Firmen-search/Dashboard
    fixes above:** `signals` grew to ~97k rows this session (cross_sell alone ~85.5k) and
    its RLS policy (`signals_select_authenticated`, previously `using (true)` — deliberate,
    "whole team sees recommendations") needed to become Gebiet-aware too. A correct but
    naive policy update (join to `companies`, check gebiet per row) measured ~3.7s for a
    single Dashboard query at this scale. Fixed via two new security-definer RPCs,
    `fn_dashboard_top_signals()` and `fn_dashboard_signals_count()`, same
    evaluate-visibility-once pattern as `fn_search_companies()`/
    `fn_dashboard_company_counts()` (migration `20260731060000_signals_gebiet_visibility.sql`).
    Split into two separate calls rather than one with `count(*) over()`, since that
    window function forced materializing and sorting the *entire* gebiet-filtered result
    set before the LIMIT could apply (measured ~2.15s combined vs ~6ms + ~580ms split —
    the count query is the remaining cost, acceptable for a once-per-Dashboard-load read).

    `/firmen` with no search query now lists every company visible to the caller (via
    `fn_search_companies('', ...)`, which skips the ilike filter entirely rather than
    matching `'%%'` against every row — the latter measured ~800ms for the default list,
    the former ~106ms) instead of showing nothing until a search is typed.

    Signal reasoning text was also removed from agent-facing views the same day (see
    §12/§13 M8 entries above) — combined, agents now see only their own companies, only
    the signals tied to those companies, and only the signal type + any concrete
    opportunity, never the underlying company-visibility mechanics or the "why this
    fired" explanation.

    Verified live end-to-end, not just via `EXPLAIN ANALYZE`: logged in as Alan's real
    account, confirmed `/firmen` with no query lists only his own Gebiet's companies (down
    from all 14,347), confirmed Dashboard signals only show his companies' signals, and
    confirmed logging in as an admin still shows everything unfiltered.

    **Test-suite fallout, all found and fixed the same session:** the whole RLS test file
    was written assuming a fixed `visibility_mode='shared'` (fixture companies picked
    arbitrarily, test agents with no linked `agents`/Gebiet row) — flipping production for
    real broke three things: `fn_company_visible`'s own "defaults to true" test, the
    "any authenticated user can read signals" assertion, and (had it not been isolated)
    the M7 chat-tool tests' arbitrary fixture company. Fixed by adding a suite-wide
    `beforeAll`/`afterAll` that saves the real value, forces `'shared'` for the whole test
    run, and restores the real value after — the two tests that specifically exercise
    `'gebiet'` mode save/restore around themselves individually. **Real, narrow
    consequence worth knowing:** any `pnpm test`/CI run now briefly forces production's
    `visibility_mode` to `'shared'` for its duration (a few minutes) before restoring it —
    consistent with how other tests already mutate real settings temporarily, but a real
    agent using the app mid-test-run would briefly see the shared-mode company list. Low
    risk (agents aren't expected to be testing during a CI run), not eliminated.

17. **Agent-facing Dashboard redesigned + "Meine Ergebnisse" added (2026-07-31),** Anis:
    "prilagodimo Dashboard za agenta... Neka to budu prve kocke" + "dodaj u Agent view dio
    'moji rezultati'... kao 'team' dio sto vidi admin, ali samo za sebe". Two changes:

    a) The top stat-tile row is now genuinely different for admin vs. agent (previously
    identical for everyone). Agent tiles, in order: Firmen gesamt, then the same
    not-contacted breakdown admin already saw per-agent in "Kontakt-Abdeckung" (this
    month / 2+ / 3+ months / 3+ share), then Feedback diese Woche — Team-Umsatz and
    Signale offen dropped (redundant with Team-Ziel/Mein Ziel right below, and with the
    Empfehlungen list). Admin's row is unchanged. Required extending
    `fn_dashboard_company_counts()` (migration `20260731090000_fn_dashboard_company_counts_breakdown.sql`)
    to return the full 3-bucket breakdown instead of a single 3-month count — same
    evaluate-visibility-once RPC pattern as the rest of this session's perf work, so an
    agent's numbers come back pre-scoped to their own Gebiet automatically. Verified live:
    Alan's tiles (1352 / 613 / 333 / 294 / 22%) match his row in the admin coverage table
    exactly.

    b) New `/meine-ergebnisse` page — the exact same structure as
    `/admin/team/[agentId]` (month cards, real per-day bonus, `MonthCalendar` drill-in),
    reusing the same `computeBonusByDate` logic, just scoped to the logged-in agent's own
    `agent_daily_performance` rows instead of admin-only access to any agent. Not
    admin-gated — if the caller has no linked `agents` row (e.g. an admin account), it
    shows an explanatory empty state instead of a raw 404. New sidebar nav item, agent-only
    (mirrors how "Team" is admin-only). Verified live: Alan's July numbers (6.845,77 € /
    48 Sales / 39,24 KM Bonus) match his row in admin's Team Dashboard exactly.

    Also: the Team-Ziel progress bar's marker labels (was a single caption line "Minimum
    80.000 € · Ziel 100.000 € · Stretch 120.000 €") now render as three small labels
    positioned directly above their tick marks on the bar itself (`components/progress-bar.tsx`
    gained visible marker labels, previously title-only tooltips), on both the admin and
    agent Dashboard — same component, one shared instance.

18. **Katalog cross-sell tile images fixed - real, measured blur, not a hunch
    (2026-08-05).** Anis reported "slike u Katalogu su blur". Diagnosed live rather than
    guessed: on the product detail page's "Könnte auch interessant sein" grid
    (`app/(app)/katalog/[id]/page.tsx`), each tile's `<Image>` had a hardcoded
    `width={96} height={96}` — but the tile's real on-screen size comes from the
    responsive grid (`grid-cols-2/3/4`), measured live at ~199px, roughly 2x what the
    code told Next.js to optimize for. Next.js only ever fetched a `w=256` source for a
    box actually rendered at 199 CSS px, which is under-provisioned the moment the
    screen's device-pixel-ratio is above 1 (any modern laptop/phone) - a real,
    reproducible cause, confirmed by reading `clientWidth`/`widthAttr` directly off the
    live DOM, not assumed. The main product photo above it (`width={128} height={128}`
    inside a `size-32`/128px-fixed container) was already correct - same
    `clientWidth`≈`widthAttr` check confirmed no mismatch there, so only the cross-sell
    tiles needed a fix. Switched those tiles to `fill` + a `sizes` prop matching the real
    grid breakpoints (`"(max-width: 640px) 45vw, (max-width: 768px) 30vw, 200px"`)
    instead of a fixed width/height guess, so Next.js generates the correct multi-
    resolution `srcset` (confirmed live: 256w through 3840w, versus always exactly 256w
    before) and the browser picks the right one for its own pixel density. Grepped the
    whole app for other `next/image` usage first (only 3 files: this one, the login-page
    logo, the sidebar logo) - confirmed this was the only place the bug existed, not a
    pattern to hunt down elsewhere.

19. **`/feedback` list page — shipped (2026-08-06).** Anis: clicking the Dashboard's
    "Feedback diese Woche" tile should open a browsable, filterable list of every
    `sales_feedback` entry (filter by agent, filter by day) - previously the only way to
    see feedback was per-company on the Firmenprofil, with no cross-company view.
    `app/(app)/feedback/page.tsx`: `searchParams`-driven filters (`agent` = the owning
    profile's id, `date` = a single day) via a plain `<form method="get">`, same pattern
    as `/firmen`'s search; paginated at 30/page. Reuses `FeedbackHistoryItem`
    (`components/feedback-history-item.tsx`, §4.7's self-correction feature) rather than
    duplicating the row markup - extended it with optional `companyId`/`companyName`
    props (only passed here; the company-profile call site omits them since company is
    already implicit there) so each row also links back to its Firmenprofil. Same
    shared-visibility/self-or-admin-edit rules as everywhere else in this app - no new
    RLS needed, `sales_feedback` was already team-readable. Dashboard's "Feedback diese
    Woche" `StatTile` (both admin and agent variants) now links to `/feedback`. Verified
    live against real data (Alan's active field-testing produced 50+ real rows same
    day): agent filter, day filter, and reset link all confirmed correct against the
    real row counts.

    **Admin-sidebar nav link added (2026-08-06)** - Anis: "Dodaj i Feedback dugme u admin
    panel da se moze tako pristupiti" (the tile-click on Dashboard was the only entry
    point). Added a `/feedback` item to `components/app-sidebar.tsx`'s Admin section
    (between Team and QA-Bewertungen) - placement only, no new access restriction: the
    page itself stays open to every authenticated user per `sales_feedback`'s existing
    team-shared RLS, same as the Dashboard tile it already linked from. Verified live: the
    real 61-row feedback list (grown from the 50+ noted above, same day's ongoing agent
    activity) renders correctly via the new sidebar link.

    **Outcome filter added (2026-08-06)** - Anis: "u Feedback dio dodaj pored agent i tag
    filtera takodjer filter po tipu ocjene: nicht relevant, abgelecht, verkauf itd." A
    third `outcome` query param (sold/interested/rejected/not_relevant, same four values
    `FeedbackHistoryItem` already renders) added alongside `agent`/`date`, same
    `<form method="get">` pattern - a plain `<select>` "Ergebnis" between Agent and Tag.
    Verified live: `?outcome=sold` correctly narrowed the real list to exactly the one
    real 'sold' row logged so far, matching the count found directly against the DB.

    **Real finding, not a bug (2026-08-06), Anis asked directly: "da li Alanove prodaje
    sada se prikazuju iz team dashboard uploada ili iz ovog sto je on u firme ubacivao kao
    feedback i verkauf? da li se to poklapa, provjeri."** Checked both sources directly for
    Alan's August data: `agent_daily_performance` (from the monthly Team Dashboard Excel,
    §4.11 - what Rangliste/Team Dashboard/dialer Sales column all read from) shows 5 sales
    / 670,44 € for the month so far (3/552,64 € on 08-04, 2/117,80 € on 08-05). His own
    `sales_feedback` rows with `outcome='sold'` (what he personally logs on a company
    profile) show only 1 row / 13,90 € (qty 2, 08-05) for the same period. **They do not
    reconcile - by design, not a defect:** these have always been two separate data
    sources per §4A (Team Dashboard = Tier-1 "official" daily revenue/sales_count, entered
    by/for the whole team's KPI tracking; `sales_feedback` = each agent's own granular,
    per-company outcome log, the flywheel's fuel). Nothing wires one into the other - an
    agent can have real sales that never get logged as `sales_feedback` (busy day, forgot,
    logged the call as "interested" instead), and that's expected today. This is exactly
    the class of gap §4A's "feedback-vs-reality discrepancy report" was already scoped for
    (deferred until Tier-2 invoice data exists, §4A point 2) - the same shape of problem,
    just against Team Dashboard rather than invoices. No code changed; reported the real
    numbers back to Anis rather than assuming they'd match.

12. **August Kracher 2026 focus list — shipped (2026-08-06).** Anis attached the real
    monthly Normfest promo flyer (`August Kracher 2026.pdf`, 9 pages - a `pdftotext`
    layout check plus a direct pdfjs page count confirmed this, correcting an earlier
    57-page estimate from a different tool) and asked to turn it into the Fokus list:
    *"Lass uns diesen August Kracher bzw. Fokuskatalog der Fokus liste in der App anhängen
    und diese Produkte in der Liste auflisten (die akutelle placeholder liste dann gerne
    löschen). Falls einer dieser Produkte nicht exisiteren sollte, dann gerne direk in
    Katalog aufnehmen... Idee = Agenten haben pdf zum versenden und preise, Liste fuer
    nachtragen wer die gewinner waren."* No `pdftoppm`/poppler in this environment (same
    gap noted in §13 M4's PDF-crop work) - reused `scripts/render-catalog-page.mjs`'s
    pdfjs-dist + `@napi-rs/canvas` approach (one-off script, not committed) to render all
    9 pages to PNG and read them directly, since `pdftotext` only has a real text layer on
    the first ~2 pages (price tags and most of the layout are vector/image graphics, not
    text).

    Extracted all 64 real SKUs across the flyer (Aquano hygiene set, seasonal Leder-/
    Aerofit-/Schraubensicherung items, Chemieartikel sprays, Klett-Scheiben set deal,
    3 glove lines with size variants, NFZ hose/coupling-head parts) with their real prices
    and pack conditions (Setpreis, per-Stk, per-Paar-ab-12, Duft-group pricing). Checked
    all 64 against `products.sku` before touching anything - **all 64 already exist in the
    catalog**, so nothing needed adding (Anis's "falls nicht existieren" branch didn't
    apply this time).

    New `focus_lists.pdf_path` column (migration `20260806010000_focus_lists_pdf_path.sql`)
    + a new public Storage bucket `focus-list-files` (created via the admin API, same
    pattern as `product-images`) holding the flyer itself
    (`august-kracher-2026.pdf`) - `/fokus` resolves it to a public URL and renders a
    "Flyer (PDF) öffnen / an Kunden senden" button on the active list's header card when
    `pdf_path` is set, satisfying the "Agenten haben pdf zum versenden" half of the ask.
    The "Liste fuer nachtragen wer die gewinner waren" half needed no new building at all -
    it's exactly the existing `focus_list_products` + "N× verkauft" quick-entry mechanism
    from §4.7/§7, just pointed at these 64 real products with their real prices as each
    row's `note`.

    Old placeholder list ("Fokus August 2026 - Hauptkategorien 1-4", 20 arbitrary
    alphabetical products from the 2026-07-31 reset, §14 item 6 note) deleted per Anis's
    explicit ask, not just deactivated - `focus_list_products`/`focus_list_items` cascade
    on `focus_list_id`, so this cleanly removed its rows too. New list ("August Kracher
    2026", note carries the flyer's real validity window "01.08. bis 31.08.2026") created
    active in its place. Verified live end-to-end (throwaway admin test account, deleted
    after): all 64 products render correctly grouped into their 8 real catalog categories
    with the correct price/pack note on each row, the PDF button opens the real uploaded
    flyer at its real public Storage URL, and "Alle Fokuslisten" shows only the new list
    (old one confirmed gone, not just hidden).

---

## 15. Glossary — as v2.2, plus: VIS LIST (customer master file, all fields incl.
Kundennummer/phone/Gebiet) · Tier 1/Tier 2 (§4A data classes) · brand profile (curated
brand→consumption-category mapping) · Flywheel (feedback-driven self-improvement loop).
