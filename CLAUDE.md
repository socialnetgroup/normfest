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
- ❌ ~~No Wiedervorlagen/tasks (old dialer owns follow-ups)~~ **Reversed 2026-08-06** —
  Anis deliberately chose to build a lightweight Wiedervorlage (callback date) into the
  app itself rather than wait on/duplicate the dialer. See §14 for what shipped.
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
- ✅ **Daily physical backups — confirmed live (2026-08-06), no PITR yet.** Anis upgraded
  the org to Pro since the 2026-07-23 deferral above; asked to "setup a backup for
  23:00 every night." Checked directly via `supabase backups list` rather than assuming
  the upgrade alone turned this on: `walg_enabled: true`, 7 real completed daily physical
  backups already present, one per day from 2026-07-30 through today, landing
  ~05:00-05:11 UTC each day — Pro's included daily backup has been running automatically
  for about a week, nothing needed building. Real constraint found: the backup **time
  isn't user-configurable** — Supabase runs it on its own internal daily schedule, there
  is no dashboard/API control to pick 23:00 specifically. `pitr_enabled: false` — true
  continuous point-in-time recovery is still a separate paid add-on ($100/mo for 7-day
  retention, up to $400/mo for 28-day, same figures as the original 2026-07-23 check).
  Presented both facts to Anis; he chose to stay on the free-with-Pro daily backup for
  now rather than add PITR cost - revisit if a tighter recovery-point requirement shows
  up before go-live. The "restore drill" half of this checklist item is now meaningful
  again (a real daily backup exists to drill against) but not yet done.

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

    **Filtered to known Normfest agents only (2026-08-06).** Anis: "Normfest dialer
    pokazuje Jelenu Stancevic. Posto i drugi koriste ovaj dialer za neke mini projekte,
    prikazuj samo ljude iz Normfesta" - the same ViciDial instance is shared with other,
    unrelated teams/projects, so `agents.php` can return rows for people who have nothing
    to do with Normfest. Previously an unmatched row still rendered (with the dialer's
    raw name, no link) as a fallback; now `/dialer` filters `dialerRows` down to only
    those that `matchDialerAgent()` resolves to a real row in our own `agents` table
    before sorting/rendering - an unrecognized name is simply dropped, not shown with a
    caveat. Verified live: the real 7-agent Normfest roster renders correctly with no
    unmatched rows, using a throwaway admin test account.

    **Standard call-center KPIs added, table widened (2026-08-06).** Anis asked "šta
    znači Aktiv/Totzeit" then, once those were explained, "predloži par stvari sto bi po
    standardnoj praksi mogli racunati" -> "dodaj sve ove podatke... prosiri sam dialer
    live status u sirinu... logičan, povezan redoslijed." First fetched the raw
    `agents.php` payload directly (not guessed) to confirm exact field shapes:
    `talkTime/pauseTime/waitTime/dispoTime/deadTime` are `HH:MM:SS` and sum exactly to
    `totalTime` (`HH:MM`, confirmed additive on real data); `activeTime`/`inactiveTime`
    are a separate `HH:MM (xx,xx%)`-formatted split (almost certainly the dialer's own
    computer-activity heuristic, not derived from the other five buckets - a real
    isolated data point, not something to recompute).

    Added `parseDialerTimeToSeconds()`/`formatSecondsAsHms()` to `lib/dialer/status.ts`
    and, per-row in `/dialer`: **Auslastung/Occupancy** = (talk+dispo)/(talk+dispo+wait);
    **Ø Bearbeitungszeit/AHT** = (talk+dispo)/calls; **Anrufe/Std.** = calls/totalHours;
    **Verkäufe/Std.** = realSales/totalHours (the one KPI here that's ours alone - the
    dialer has no concept of our real sales); **Pausenzeit/Totzeit** now also show their
    share of `totalTime` inline, e.g. "04:56:39 (55,6 %)". `/dialer`'s Live-Status card
    breaks out of the page's normal `max-w-6xl` via `mx-[calc(50%-50vw)] w-screen` so the
    now much wider table (18 columns) gets real screen width instead of just scrolling
    inside the narrow column - the rest of the page (concept card, softphone) stays at
    normal reading width. Columns render under a two-tier grouped header (Agent / Volumen
    / Ergebnis / Effizienz / Zeitverteilung / Aktivität, left-bordered between groups) for
    the "logičan, povezan redoslijed" ask, rather than one flat row of 18 labels.

    Verified live against real numbers, not just "it renders": for Arnela (talk 1:41:57,
    dispo 0:51:21, wait 0:09:53, 89 calls, totalTime 8:54) hand-checked Occupancy =
    9198s/9791s = 93,9 % and AHT = 9198s/89 = 103s ≈ 00:01:43, both matching the live
    page exactly; Pausenzeit-share 4:56:39/8:54(=32040s) = 55,6 % also matched. All from
    a throwaway admin test account, deleted after.

    **Occupancy formula corrected same day** - Anis: "Samo mi Auslastung sa 96% nejasna
    nekako." The first cut used `(talk+dispo)/(talk+dispo+wait)` as Occupancy, excluding
    `deadTime` from the "available" denominator entirely - since this dialer's own
    `waitTime` is near-zero for every agent, that formula collapsed toward ~93-99,6 % for
    everyone regardless of how the day actually went, not a meaningful signal. Switched to
    the standard call-center formula (Handle Time / (Login Time - Break Time), i.e.
    `(talk+dispo)/(talk+dispo+wait+dead)`, equivalently `totalTime-pause` as the
    denominator) - `buildDialerAgentSummaries()` in `lib/dialer/status.ts` is the one
    shared place this is computed, used by both the live page and the snapshot cron below,
    so the fix applies everywhere at once. Verified against a fresh real pull: moved
    meaningfully where `deadTime` was real (Arnela 93,9 %->64,1 %, Elida 97,4 %->88,9 %),
    barely moved for agents whose dead time was already ~0 (Rijalda, Alan stayed ~97-99 %)
    - a real, expected result of the fix, not a bug: for those agents essentially all
    non-pause time genuinely was call-productive.

    **Daily snapshot added (2026-08-06), a stopgap until the real call-log API lands.**
    Anis, same conversation: "posto nemamo logove, da li te mogu zamoliti da napravis ti
    automatski nase logove dok se dev ne vrati... samo screenshot tj snap informacija na
    kraju radnog dana." The dialer's own Live-Status has no history behind it (already
    confirmed earlier the same day - agents.php only ever returns the current snapshot),
    so a real day's numbers were simply lost every midnight otherwise. New
    `dialer_daily_snapshots` table (migration `20260806040000_dialer_daily_snapshots.sql`,
    admin-only RLS, one row per day keyed on `snapshot_date`, `agents jsonb` holding the
    exact `buildDialerAgentSummaries()` output - a real snapshot per Anis's own framing,
    not a new structured analytics table) + `/api/cron/dialer-snapshot` (Vercel Cron,
    `vercel.json`, `0 16 * * *` = 18:00 CEST currently - **will read as 17:00 once CET
    resumes in autumn, the cron schedule itself doesn't shift with DST**, worth revisiting
    then) upserts the current known-agent-filtered, KPI-computed rows for today.

    **Real bug caught before it could break in production, not guessed:** the route
    initially 302'd to `/login` on every request - `proxy.ts`'s matcher covers all paths
    including `/api/*`, and `lib/supabase/proxy.ts` redirected any request with no
    Supabase session there, which Vercel Cron triggers never have (no cookies at all).
    Fixed by adding `/api/cron` to `PUBLIC_PATHS` (bypasses the session-redirect check,
    not real auth - the route itself enforces a `CRON_SECRET` bearer-token check, same
    pattern Vercel's own docs recommend for cron routes). Confirmed the fix didn't
    accidentally open anything else: normal pages (`/`, `/dialer`) still 307 to `/login`
    when unauthenticated. Verified the route itself live: correct 401 with no/wrong
    secret, correct upsert (re-triggering twice still leaves exactly one row for today),
    real KPI-populated JSON confirmed in the DB. `CRON_SECRET` added to `.env.local` for
    local testing - **still needs to be added as a real Vercel project env var (same
    value) for the actual cron trigger to authenticate in production**, not something
    doable from this environment. No viewer UI built yet for past snapshots (v1 scope
    matches Anis's own "samo screenshot" framing - capture first, prove it's useful,
    build a browsing UI as a natural v2 if so).

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

20. **August Kracher 2026 focus list — shipped (2026-08-06).** Anis attached the real
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

21. **Wiedervorlage (callback date) — shipped (2026-08-06), a deliberate reversal of §1's
    original "no Wiedervorlagen/tasks" MVP boundary.** Motivated by real evidence, not a
    hunch: reviewing Alan's own `sales_feedback` comments for an unrelated question (below)
    turned up many genuine callback-date mentions ("Sommerpause bis 17.08.2026", "habe den
    auf Wiedervorlage am 27.08.") that nothing in the app surfaced anywhere. Anis: *"Mogli
    bi dodati opciju 'Wiedervorlage'... U tom trenutku bi taj dogadjaj kada dodje trebao
    iskociti prvi u 'Signalima' na Dashboardu."* Flagged the direct contradiction with §1
    before touching anything; Anis confirmed it's an intentional reversal and chose the
    smaller of two scopes offered (a date field + a due-today banner, not a full separate
    Wiedervorlagen screen with per-agent filters - that's a natural v2 if this proves
    useful, not built now).

    Two new columns on `sales_feedback` (migration `20260806020000_wiedervorlage.sql`):
    `wiedervorlage_date date`, `wiedervorlage_done boolean default false`. Set optionally
    on `FeedbackForm` (company profile / `/feedback`, via `fn_log_sales_feedback`) and
    editable via `FeedbackHistoryItem`'s existing edit mode (via `fn_update_sales_feedback`,
    same "edit form pre-fills, always overwrites" pattern already used for every other
    field there). A narrow new `fn_set_wiedervorlage_done(p_id, p_done)` RPC (same
    single-purpose shape as `fn_dismiss_signal`/`fn_set_day_off`) powers a quick "Erledigt"
    action both inline on `FeedbackHistoryItem` and on the new Dashboard banner, without
    needing the full edit form just to dismiss one.

    New Dashboard card "Wiedervorlagen fällig" (`app/(app)/page.tsx`, right above the
    existing Signale card, matching Anis's "top of Signale" placement) - a plain live query
    (`wiedervorlage_date <= today AND wiedervorlage_done = false`, not routed through the
    `signals` table or `fn_refresh_signals()`, which is a heavy admin-triggered batch job
    with real perf history, §12 - this needed to be simple and always-current instead).
    Team-shared visibility per Anis's explicit "sve da vidi od svih", consistent with
    `sales_feedback`'s existing shared-read RLS (unlike `companies`/`signals`, this table
    was never made Gebiet-scoped, so no new visibility work was needed). Overdue rows badge
    `destructive` (red), due-today `warning` (amber).

    **Real bug caught by the test suite, not guessed (2026-08-06):** the first version of
    the migration used `create or replace function` to add the new parameters to
    `fn_log_sales_feedback`/`fn_update_sales_feedback` - but Postgres treats a changed
    parameter list as a *different* function signature, so this silently left the old
    7-parameter versions in place *alongside* the new 8/9-parameter ones instead of
    replacing them. `fn_chat_log_sales_feedback` calls `fn_log_sales_feedback` positionally
    with the original 7 args, which became ambiguous between the two overloads
    ("function ... is not unique", caught immediately by the existing M7 chat-tool RLS
    test, not discovered live). Fixed in a follow-up migration
    (`20260806030000_fix_wiedervorlage_function_overload.sql`) that explicitly
    `drop function if exists ...` on the old 7-arg signatures before recreating - full
    suite green (41/41) afterward.

    Verified live end-to-end (throwaway admin test account, deleted after): logged real
    feedback with a Wiedervorlage set to today via the company-profile form, confirmed it
    appeared correctly in the new Dashboard banner (company link, agent, comment, date
    badge), clicked "Erledigt" and confirmed both the banner row disappeared on refresh and
    `wiedervorlage_done` flipped to `true` in the database directly - not just the UI
    hiding it.

    **Alan's comment quality, the question that surfaced this idea (2026-08-06), Anis:
    "Schaue dir ausserdem die koemntare von Alan an, ich bin mir nicht sicher, ob es richtig
    genutzt wird."** Reviewed all 69 of his real `sales_feedback` rows (68 have a comment -
    almost never skipped): genuinely well-used, specific call notes (reachability windows,
    named contacts with direct-dial extensions, contact preferences, real product
    complaints), not junk. One real nuance flagged back to Anis: 55 of 69 (80%) are tagged
    `outcome='not_relevant'` even when the comment is clearly a real follow-up
    ("Sommerpause bis 17.08.2026") rather than a genuine non-fit - worth knowing before
    anything filters/aggregates by `outcome` alone. Also confirmed `fn_chat_get_company_brief`
    already surfaces the last 8 feedback rows' comments to the AI assistant (so "history
    before the call" via the assistant already worked, pre-dating this feature) - what was
    missing, and what this feature adds, is a structured date + proactive surfacing rather
    than requiring the agent to remember to ask or re-read old comments.

22. **Sidebar collapsible on desktop (2026-08-06).** Anis: "stavi mogucnost da menu u
    aplikaciji se moze ugasiti iako je full screen" - the sidebar was previously
    always-visible at `md:` widths (only the mobile drawer could close), which mattered
    more once the dialer table (§14 item 13) started wanting real screen width. New
    "Menü ausblenden"/"Menü einblenden" toggle (`PanelLeftClose`/`PanelLeftOpen`) collapses
    `<aside>` to `md:w-0` (main content reflows into the freed space) with a small fixed
    reopen button appearing top-left once collapsed (outside `<aside>`, since a
    zero-width element can't host its own reopen control). Persisted via `localStorage`
    (`normfest-sidebar-collapsed`) so the choice survives navigation/reload, using
    `useSyncExternalStore` rather than `useState`+`useEffect` - the newer
    `react-hooks/set-state-in-effect` lint rule (React Compiler ESLint plugin) flags
    unconditional `setState` inside an effect as a non-suppressible error (a plain
    `// eslint-disable` comment did not silence it), and `useSyncExternalStore` is the
    React-sanctioned API for exactly this case (sync a component with a mutable source
    read outside React) - `getServerSnapshot` returns the SSR-safe default so there's no
    hydration mismatch, and the real persisted value takes over immediately post-mount
    with no effect-driven re-render needed.

    Verified: compiled Tailwind CSS confirmed correct byte-for-byte (`.md\:w-0 { width: 0;
    }` and `.md\:w-60 { ... }` both present inside the real `@media (min-width: 48rem)`
    block - checked directly against the raw served CSS chunk, not just trusted the
    source), and the toggle correctly flips the `<aside>` className between the two
    variants on click, with `localStorage` correctly persisting "0"/"1" across the
    toggle. **One thing not visually confirmed:** the sandboxed preview browser's
    viewport reported `window.innerWidth: 0` and `computer{screenshot}` failed ("Browser
    pane is not displayed") throughout this check, so the actual on-screen reflow
    couldn't be screenshotted this session - the CSS/class/persistence evidence above is
    strong but is not the same as seeing it render. Worth a quick visual glance next time
    the pane is available.

---

22. **Anwesenheit (attendance) tracking — shipped (2026-08-06).** Anis, modeled on a real
    reference Excel (`input/NORMFEST Arbeitszeit.xlsx`, one 6-column block per agent -
    Datum/Stunden/Minuten/Izgubljeno vrijeme/Notiz): *"TL prati dnevni dolazak na posao
    kao i godisnje odmore da upisuje da zna kakvo je stanje da li neko treba nadoknaditi
    itd... 1 radni dan (ponedeljak-cetvrtka) je po 8 sati, a petak je kraci 7 sati."*
    Two semantics questions resolved via `AskUserQuestion` before writing any schema,
    since this produces a number ("who owes hours") management treats as ground truth:
    (1) a Urlaub day counts as satisfying that day's expected hours - no deficit in the
    balance ("Urlaub pokriva dnevnu obavezu"). (2) "Izgubljeno vrijeme" (lost time, e.g.
    arriving 2h late) is tracked SEPARATELY as an owed-hours debt, never subtracted from
    `hours_worked` itself ("mislim odovojeno... ako znas npr da je neko danas kasnio 2
    sata na posao da ti 'dodje 2 sata' da nadoklanda").

    New `agent_attendance` table (migration `20260806050000_agent_attendance.sql`,
    admin-only RLS, same HR-adjacent reasoning as `agent_daily_performance` §4.11):
    `agent_id`, `date`, `hours_worked numeric(4,2)`, `lost_hours numeric(4,2)`, `note`,
    unique on `(agent_id, date)`. `lib/attendance.ts` holds the shared pure logic
    (`expectedHoursForDate()` - Mon-Thu 8h/Fri 7h/weekend 0h from `getUTCDay()`,
    `totalExpectedHours()` capped at today so the current month doesn't expect hours for
    days that haven't happened yet) so the overview and per-agent pages compute identical
    numbers. `/admin/anwesenheit` - per-agent monthly summary table (Odrađeno/Soll/Saldo/
    Nachzuholen/Urlaub-Tage) with month prev/next nav; `/admin/anwesenheit/[agentId]` -
    one card per month (always includes the current month even if empty) with the same
    summary line plus `AttendanceMonthCalendar` (`components/attendance/attendance-month-
    calendar.tsx`, modeled directly on the proven `components/team/month-calendar.tsx`
    grid shape, made editable): click a day to open an inline editor (Odrađeno h input +
    8h/7h/0h quick-fill, Nachzuholen h input, Notiz presets Urlaub/Krankheit/Kasnio/
    Sonstiges + free text, Speichern) that upserts directly via the RLS-scoped client
    (admin's `for all` policy already covers it, no RPC needed - same pattern as
    `focus-list-manage.tsx`). Urlaub-Tage counted from `note` containing "urlaub"
    (case-insensitive), not a separate boolean - kept to the two fields Anis asked for
    rather than adding a third column for what search on the existing note already gives.

    New sidebar nav item ("Anwesenheit", `CalendarCheck` icon) under Admin, between Team
    and Feedback.

    Verified live end-to-end (throwaway admin test account, deleted after): overview page
    correctly showed "Soll bisher in diesem Monat: 32,0 h" (hand-verified: Aug 1-2 are
    weekend, Aug 3-6 are Mon-Thu × 8h = 32h through 2026-08-06); opened Alan Sačić's
    detail page (initially empty, Saldo -32,0 h); clicked August 5 (a Wednesday, Soll
    8,0 h), set Nachzuholen=2 and Notiz="Kasnio 2h", saved - confirmed directly in the DB
    the row persisted exactly as entered (`hours_worked: 8, lost_hours: 2, note: 'Kasnio
    2h'`), then deleted the test row and test account. Full suite green after (41/41),
    `visibility_mode` confirmed still `'gebiet'` afterward.

23. **Sidebar collapse for desktop full-screen view — shipped (2026-08-06).** Anis:
    *"stavi mogucnost da menu u aplikaciji se moze ugasiti iako je full screen"* - the
    sidebar was previously always-visible on desktop, only the mobile drawer could close.
    `components/app-sidebar.tsx`: persisted via `localStorage` (`normfest-sidebar-
    collapsed`) through a `useSyncExternalStore`-based helper (`subscribeToDesktopCollapsed`/
    `getDesktopCollapsedSnapshot`/`getDesktopCollapsedServerSnapshot`/
    `setDesktopCollapsedPersisted`, synced across renders via a custom `window` `Event`) -
    not `useState`+`useEffect`, which hit a real, non-suppressible lint error
    (`react-hooks/set-state-in-effect` from the React Compiler plugin rejected even with
    an explicit `eslint-disable-next-line` - confirmed empirically, the disable comment
    itself got flagged as unused while the rule still fired). `useSyncExternalStore` is
    the React-documented correct pattern for syncing with an external mutable source like
    `localStorage` and produced zero lint errors. Collapse/expand buttons: a
    `PanelLeftClose` icon in the sidebar header when expanded, a floating `PanelLeftOpen`
    button fixed top-left (outside the `<aside>`, since the aside itself collapses to
    zero width) when collapsed. `<aside>` toggles between `md:w-60` and `md:w-0
    md:overflow-hidden md:border-r-0`.

    **Partially verified, honestly flagged.** DOM/class/localStorage assertions confirmed
    correct (class toggling on click, persistence across reload). Full pixel-level visual
    confirmation via screenshot could not be completed this session - the sandboxed
    Browser pane intermittently failed to composite frames (`computer{screenshot}` erroring
    "the Browser pane is not displayed") and `window.innerWidth` read `0` during that
    state, a known environment/tooling limitation rather than a code issue. The compiled
    CSS was directly inspected (curled the real `.css` chunk, confirmed the `.md\:w-0`
    rule exists correctly inside its `@media (min-width: 48rem)` block) as an alternate
    verification path. Worth a quick manual look by Anis on a real desktop browser before
    treating this as fully visually confirmed.

24. **Dialer Live-Status hardening + KPI expansion + daily snapshot — shipped
    (2026-08-06).** Three related fixes/additions to `/dialer`'s Live-Status card (§13
    item 13), same day:

    a) **Cross-tenant agent leak fixed.** The shared ViciDial instance surfaces other
    tenants' agents too (Anis: *"Normfest dialer pokazuje Jelenu Stancevic... prikazuj
    samo ljude iz Normfesta"*) - `buildDialerAgentSummaries()` now only includes rows that
    diacritic-match a real row in the `agents` table (already had the matching logic from
    the original live-status build, just wasn't being used as a filter); unmatched names
    are silently dropped rather than shown.

    b) **Standard call-center KPIs added + table widened to full viewport.** Anis asked
    for "par stvari sto bi po standardnoj praksi mogli racunati" then to add all of them
    and widen the table (`mx-[calc(50%-50vw)] w-screen` breakout pattern, rest of the page
    stays at the normal reading width). `lib/dialer/status.ts` gained
    `parseDialerTimeToSeconds()`/`formatSecondsAsHms()` and `buildDialerAgentSummaries()`
    now computes AHT, Calls/Sales per hour, Occupancy, pause/dead time shares, and splits
    total time into active vs. inactive - 18 columns total in two logical groups
    (`COLUMN_GROUPS`, grouped `<thead>` with colSpan): identity/status, call metrics,
    time breakdown.

    **Occupancy formula fixed same day - Anis: "Samo mi Auslastung sa 96% nejasna
    nekako."** First version was `(talk+dispo)/(talk+dispo+wait)`, which excludes
    `deadTime` from the denominator entirely - since this dialer's `waitTime` is near-zero
    for every agent, the ratio always collapsed toward ~93-99.6% regardless of real day
    quality, not a meaningful signal. Fixed to the standard call-center formula (Handle
    Time / (Login Time - Break Time)): `(talk+dispo)/(talk+dispo+wait+dead)`. Verified
    real numbers moved meaningfully where dead time was substantial (Arnela 93.9%→64.1%,
    Elida 97.4%→88.9%) and barely moved where already near-zero (Rijalda/Alan ~97-99%).

    c) **Daily automatic snapshot, stopgap until the dialer dev's real call-log API
    arrives (§14 item 13's ViciDial roadmap).** Anis: *"posto nemamo logove, da li te mogu
    zamoliti da napravis ti automatski nase logove... samo screenshot tj snap informacija
    na kraju radnog dana"* - clarified snapshot time as 18:00 local. New
    `dialer_daily_snapshots` table (migration `20260806040000_dialer_daily_snapshots.sql`,
    `snapshot_date` unique, `agents jsonb`, admin-only RLS) + `/api/cron/dialer-snapshot`
    (GET, `CRON_SECRET` bearer-token auth, calls the same `buildDialerAgentSummaries()`
    used by the live page, upserts on `snapshot_date`) + `vercel.json` Cron config
    (`0 16 * * *` UTC = 18:00 local).

    **Real bug found + fixed:** the cron route initially redirected to `/login` -
    `lib/supabase/proxy.ts`'s session-redirect middleware covers all of `/api/*` and
    Vercel Cron requests carry no session cookies, so every trigger would hit the login
    wall before the route's own auth even ran. Added `/api/cron` to `PUBLIC_PATHS`
    (the route's own `CRON_SECRET` check remains the real auth gate). Verified: cron
    route now returns clean 401 for bad/missing secret and 200+correct JSON for the right
    one; normal pages still correctly redirect unauthenticated users (fix didn't broaden
    access elsewhere). **Anis still needs to add the real `CRON_SECRET` value as a Vercel
    project environment variable** for this to fire in production - a real value already
    exists in `.env.local`/is documented as a placeholder in `.env.example`, but only Anis
    can set the Vercel-side one.

25. **Team Dashboard — August 2026 file imported (2026-08-06).** Anis dropped
    `input/Team Dashboard/08 2026 - Team Dashboard.xlsx` (the new monthly export, same
    format as June/July). Ran `scripts/import-team-dashboard.mjs` (idempotent upsert on
    `agent_id,date`, safe to re-run with all three months' files present) - 900 agent-day
    rows parsed/uploaded across June+July+August combined. Spot-checked the new August
    rows directly against the DB: real Aug 3-6 revenue/sales_count per agent, including
    Alan Sačić's already-documented 552,64€/3 sales (08-04) and 117,80€/2 sales (08-05)
    from §14 item 19 - confirms the import is correct and consistent with what was
    already cross-checked there.

26. **Anwesenheit Excel export — shipped (2026-08-06).** Anis: *"Dodaj mogucnosti eksel
    exporta u anwesenheit da se moze poslati nekom dalje ko trazi."* New
    `GET /api/admin/anwesenheit/export` (admin-gated via `getCurrentUser()`, same shape as
    other admin API routes) generates a real `.xlsx` server-side with the already-
    dependency-only-in-Node `xlsx` package (no prior client-side xlsx usage in this app to
    build on, so kept it server-side and streamed back as a download rather than adding a
    new client bundle path). Two modes off one route: `?agentId=<id>` exports that agent's
    full day-by-day log (Datum/Odrađeno/Soll/Nachzuholen/Notiz) across every month with
    entries; `?month=YYYY-MM` (defaults to current month) exports the cross-agent summary
    table shown on the overview page. "Excel exportieren" download links added to both
    `/admin/anwesenheit` (next to the month nav) and `/admin/anwesenheit/[agentId]` (top
    right, next to the agent name).

    Verified live end-to-end (throwaway admin test account, deleted after): both exports
    downloaded a real, readable `.xlsx` (confirmed by parsing the response bytes back with
    `xlsx` itself) with correct real data - the August overview export correctly showed
    Emina Berilo at 39h worked / +7 Saldo / 5 Urlaub-Tage (real data already logged
    through this feature), and her per-agent export correctly listed the underlying 5 real
    Urlaub rows (08-03 through 08-07) that sum to that total. Confirmed unauthenticated

    **Multi-sheet monthly export, same day - Anis: "just the overview, can we add
    different additional sheets for each employee to have dailed view too."** The
    `?month=` export now writes a real multi-sheet workbook: an "Übersicht" sheet (the
    existing summary table) plus one sheet per active agent named after them
    (`full_name`, stripped of Excel-illegal `\/?*[]:` characters and deduped against a
    real name collision, though none exists among the current 10 agents), each with a
    full calendar-day row (Datum/Odrađeno/Soll/Nachzuholen/Notiz) for every day of the
    month up to today - not just days with an entry, so weekends/un-logged days show
    correctly as 0h/Soll rather than being silently skipped, and future days in the
    current month are omitted rather than shown as false 0h deficits. The `?agentId=`
    single-agent export is unchanged. Verified live (throwaway admin account, deleted
    after): the regenerated August export has 11 sheets (Übersicht + all 10 agents);
    Emina Berilo's sheet correctly shows 08-01/08-02 as 0h/0 Soll (weekend), 08-03
    through 08-06 as 8h/8 Soll/"Urlaub" (real logged data, matching the overview sheet's
    39h/5 Urlaub-Tage), and stops at today rather than continuing through 08-31.
    Confirmed unauthenticated
    them to `/login` first, same protection as every other admin page.

27. **First real Alan pilot-feedback batch — shipped (2026-08-08).** Alan sent a large,
    unstructured list after using the app live for a few days (§ "Waiting on Alan's 3-day
    feedback" memory note is now resolved by this). Triaged into a well-defined "ship now"
    bucket and a "needs confirmation first" bucket (real historical data / ambiguous
    scope) rather than guessing on the ambiguous parts.

    **Shipped this pass:**
    - **Dashboard "Anrufe" manual counter removed** ("sada ide kroz dialer") - deleted
      `components/log-call-button.tsx` (`fn_log_call` RPC left in place, harmless/unused)
      and the "X Anrufe" text from the Dashboard's "Mein Ziel" card.
    - **Dialer daily call count now synced into `agent_daily_performance.calls_count`**
      automatically - the 18:00 `dialer-snapshot` cron (§14 item 24) now also upserts each
      agent's real `totalCalls` for today, partial-payload (only `calls_count` in the SET
      clause, `source_file` deliberately omitted so it never clobbers an existing row's
      real provenance) - so "my agent stats" reflects the dialer instead of manual clicks.
      Known, accepted trade-off: a later Team Dashboard Excel re-import can still overwrite
      past dates if that file's own "Anzahl Anrufe" column disagrees (same source-of-truth
      trade-off already accepted for telefon/website, §14 item 11).
    - **Firmen phone search** - `companies.telefon_2`/`telefon_3` added (new trigram
      indexes on all three phone columns, migration `20260808010000`), `fn_search_companies`
      extended to match against all three (migration `20260808030000`).
    - **`ANRUFEN` placeholder button** on the Firmenprofil header (`components/anrufen-
      placeholder-button.tsx`) - disabled, `title="Bald verfügbar (Hybrid-Dialer)"`, ready
      for the eventual click-to-dial integration (§14 item 13 roadmap, phase 2).
    - **Stammdaten made editable + reordered to the first visible card.** New
      `fn_update_company_contact()` RPC (migration `20260808020000`, security definer,
      same `fn_company_visible` gate as read access) - deliberately scoped to CONTACT
      fields only (telefon/telefon_2/telefon_3/email/website), not full Stammdaten. True
      VIS master-data fields (name, kundennummer, address) stay read-only/VIS-owned, same
      "enrichment never overwrites imported master data" principle as §3.2.6 - `companies`
      had no UPDATE policy at all before this, and a blanket agent-write policy on
      identity/dedup fields was rejected as too risky for what Alan actually needs (fixing
      a wrong phone number mid-call). New `components/stammdaten-card.tsx` (client
      component, pencil-to-edit toggle) replaces the old read-only Stammdaten card and now
      renders directly under the header, before Firmenbrief/Signale (was 4th section down).
    - **Verband moved into Stammdaten; rest of Segmentierung hidden from agents.** The
      Segmentierung card (Branche/Cluster/Gruppe/Klasse/Potential/Mahnstufe) is now wrapped
      in `isAdmin` and doesn't render for agents at all; `Verband` moved into the
      agent-visible Stammdaten card.
    - **Signale capped to top 8** (`MAX_SIGNALS_SHOWN`, already score-sorted, simple
      `.slice(0, 8)`) - was unbounded, causing a long scroll on companies with many
      matched signals.
    - **Stärken/Schwächen prompt tightened** (`lib/enrichment/analyze.mjs`) to explicitly
      exclude pure friendliness/mood claims without a concrete service/product link (e.g.
      "freundlich"/"nett" alone are now excluded; "schneller technischer Notdienst auch am
      Wochenende" - a claim tied to a real service - still passes). Forward-only for now -
      the ~1,432 already-analyzed companies keep their existing text unless Anis wants a
      real re-analyze pass run (real Anthropic cost, his call, not run this session).
    - **`/feedback` date filter widened to a Von/Bis range** (was single-day only) -
      `?von=&bis=` query params, either side optional.
    - **Feedback product-select dropdown verified live** (Alan's uncertainty) - confirmed
      working end-to-end via a throwaway admin account: typed "Politur", got 4 real
      matches, selected one, input correctly updated to `"{name} ({sku})"`.
    - **Chat latency: one real fix applied.** `runChatTurn()` (`lib/chat/core.mjs`)
      previously awaited same-turn tool calls one at a time in a `for` loop even though
      they're independent Supabase RPCs - switched to `Promise.all` (array order preserved,
      so `tool_result[i]` still matches `toolUseBlocks[i]`'s `tool_use_id`; confirm-only
      tools' `pendingAction` mutation stays synchronous, same "last one wins" edge case
      already documented in §10). The larger latency driver - each tool call needs its own
      full sequential model round-trip since the next action depends on the previous
      result - is inherent to the tool-loop architecture, not a bug; not re-run through the
      paid acceptance set this pass (logic verified via syntax check + code review only,
      same as the earlier objection-card language fix, §10).
    - **Admin-menu scoping audit: one real inconsistency found + fixed.** `/feedback`'s
      own RLS has always been team-shared (§14 item 19), but its sidebar nav entry was
      admin-only - agents had no persistent way in except remembering the Dashboard tile.
      Moved the "Feedback" nav item from the Admin section into the shared top-level nav
      (`components/app-sidebar.tsx`). Everything else audited (Team/Anwesenheit/QA-*/
      Settings submenu) checked out as correctly admin-only - all touch HR-adjacent data,
      real spend, or admin-curated master data, consistent with existing documented
      reasoning for each.

    Verified end-to-end (throwaway admin + agent test accounts, both deleted after,
    gebiet-matched via a throwaway `agents` row/company-gebiet swap since `visibility_mode`
    is `'gebiet'`): admin view confirmed ANRUFEN button, Stammdaten-first with Verband,
    Segmentierung still visible to admin, Signale capped at 8; agent view confirmed the
    same page renders correctly with Segmentierung fully absent (jumps straight from
    Firmenbrief to Umsatz). `fn_update_company_contact` confirmed via a real write
    (telefon_2 set, verified in DB, reverted). Full suite green after (41/41),
    `visibility_mode` confirmed still `'gebiet'` afterward.

    **Deliberately NOT touched this pass - needs Anis/Alan's explicit confirmation first
    (real historical production data, guessing wrong would corrupt it):**
    - **Restoring Alan's one deleted feedback entry.** No PITR exists (daily backups only,
      §12) and deletes are hard, side-effect-reversing (§4.7) - need the specific
      company/date/details from him to manually re-enter it.
    - **Email-Liste + Fokus auto-email + Fokus flyer generator.** Real customer-facing
      communication features needing an infrastructure decision (no transactional email
      provider exists in this app yet) and, for the auto-send specifically, explicit
      confirmation before any live send is ever triggered - Anis confirmed to start
      planning/building this, provider choice still pending (see item 29 below).

28. **Feedback outcome taxonomy redesigned — shipped (2026-08-08), confirmed with Anis
    before touching real historical data (156 real rows at the time: rejected=19,
    not_relevant=133, sold=3, interested=1).** New 5-outcome set:
    - `sold` - unchanged.
    - `rejected` ("Abgelehnt (Kein Bedarf)") - keeps its DB value, but now means "reached
      the real contact person, no sale for some reason" - reason list trimmed from 8 to 6
      (`REJECTED_REASONS`: Schon einen Lieferanten/Kein Interesse/Zu teuer/Genug Vorrat/
      Schicken Sie mir was per Mail/Ich melde mich - dropped "Keine Zeit", now its own
      outcome, and "Haben sowas probiert").
    - `not_relevant` ("Nicht angetroffen") - kept as the DB value (renaming would be a
      destructive migration of 133 real rows for no functional gain), but now DISPLAYED
      with a new meaning (nobody answered/connected) and a new reason set
      (`NOT_RELEVANT_REASONS`: Keine Verbindung/Durchgeklingelt/Anrufbeantworter). This is
      a real, deliberate relabeling of those 133 existing rows' displayed meaning - Anis
      was told this explicitly before confirming, not discovered after the fact.
    - `interested` - REMOVED from every UI selection (feedback-form.tsx, feedback-history-
      item.tsx, /feedback filter, chat-assistant.tsx, the chat tool's outcome enum) but
      kept as a legal DB value (CHECK constraint still allows it) so the 1 existing
      historical row isn't orphaned by a constraint violation on its next edit - never
      offered as a choice going forward.
    - `keine_zeit` (NEW) - reached someone, but not the real contact person.
    - `nicht_besucht` (NEW) - company wasn't contacted at all - comment is mandatory,
      enforced in BOTH `fn_log_sales_feedback`/`fn_update_sales_feedback` (raises a real
      exception, not just a UI hint) and client-side in both feedback-form.tsx and
      feedback-history-item.tsx's edit mode.

    Migration `20260808040000_feedback_outcome_taxonomy.sql`: drops/recreates the
    `sales_feedback_outcome_check` CHECK constraint, and `fn_log_sales_feedback`/
    `fn_chat_log_sales_feedback`/`fn_update_sales_feedback` (explicit `drop function` first
    for the same reason as the earlier Wiedervorlage overload bug, §14 item 21 - `create or
    replace` doesn't replace a function whose parameter list is unchanged but body logic
    changes are fine; the drop here is defensive since these signatures didn't actually
    change, but keeps the pattern consistent and self-documenting). Also updated:
    `/api/chat/confirm`'s zod enum, the `log_sales_feedback` chat tool's description +
    enum + `TOOLS` array (`lib/chat/core.mjs`), and the Firmenprofil's badge variant
    mapping (`nicht_besucht` renders `warning`).

    Verified live end-to-end (throwaway admin account, deleted after): direct RPC calls
    confirmed all four cases - `nicht_besucht` without a comment correctly rejected
    ("Kommentar ist bei \"Nicht besucht\" Pflicht"), the same call WITH a comment
    succeeded, a real `keine_zeit` row inserted cleanly, and a garbage outcome string was
    still correctly rejected by the CHECK constraint (proving the constraint update took
    effect, not just the RPC-level guard). Then confirmed the real UI: all 5 new outcome
    buttons render on `/firmen/[id]`'s Feedback erfassen form, clicking "Nicht angetroffen"
    shows the correct 3 new reason chips, and clicking "Nicht besucht" correctly flips the
    comment field to `required` with the Pflicht label and the new placeholder text. Full
    suite green after (41/41, including the pre-existing `outcome: "interested"` RLS test,
    confirming that value is still legally insertable as designed).

29. **Not yet built this pass:** Email-Liste (per-Gebiet email address list with delete),
    Fokus auto-email to that list with the generated flyer, and the Fokus flyer generator
    itself. Anis confirmed to proceed - next real step is choosing a transactional email
    provider before the auto-send half can be built; the Email-Liste + flyer-generator
    halves don't strictly need that decision first and can start independently.

30. **Real self-inflicted regression found + fixed same day (2026-08-08): Alan's Firmen
    page showed "Keine Firmen für dich verfügbar" instead of his book.** Root cause: when
    phone search was added to `fn_search_companies` earlier this same session
    (`20260808030000`), the function body was copied from the pre-fix version
    (`20260731020000_fn_search_companies_perf.sql`), which reads the caller's own Gebiet
    from `profiles.gebiet` - a column that's NULL for every real agent account (already
    found and fixed once, 2026-07-31, `20260731050000_fix_gebiet_visibility_source.sql`,
    which moved the source to `agents.gebiet` via `profile_id`). `create or replace
    function` silently overwrote that fix since my new migration used the old body as its
    template - a real lesson: when re-defining a function with `create or replace`, diff
    against the CURRENT definition (or grep for every migration that's touched it since),
    not just the most convenient prior copy to build from. Fixed in migration
    `20260808050000_fix_fn_search_companies_gebiet_regression.sql` (restores the
    `agents.gebiet` source, keeps the phone-search predicate). Verified by temporarily
    repointing Alan's real `agents` row to a throwaway test account (his own login
    untouched - the account's `profile_id`, not his `agents.gebiet`, was swapped and
    reverted immediately after), confirming the RPC now returns real companies for his
    Gebiet 130023 where it previously returned zero. Full suite green after (41/41),
    `visibility_mode` confirmed still `'gebiet'`.

31. **Stammdaten: empty Name 2/Verband/Website fields now hidden, not shown as "-"**
    (Anis, same day) - same `ausgeblendet-if-empty` pattern already used for
    telefon_2/telefon_3 (§14 item 27), extended to these three fields for a cleaner
    read-only view when a company's VIS data doesn't have them. Verified live on a real
    company with all three null (`A.Witt + Co. GmbH`) - Kundennummer/Strasse/PLZ/Land/
    Telefon/E-Mail/Gebiet still render normally, Name 2/Verband/Website correctly absent
    rather than showing empty dashes.

32. **Stärken/Schwächen pure-pleasantry cleanup on existing enrichment data — shipped
    (2026-08-08), no re-analysis cost.** Anis asked whether the ~1,432 already-analyzed
    companies' existing Stärken/Schwächen text could be cleaned up to match the tightened
    prompt (item 27) without a real Anthropic re-analysis. Yes for the clear cases: a
    conservative keyword classifier (`scripts/strip-pleasantry-claims.mjs`) that only
    strips a claim when the ENTIRE claim (not a substring) is pure friendliness/mood
    language with zero concrete service content (e.g. "Freundliches Team", "Kompetentes
    Personal") - any mixed claim that also names something concrete is left untouched,
    since a keyword match can't judge that as reliably as the LLM could.

    **Real bug caught mid-run:** the first pass fetched `company_enrichment` rows with no
    pagination, silently capped at PostgREST's default 1000-row limit - only 1,000 of the
    real 1,432 rows were ever checked, and the "5,276 total claims" figure reported to
    Anis beforehand was itself wrong for the same reason (the true figure was ~7,167).
    Fixed by paginating the fetch in 1000-row pages; a second run against the corrected
    full dataset found 48 more matches the first pass had silently missed. Total: **141
    pure-pleasantry claims removed across 92 companies**, out of the real ~7,167. Verified
    directly against the DB afterward: zero rows still contain any of the exact stripped
    claims (spot-checked "Freundliche Mitarbeiter", "Freundliches Team", "Kompetentes
    Team", "Freundlicher Kundenservice").

33. **`/feedback` scoped to "my own" for non-admin agents — shipped (2026-08-08).** Anis:
    the page/data has always been team-shared (item 19), but agents wanted their own
    feedback consolidated in one place ("umjesto od firme do firme") rather than seeing
    the whole team's. Non-admins now get `effectiveAgentFilter` force-set to their own
    `user.id` (any `?agent=` param they might pass is ignored) and the Agent picker
    dropdown doesn't render for them at all; admins keep the full picker, unchanged.
    Verified live: a throwaway agent account correctly showed exactly its own 1 real row
    (out of the team's 156, all of which currently belong to Alan - the only agent with
    real sustained usage so far) with no Agent filter visible.

34. **Two-click confirm replaces `window.confirm()` on every destructive delete — shipped
    (2026-08-08).** Anis: *"Make a 'Are you sure'/confirm deletation... since I misslicked
    and deleted 1 Feedback and now cant revert it."* This is the same incident as the
    still-open item 27 "restore Alan's deleted feedback" - a native browser `confirm()`
    dialog existed already on every destructive action in the app, but is apparently easy
    to click through without reading. New `components/confirm-button.tsx`: a click-to-arm
    pattern - first click turns the button destructive-red/pulsing (no side effect yet,
    auto-disarms after 3.5s if nothing else happens), a second deliberate click within
    that window actually runs the action. Swapped into all 6 places `confirm()` was used:
    `feedback-history-item.tsx`, `focus-list-manage.tsx`, `focus-item-remove-button.tsx`,
    `evaluation-delete-button.tsx`, `brand-profile-manager.tsx`,
    `katalog-dedup-review.tsx` (the last one covers both irreversible merge-and-delete
    buttons, not just plain deletes). Also always calls `preventDefault`/`stopPropagation`
    on both the arming and confirming click, since several of these buttons sit inside a
    clickable row/Link and must never trigger that navigation.

    **Real bug caught during verification, not assumed away:** the component's
    armed-state `aria-label` was being silently overridden by `{...props}` spreading
    *after* it, since the call sites always pass their own static `aria-label` - fixed by
    destructuring `aria-label` out of props explicitly so the armed-state label can win
    when armed. **Also a real environment gotcha hit while testing:** the sandboxed dev
    server's HMR websocket was failing silently, so the first two live-click tests were
    unknowingly running against the *old* pre-edit bundle (which still had the old
    `confirm()` code - itself a no-op in this sandbox, since native `confirm()` doesn't
    block here, explaining the observed "nothing happens on click" before a hard reload
    picked up the new bundle). Verified for real after a hard reload, using a throwaway
    `sales_feedback` row: a single click left the row in the database (armed but not
    executed, confirmed via direct query); two clicks within the 3.5s window deleted it
    for real; two clicks separated by tool-latency-induced delay (>3.5s) correctly did
    NOT delete it, confirming the auto-disarm timer works as designed, not just the
    happy path.

35. **Signale: `revenue_trend_risk` now shows real numbers inline, not just a bare badge
    — shipped (2026-08-08).** Anis: *"when it says 'Umsatzrückgang' give more context...
    now its kinda just a tag saying nothing in the overview."* Cross-Sell/Ersatzprodukt
    signals already show the concrete recommended product next to the badge; this type
    had nothing next to it since it has no `product_id`. Now renders
    `{Vorjahr} → {Laufendes Jahr}` (e.g. "476,73 € → 52,50 €") directly next to the
    "Umsatzrückgang" badge, using `company.revenue_prior_year`/`revenue_current_year`
    (already fetched for the Umsatz card, no new query) - visible to every user, not
    gated behind `isAdmin` like the fuller `reason` text, matching how the cross-sell
    product name is already agent-visible. Verified live against a real company
    (Gussstahl Handelsgesellschaft) - the inline numbers matched the Umsatz card's own
    Vorjahr/Laufendes Jahr row exactly (476,73 € / 52,50 €).

36. **Outcome label rename + inline mini-explanations — shipped (2026-08-08).** Anis: the
    "Abgelehnt (Kein Bedarf)" outcome label should just read "Kein Bedarf" everywhere
    (feedback form, history list, `/feedback` filter) - renamed. Same message also asked
    for a one-line explanation of what each outcome actually means, shown right under the
    outcome-button row and above the Produkt field, optional/non-blocking - Anis supplied
    rough source meanings and explicitly said to adapt/reword them to read naturally in
    German rather than translate literally. New `OUTCOME_DESCRIPTIONS` map added to both
    `components/feedback-form.tsx` and `components/feedback-history-item.tsx` (the latter
    duplicates it for edit-mode, same component split as the rest of that file):
    Kein Bedarf = "Mit dem Ansprechpartner telefoniert, aber aus irgendeinem Grund kam
    kein Verkauf zustande."; Nicht angetroffen = "Niemand hat sich gemeldet - es kam keine
    Verbindung zustande."; Keine Zeit = "Ein Gespräch kam zustande, aber nicht mit dem
    eigentlichen Ansprechpartner."; Nicht besucht = "Die Firma wurde heute gar nicht
    kontaktiert - bitte im Kommentar erklären, warum." (Verkauft intentionally has no
    description - self-explanatory.) Verified live: selecting each outcome on the real
    feedback form showed its exact description text.

37. **Skript — fully translated to German, all Bosnian/Croatian removed (2026-08-08).**
    Anis: *"Skript - izbaciti sav bosanski jezik, ostvariti samo njemacki svugdje."* The
    full Agent Sales Guide (kb_chunks, collection='skript', §8 M6) had only ever existed
    in its original Bosnian/Croatian source extraction - there was no German version to
    fall back to, so this was a real translation pass over live production content, not a
    delete/rewrite.

    `scripts/translate-skript-to-german.mjs` (one-off, kept for reference) sent the
    document title + all 21 chunks in one call to the `analyze` cost tier
    (`lib/ai/provider.mjs`, currently `claude-sonnet-5`) with explicit structural rules:
    preserve line count/order/quoted script sentences/bullet markers/"Label: Rest"
    lead-ins/ALLCAPS sub-headings; the two chunks with a 3-column Bosnisch-vs-Deutsch
    comparison table (Abschlusstechniken, Verkaufsvokabular) collapse to 2 columns
    (label | German only) since there's no more Bosnian column to keep; bilingual
    example-script lines prefixed "DE"/"BS" keep only the German line, prefix dropped.
    Real cost: 32,000 max_tokens (16,000 silently exhausted itself entirely on extended
    thinking with zero output text on a first attempt - real Sonnet-5 gotcha, not a
    prompt bug); required `.stream().finalMessage()` instead of a plain `.create()` call
    once max_tokens was raised, since the SDK's own >10-minute-duration guard rejects a
    non-streaming call at that size (same pattern `lib/chat/core.mjs` already uses).
    Output: 25,270-28,624 output tokens depending on run (dry-run vs. real run produced
    different, both-valid German phrasings - expected LLM non-determinism, not a bug).

    Wrote the real translated title ("Agent Sales Guide — Leitfaden für den täglichen
    Verkauf") and all 21 chunks' heading/content directly to `kb_documents`/`kb_chunks`.
    `objection_cards.response_bs` was left in the table (harmless, just no longer
    selected/rendered) since `response_de` was already good German and untouched.

    `app/(app)/skript/page.tsx`'s hand-built content parser is regex/string-matching
    keyed to literal source-language headings/structure, not markdown - had to be updated
    in lockstep with the real (as-written, not dry-run) translated text, not before it:
    - `SUB_HEADING_STRUKTURA` regex required literal "Struktura N:" (Bosnian spelling,
      trailing 'a'); German naturally produces "Struktur N:" (no trailing 'a') - caught by
      reading the real translated chunk 10 content before finalizing, not by assumption.
    - `SUB_HEADING_EXPLICIT` set updated to the real translated strings ("Goldene Regel
      des Zeitplans", "Regel für Kaltakquise").
    - `TABLE_SPECS` keys/headers updated to the real translated headings; the dead
      "4. Prigovori..." entry removed (that chunk was already filtered from rendering).
    - Objection-card JSX: removed the side-by-side DE/BS grid (now a single German
      response block), dropped `response_bs` from the `objection_cards` select, updated
      the card subtitle and the hardcoded quote block to German.
    - `search_kb` chat tool's description (`lib/chat/core.mjs`) previously told the
      assistant *"Der Inhalt der Sammlung 'skript' ist auf Bosnisch/Kroatisch geschrieben
      ... formuliere query in der jeweiligen Sprache der Sammlung"* (from the 2026-07-24
      fix, §10) - now factually wrong; corrected to state both `skript` and `wissen` are
      German.

    Verified end-to-end: a DB scan of all 21 translated chunks for Bosnian-specific
    diacritics (č/ć/ž/š/đ) found zero - confirmed no leftover Bosnian text slipped
    through. Full `/skript` page loaded live (throwaway admin test account, deleted
    after): all 4 remaining `TABLE_SPECS` tables render correctly with German headers
    (Zeit/Aktivität, Technik/Beispiel, VERMEIDEN/VERWENDEN/Beispiel, Code/Bedeutung/Was
    tust du?), both `SUB_HEADING_EXPLICIT` entries and the `Struktur N:` regex both
    detected correctly, all 21 section headings render in the TOC and full-guide list,
    objection cards show German-only responses with the correct new subtitle and quote
    block, "4. Kundeneinwände und wie man antwortet" still correctly filtered out of the
    full-guide list (duplicate of the objection-card section above it). Full suite green
    after (41/41), `visibility_mode` confirmed still `'gebiet'`. **Not yet raised with
    Anis, a separate decision:** `kb_chunks.search_vector`'s FTS config is currently
    `'simple'` (switched from `'german'` on 2026-07-24 specifically because `skript` used
    to be Bosnian) - now that `skript` is genuinely German too, switching back to
    `'german'` FTS would likely improve search-quality via stemming, but that's a real
    migration decision, not made here.

38. **Sidebar user name — real data bug fixed + centered (2026-08-08).** Anis: *"Kod
    Abmelden lijevo u meniju nek kod mene stoji Anis Rendić i neka bude centrirano
    umjesto mog maila, takodjer centriraj imena i kod drugi Armine, Alana itd."* Checked
    the real `profiles` table directly rather than assuming a display-logic bug: Alan,
    Elida, and Armina all already had a correct `full_name` ("Alan Sačić", "Elida
    Karovic", "Armina Suljević") - only Anis's own row had `full_name` literally set to
    his email string (`"anis@socialnetgroup.com"`), which is exactly why the sidebar
    (`app/(app)/layout.tsx`'s `profile?.full_name ?? profile?.email ?? user.email`,
    already correctly prioritized `full_name`) rendered his email - a real, isolated data
    bug on one row, not a code defect. Fixed directly: `profiles.full_name` set to
    "Anis Rendić" for that row. Separately, the sidebar's user-label `<span>`
    (`components/app-sidebar.tsx`) had no text alignment - added `text-center`, which
    applies to every user's name (Anis, Alan, Elida, Armina, and any future agent) since
    it's the one shared component, not per-user styling. Verified live (throwaway admin
    account, deleted after): the sidebar correctly showed the test account's real
    `full_name` with `getComputedStyle(...).textAlign === "center"` confirmed via direct
    DOM inspection.

39. **Dialer nav item hidden from agents (2026-08-08).** Anis: *"Hide 'dialer' menu thing
    for agents, since they wont have dialer menu point, just do 'anrufen' thought firmen
    profile I guess. If I find use later on, we revert."* `/dialer` (§13 item 13, §14 item
    13 — softphone placeholder + admin-only Live-Status card) was still listed in the
    shared `NAV_ITEMS` array in `components/app-sidebar.tsx`, visible to every role even
    though the page's own Live-Status card was already `isAdmin`-gated inline. Moved the
    nav entry out of the shared list into the existing admin-only nav block (same section
    as Team/Anwesenheit/QA-Bewertungen) - agents now only reach Anrufen via the
    Firmenprofil's existing `ANRUFEN` placeholder button (§14 item 27). Page itself left
    unguarded at the route level (softphone demo + concept card have no sensitive data);
    only the nav entry was scoped, per Anis's own framing ("just hide the menu thing").
    Verified live: a throwaway agent account's sidebar no longer lists Dialer at all,
    while an admin account still sees it under the Admin section with its "Bald" badge.

40. **Email-Liste — shipped (2026-08-08).** Anis: *"EMAIL LISTA - lista svih emailova sa
    agentovog gebieta + opcija brisanja maila sa te liste."* Then, clarifying scope before
    build: *"they would use all those emails to kinda copy paste into mail client. We can
    do that smarter too, but lets for now just build a copiable list per gebiet per
    agent"* - and, on format: *"keep in mind they would send through outlook."* Deliberately
    the smallest useful slice: no auto-send (§14 item 29, still pending an email-provider
    decision), just a fast, correct copy source scoped to real VIS-sourced `companies.email`
    data for a manual send.

    New `email_list_exclusions` table (migration `20260808060000_email_list.sql`) - a
    suppression table, not a mutation of `companies.email` itself, same "delete = hide,
    never touch VIS master data" principle as `signal_dismissals` vs. deleting a `signals`
    row. Team-shared read, any authenticated user can insert (any agent/admin can mark an
    email as bad/excluded), admin-only delete (no self-serve "undo" in v1 - not asked for).
    New `fn_email_list(p_gebiet text default null)` RPC (security definer, same
    evaluate-visibility-once pattern as `fn_search_companies`/`fn_dashboard_company_counts`
    rather than relying on `companies` RLS row-by-row, given this project's repeated history
    of that path degrading at scale, §12): non-admins always get their own Gebiet via
    `agents.gebiet` (param ignored, same safety pattern as the `fn_search_companies`
    regression fix, §14 item 30); admins pass an explicit `p_gebiet` (they have no `agents`
    row of their own). Filters out `do_not_contact`, inactive, soft-deleted, empty-email,
    and already-excluded companies.

    New `/email-liste` page + `components/email-list-client.tsx`: a readonly textarea with
    every email joined by `"; "` (Outlook's "An:"-field default separator, per Anis's note)
    plus a "Kopieren" button (`navigator.clipboard.writeText`), and a list of every
    company/email pair below with a `ConfirmButton`-gated (two-click) remove action that
    inserts into `email_list_exclusions` (with `excluded_by` set from the caller's own
    session) and optimistically drops the row from view. Admins get a Gebiet picker
    (populated from the real `agents` table, already team-readable per existing RLS);
    non-admins see their own Gebiet's list directly, no picker. New sidebar nav item
    (`Mail` icon) in the shared nav, next to Feedback.

    Verified live end-to-end with real data (throwaway admin + agent test accounts,
    Alan's real `agents` row temporarily repointed to the test agent account and reverted
    after, same pattern as the §14 item 30 regression fix): agent view correctly showed
    1000 real emails for Gebiet 130023, semicolon-joined and Outlook-ready; admin view's
    Gebiet picker listed the real 10-agent roster and correctly loaded the same 1000 rows
    for the selected Gebiet; the two-click delete correctly dropped a row from 1000 to 999
    in the UI AND persisted a real `email_list_exclusions` row (confirmed via direct DB
    query, including a real `excluded_by` value) rather than only removing it client-side;
    test exclusion rows cleaned up after each check to restore the true empty state. Full
    suite green after (41/41), `visibility_mode` confirmed still `'gebiet'`.

41. **Dialer-Verlauf (daily-snapshot viewer) — shipped (2026-08-08).** Anis asked how to
    view the internal dialer log (`dialer_daily_snapshots`, §14 item 24 - a stopgap daily
    capture of Live-Status, built as a placeholder for the real ViciDial call-log API,
    §14 item 13) - answer at the time was "no viewer exists yet, only a raw DB row per
    day." Confirmed live too: only 1 real snapshot existed (2026-08-06, from testing the
    cron route), consistent with "it was just 1 day since we setup" - not a sign the cron
    is broken. Anis: "sure, viewer page now" then "do it in dialer menu" (same `/dialer`
    page, not a new nav item).

    Extracted the Live-Status table's markup into a new shared `components/dialer-status-
    table.tsx` (`DialerStatusTable`, takes a plain `DialerAgentSummary[]` and an optional
    `sortByStatus` flag) so the live view and the history view render identically instead
    of drifting apart - both already consume the exact same `buildDialerAgentSummaries()`
    output shape (live from `fetchDialerAgentStatuses()`, historical from a stored
    `dialer_daily_snapshots.agents` jsonb column). `/dialer` (`app/(app)/dialer/page.tsx`)
    gained a second admin-only, full-width card "Verlauf (Tages-Snapshots)" below
    Live-Status: a `<select>` of every real `snapshot_date` (newest first, same GET-form
    pattern as `/email-liste`'s Gebiet picker) + "Gespeichert um HH:MM Uhr" from
    `captured_at`, defaulting to the most recent date when no `?datum=` is given. Empty
    state ("Noch kein Snapshot vorhanden...") handled explicitly rather than showing an
    empty table.

    Verified live (throwaway admin test account, deleted after - had to log in through
    the real `/login` form this time since cookie-injection landed on the login page for
    an unexplained reason, unlike every earlier use of that technique this session; not
    investigated further since the UI-login path is always available as a fallback):
    the real 2026-08-06 snapshot rendered correctly - date-select showed "Do., 06.08.2026",
    "Gespeichert um 16:18 Uhr", and all 7 real agents' full KPI row (Anrufe/Sales/
    Konversion/Auslastung/Zeitverteilung/Aktivität) matched what the original snapshot
    capture would have stored. Live-Status itself showed "Keine Agenten-Daten vorhanden"
    in this same check - expected, not a regression: the live ViciDial endpoint isn't
    reachable from this sandboxed dev environment, unrelated to the Verlauf feature.
    Typecheck/lint clean, full suite green (41/41) after.

42. **Fokus flyer generator — shipped (2026-08-09), §14 items 29-31 closed.** Anis: "Can
    you look at this august kracher or other normfest style flyers... use that as a
    reference template and make it that style? since prices are on, thats why i asked to
    put prices in the list of products and generate from it." Rather than search the web,
    downloaded and rendered the real `august-kracher-2026.pdf` already sitting in the
    `focus-list-files` Storage bucket (§14 item 20) page-by-page (reusing the pdfjs-dist +
    `@napi-rs/canvas` render approach from the catalog-crop pipeline, §13 M4) and used the
    real reference directly - hero page with "FOKUS" wordmark + validity dates, colored
    category header bars, product grid with a big slanted red price + real price/pack note
    as caption, dotted-style category dividers, footer disclaimer + Normfest contact bar.

    New `lib/flyer/generate-focus-flyer.mjs` (`generateFocusListFlyer(supabase,
    focusListId)`, pure deterministic layout - no LLM call) draws directly onto
    `@napi-rs/canvas`'s native `PDFDocument` (vector text, not rasterized pages - crisp,
    small file size) using **Poppins** (downloaded from Google Fonts, `assets/fonts/*.ttf`,
    committed to the repo rather than relying on system fonts - Vercel's Linux runtime has
    none of the Windows dev-machine fonts this environment defaults to, so an unbundled
    font would have rendered fine locally and broken silently in production). The cover
    page reuses Normfest's real navy/red palette and an original diagonal-stripe motif
    instead of literally recreating their photographed hero background (a deliberate
    "reference, not asset copy" choice). Price is extracted from the real
    `focus_list_products.note` string via regex (`/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/`) for
    the big display number; the full original note always renders as the caption too, so
    nothing is silently dropped or misparsed even for the irregular ones (Setpreis lines,
    per-Paar-ab-12 pricing).

    **Real image-size bug found and fixed before this was usable:** a first pass embedded
    each product's full-resolution Storage photo as-is - `drawImage`'s scale factor only
    changes where pixels land on the page, not how many pixels get embedded in the PDF, so
    a 64-product flyer came out at **38MB, 22s to generate** (some catalog photos are up to
    1.2MB). Fixed by pre-downscaling every image to ~220px via an offscreen canvas and
    re-encoding as JPEG (cached per unique `image_path` - many focus-list rows share the
    same representative photo, §13 M4) before it ever reaches the PDF context. Real result
    after the fix: **0.62MB, ~6-20s** for the same 64-product list (generation time varies
    with cold vs. warm Storage image cache).

    **Second real layout problem found by rendering and looking at it, not assumed away:**
    the first pagination always force-broke to a new page per category, so any category
    with fewer than 6 products (most of them, in the real 8-category August list) left a
    near-empty page - 15 pages total for 64 products vs. the real reference flyer's 9 for a
    similar count. Rewrote as a continuous-flow layout: a full-bleed header only at the top
    of a page, a slim inline colored divider when a new category starts mid-page with room
    to spare, and a page break only when the next row genuinely won't fit. Real result:
    **9 pages** for the same 64 products - now matching the reference's real density.

    New admin-only `/api/admin/fokus/[id]/flyer` route (POST, same auth shape as
    `/api/admin/vis-import`) generates the PDF, uploads to
    `focus-list-files/generated/<listId>.pdf` (upsert - regenerating just overwrites, not
    destructive), and updates `focus_lists.pdf_path` so the existing "Flyer (PDF) öffnen"
    link (§14 item 20) picks it up automatically. New `FocusListFlyerGenerateButton`
    (admin-only) added next to that link on `/fokus`.

    **Third real bug, only surfaced once wired into the actual route (not the standalone
    test script):** `@napi-rs/canvas` ships a platform-specific native binary - Next's
    route bundler couldn't resolve it ("Cannot find native binding... could not resolve
    @napi-rs/canvas-win32-x64-msvc"), a 500 that never happened running the generator as a
    plain `node -e` script. Fixed by adding `serverExternalPackages: ["@napi-rs/canvas"]`
    to `next.config.ts` (Next 16's stable key for "require this at runtime via plain Node
    resolution instead of bundling it").

    Verified live end-to-end through the real route (not just the standalone generator):
    created a throwaway, inactive test focus list with 6 rows copied from the real active
    list's real products/prices, logged in as a throwaway admin test account, called
    `POST /api/admin/fokus/<id>/flyer` via `fetch` from the actual running app (real
    session, real auth-gate, real Storage write) - got a real 200, downloaded the uploaded
    PDF back from Storage, rendered a page and visually confirmed the design held up
    through the full route path too. **Never touched the real active "August Kracher 2026"
    list or its real `pdf_path`** during any of this testing - confirmed directly in the DB
    both before and after that it was untouched. Test list, its generated Storage file, and
    the test admin account all deleted afterward. Full suite green (41/41) after,
    typecheck/lint clean project-wide.

    **Not yet built** (§14 item 29's other half, still pending the email-provider
    decision): the auto-email-to-Email-Liste send. Anis can already generate a flyer for
    any focus list and send it manually today - the generator was the actual ask this
    session ("lets focus on the flyer generator for now").

43. **Automated-send cost/risk assessment + generic email template — 2026-08-09.** Anis
    asked what automating the send would cost, and floated a specific idea: use the real
    Normfest mailbox's own IMAP/SMTP credentials so the tool sends "like a normal inbox."
    Assessed and answered directly rather than building it: sending itself is cheap either
    way (SMTP through the existing mailbox costs nothing extra; a dedicated transactional
    provider like SES/Resend/Postmark is also near-free at this volume, ~$0.10/1,000
    emails on SES). The real cost is risk, not money - sending a few hundred emails
    programmatically through a normal Outlook/Google Workspace mailbox is exactly the
    pattern that triggers provider-side rate-limiting or a temporary account lock, which
    would put the team's real working mailbox at risk, not just the send. Storing that
    mailbox's real credentials server-side also has a bigger blast radius than a scoped
    send-only API key (whoever holds it can read the inbox too, if IMAP). Recommended:
    skip the IMAP/inbox-client idea entirely (no need to read the inbox just to send a
    flyer); if automation is ever built, do it via a dedicated transactional provider with
    a verified sending domain, not the personal mailbox; and given the real current volume
    (per-agent, a few sends a month), copy-paste is honestly fine as the permanent
    solution, not just a stopgap - only worth automating if send frequency grows enough
    that the manual step starts costing real time. No code changed for the automation
    question itself - Anis's own conclusion after hearing the tradeoffs, not yet a final
    decision either way.

    Separately, a real concrete ask from the same message: a copyable generic email
    template "after the list" on `/email-liste`. New `components/email-template-block.tsx`
    (`EmailTemplateBlock`) - a fixed, non-personalized German subject+body (references the
    attached flyer, invites a follow-up) with its own "Kopieren" button per field, same
    copy-to-clipboard pattern as `EmailListClient`. Rendered in its own card below the
    address list on `/email-liste` - not tied to a specific focus list or company,
    deliberately generic per Anis's own framing. Verified live (throwaway admin account,
    deleted after): renders correctly with no Gebiet selected too (template doesn't depend
    on the list), both fields hold the exact real template text. Full suite green (41/41)
    after, typecheck/lint clean.

44. **Email-Liste layout reorder — 2026-08-09.** Anis: "email vorlage nach oben shieben,
    position 2 nach emails, die email loschen teil am ende" - the template (item 43) had
    landed in its own card at the very bottom; wanted it sandwiched between the copy-box
    and the per-company delete list instead. Since the copy-box and delete-list share one
    piece of client state (`rows`, so a delete immediately updates the copy textarea too),
    splitting them into separate page-level components would have broken that sync -
    `EmailListClient` now accepts a `children` slot rendered between the two halves, so
    `EmailTemplateBlock` renders inside the same component/state owner instead of a
    sibling. `EmailTemplateBlock` gained its own inline heading (previously relied on its
    now-removed wrapping Card's `CardTitle`). Verified live: order is copy-box → template
    → delete-list, confirmed via the real rendered page text.

45. **Fokus flyer: cover redesign + real image-quality bug fixed — 2026-08-09.** Anis
    reviewed the first flyer version and flagged two things: "1st page just like cover
    page, dont need that, place an atractive car picture... add photos from page 1", and
    "the pictures are blurry bad quality... dont you pick them directly from our katalog".

    **Cover redesign:** rather than source an external stock photo (real licensing
    diligence, uncertain fit, and this app has never pulled in third-party imagery),
    the cover now features a "Im Fokus" showcase strip - up to 3 real products (first 3
    with both a price and a photo) in white cards with their real catalog photo, name,
    and price, replacing the empty lower half of the gradient background. Uses real,
    already-owned photography, so no licensing question at all.

    **Real image-quality bug, found by comparing crops, not assumed:** checked the
    downscale step in isolation first (`getFlyerImage()`'s output saved directly to disk)
    - crisp, no visible artifacts. But the same image, once embedded in the actual PDF and
    rendered back, was visibly blocky/pixelated. Root cause: `@napi-rs/canvas`'s PDF
    backend appears to re-compress/re-rasterize a JPEG-encoded source image at a much
    lower internal quality when embedding it - a double-JPEG-compression effect invisible
    until you look at the final PDF output, not the intermediate step. Fixed by switching
    the downscale re-encode from JPEG to PNG (lossless) - confirmed by rendering the same
    real product photo both ways and comparing crops side by side. Also bumped the
    downscale target from 220px/JPEG-0.82 to 380px (moot for quality now that it's
    lossless, but higher resolution still helps the larger "Im Fokus" cover cards). Real
    cost: full 64-product flyer went from 0.98MB (JPEG, blurry) to 4.2MB (PNG, sharp) -
    still comfortably small for an email attachment, so kept the sharp version.

    Verified end-to-end through the real API route (not just the standalone generator):
    a throwaway, inactive test list with 6 real products, real admin session, real
    `POST /api/admin/fokus/<id>/flyer` call - downloaded the result from Storage and
    confirmed both the new cover layout and image sharpness held up through the full
    route path. Never touched the real active "August Kracher 2026" list - confirmed
    untouched in the DB before and after. Test list, its Storage file, and the test admin
    account all deleted afterward. Full suite green (41/41), typecheck/lint clean.

    **Separately, a real question answered, not built:** Anis asked what automating the
    flyer's price-line extraction "costs" and whether it uses the Claude API - clarified
    directly that flyer generation is pure deterministic code (canvas drawing + regex over
    already-stored `focus_list_products.note` text), zero LLM calls, zero AI cost. No
    image generation happens either - the product photos are real, already-owned catalog
    assets, not AI-generated or fetched from an external API.

46. **Fokus flyer: full visual redesign to a "premium automotive B2B" system, per a
    detailed 21-section brief — 2026-08-09.** Anis provided an explicit design brief
    ("modern, premium... German workshop... Swiss/German editorial design... avoid cheap
    supermarket flyer... avoid rainbow palette... premium B2B e-commerce cards") with hard
    constraints: never change product names/SKUs/prices/validity dates, never invent or
    remove products, preserve the Normfest brand.

    **Real image-sourcing finding, decided before writing any code:** the brief's §2/§20
    asked for a real "modern European workshop, car on lift" stock photo as the cover
    hero. Searched Openverse (CC0/PDM/BY-licensed sources) with several query variations -
    every result was either clipart/stickers or unrelated old-car/historic photos, nothing
    resembling "premium commercial photography." Rather than ship a mediocre photo that
    would undercut the brief's own "premium" goal, built an original illustrated hero
    instead: a dark charcoal gradient, a subtle blueprint grid texture, a soft red
    spotlight glow, and a simplified line-art car-on-a-lift icon (geometric shapes -
    rounded-rect body, trapezoid cabin, two wheel circles, two lift posts - deliberately
    abstract rather than attempting a photorealistic silhouette, which is safer to render
    correctly in canvas and reads as a technical diagram, matching the brief's own
    "industrial precision" language). Flagged this deviation to Anis directly rather than
    silently substituting.

    **What changed, following the brief section by section:**
    - **Design tokens** (`TOKENS` object in `lib/flyer/generate-focus-flyer.mjs`):
      charcoal/white/neutral-gray palette + one red accent (brief §4/§14/§15) - the old
      6-color `CATEGORY_COLORS` rotation was removed entirely (violated the brief's
      explicit "avoid rainbow palette, restrained" instruction).
    - **Cover** (§2-3): campaign name (`list.name`, real data) is now the dominant
      headline at 58px bold, not a generic "FOKUS" wordmark: NORMFEST® → campaign name →
      validity → real product/category stat row → "Im Fokus" showcase (unchanged from the
      prior pass). Dark charcoal hero replaces the earlier navy-blue gradient.
    - **Category banners** (§7): numbered (01, 02, ...) charcoal bars with a blueprint-
      grid texture and red accent underline, replacing the per-category color rotation -
      one consistent dark treatment instead of "rainbow." No fabricated taglines under
      category names (the brief's own example subtitles are explicitly "placeholders...
      only if derivable from actual content" - nothing in the source data supports one, so
      none was added, consistent with §6/§12's "do not invent marketing claims").
    - **Product cards** (§5): white cards with a real drop shadow (`shadowBlur`/
      `shadowOffsetY`), rounded corners, generous padding, price now upright bold (not the
      old italic "discount flyer" slant) at ~2x the visual weight of the product name,
      anchored to a fixed baseline near the card bottom so prices align across a row
      regardless of name-wrap length (§15's "all prices in a column should align").
    - **Badges** (§12): a "SET" badge (`detectBadge()`) fires only when the real price
      note contains the literal word "Setpreis" - no invented "TOP-ANGEBOT"/percentage
      claims, per the brief's own "only use claims factually supported by the source."
    - **Typography**: kept Poppins (already bundled, in the brief's spirit of "modern
      professional sans-serif") rather than fetching a new font family - no functional
      difference from Inter/Manrope for this use.
    - Page count, pagination algorithm, image downscale/PNG-embedding fix (item 45), and
      footer are unchanged - already met the brief's requirements (multi-page, no single-
      poster reduction, sharp real photos, unchanged contact block).

    Verified end-to-end through the real API route with a throwaway inactive test list
    (never the real active "August Kracher 2026" list - confirmed untouched in the DB
    before/after): rendered cover and category pages, confirmed the numbered banners,
    shadowed cards, dominant upright price, and SET badge all render correctly. Full suite
    green (41/41), typecheck/lint clean.

47. **Fokus product price/note editable before flyer generation — shipped same day.**
    Anis, mid-redesign: "ich muss irgendwo, vor dem erstellen des flyers, die moglichkeit
    haben, preise einzufugen/oder wegzulassen. Falls ich preis anschreibe, dann wir es bei
    der erstellugn des flyers uebernommen." The flyer's price display has always been
    extracted from `focus_list_products.note` via regex - there was just no UI to edit
    that field after a product was added to a list, only to remove the whole row. New
    `components/focus-product-note-edit.tsx` (`FocusProductNoteEdit`, admin-only, same
    pencil-toggle pattern as `FocusListManage`'s rename) replaces the previously read-only
    "SKU · note" line on `/fokus` with a clickable/editable one; saving with an empty
    value sets `note` to `null` via a direct RLS-scoped update, which makes
    `extractPrice()` return `null` and the price/divider section is cleanly omitted from
    that product's card on the next-generated flyer - exactly "add or leave out a price"
    per Anis's ask, no separate "hide price" flag needed since the existing extraction
    logic already handles a missing note gracefully.

    Verified live end-to-end (throwaway admin account + inactive test list, temporarily
    activated to exercise the real `/fokus` UI and reverted immediately after - confirmed
    the real active list untouched before/after): edited one product's note to a test
    price and confirmed it persisted to the DB; cleared a second product's note entirely
    and confirmed `note` became `null`; regenerated the flyer through the real API route
    and confirmed the edited price showed correctly on the card and the cleared one
    rendered cleanly with no price line and no layout gap. Full suite green (41/41) after.

48. **Fokus flyer: item 46's "premium" redesign rejected, replaced with a 1:1 copy of
    Anis's own reference mockup — 2026-08-09.** Anis, after seeing item 46's charcoal/
    editorial redesign live: "I mean the last one was better, you did shit designing.
    changed literraly the color of the front page lol." Reverted
    `lib/flyer/generate-focus-flyer.mjs` to the prior, previously-approved version (`git
    show 3e662ee:lib/flyer/generate-focus-flyer.mjs`, byte-identical PDF output confirmed
    against the pre-redesign baseline) rather than trying to patch the rejected direction.

    Anis then supplied a real reference: a ChatGPT-generated mockup image (a 3x3 grid of
    9 flyer pages, built from this app's own real product/price data) saved to
    `input/ChatGPT Image Aug 9, 2026, 12_51_01 PM.png`, with the explicit instruction:
    "copy it 1:1 in flyer format... just make the prices red" (the reference itself shows
    plain black prices - red is Anis's one deliberate deviation). Cropped and visually
    inspected individual cells at 2-3x zoom (cover, a mid-page category spread, the final
    page) before writing any code, rather than guessing from the thumbnail - this
    surfaced a real structural finding: the reference's product cards are laid out
    **image-LEFT / text-RIGHT** (name, Art.-Nr., price, unit note stacked beside the
    photo), fundamentally different from every card layout built earlier this session
    (which stacked the image on top of the text). Full rebuild of
    `lib/flyer/generate-focus-flyer.mjs` around this reference:
    - **Category headers**: near-black bar (`DARK_BAR`) with a blue rounded-square
      numbered badge (`BLUE_BADGE`, "01", "02", ...) + bold white category name -
      replaces both the earlier `CATEGORY_COLORS` rainbow rotation and item 46's charcoal
      treatment.
    - **Product cards**: light gray card (`CARD_BG`/`CARD_BORDER`) with the photo boxed
      on the left and name/Art.-Nr./price/note stacked to its right - a genuine rewrite
      of `drawProductCell`, not a palette swap.
    - **Prices**: bold red (`RED`), the one explicit deviation from the reference.
    - **Closing CTA banner**: a new `drawOnlineOrderBanner()` - dark bar with a
      vector-drawn cart icon + "ALLES ONLINE BESTELLEN: www.normfest-shop.com", matching
      the reference's final page, rendered once between the last product grid and the
      footer.
    - **Cover**: real photo, not baked reference text. The reference's own cover cell has
      Anis's chosen headline/dates/stats already rendered as pixels (it's an AI-generated
      image) - a naive full-cell crop as a background produced double text once this
      code's own dynamic vector text (real `list.name`/dates/counts, so the flyer stays
      data-driven for any future list) was drawn on top. Fixed by cropping only the
      clean photographic region (the mechanic-and-car portion, avoiding the reference's
      own wordmark/badge/stat-row pixels) to `assets/flyer/cover-bg.png`, then rebuilding
      the cover as a two-panel layout - solid dark left panel for our own text, the real
      cropped photo as a right-hand strip with a soft seam gradient - rather than a
      full-bleed background, since the crop's own aspect ratio doesn't stretch cleanly to
      full A4 without distorting the photo. Anis's explicit go-ahead to use this specific
      file covers only this cropped photo region, not the reference's baked-in text.

    Verified end-to-end: rendered the standalone generator's output to PNG (cover +
    interior + final page) and visually confirmed no leftover baked text, correct
    image-left/text-right cards, and the CTA banner in the right place - then re-verified
    through the real `POST /api/admin/fokus/[id]/flyer` route (throwaway inactive test
    list with 6 real products cloned from the real active list, throwaway admin session
    created and deleted after) to confirm the route's own auth/Storage-upload path
    produces the same result, not just the standalone script. Confirmed the real active
    "August Kracher 2026" list's `pdf_path` was byte-identical before and after every
    test run. Typecheck/lint clean, full suite green (41/41).

49. **Fokus flyer: real AI image generation (OpenAI gpt-image-1.5) for the hero + category
    accent photos — shipped 2026-08-09.** Anis, after item 48: "not the quality I expect
    (low resolution hero image etc.)... Lets use AI image generation etc where its needed
    to make it a real deal flyer... take the best of 2 worlds" - proposed a fuller
    "design director" architecture (a planning LLM call + generated design-spec JSON +
    multiple generated images). Recommended a narrower v1 instead (confirmed via
    `AskUserQuestion`): keep every deterministic element from item 48 exactly as-is (dark
    numbered category bars, image-left/text-right product cards, prices/SKUs/names -
    never AI-rendered, same §3.2.6 "never fabricate" discipline that already ruled out
    letting a model draw real prices) and only replace the **cover hero photo** with a
    real generated image. Anis's actual answer: go further than that baseline too - "Hero
    + category accent images" (one generated photo per category, blended into that
    category's header bar) and **regenerate on every click, not cached** ("so every flyer
    looks different... seasonal themes where applicable"), explicitly not price-sensitive
    ("dont worry about the price, i have 5euro credit"). He also uploaded the real
    Normfest logo file (`input/Normfest Logo.png`) specifically so it - not an
    AI-fabricated wordmark - appears on the cover.

    `OPENAI_API_KEY` added to `.env.local` (gitignored, same as every other provider key
    per §12 key hygiene). Researched the current real API before writing any code (model
    names/pricing drift fast, confirmed via web search + the official
    `developers.openai.com` docs rather than trusting a remembered/guessed model string):
    `gpt-image-1` is being retired Oct 2026, so `gpt-image-1.5` is the correct current
    flagship - per-image pricing quoted online was ~$0.03/image medium quality vs.
    ~$0.13/image high, which is why `lib/ai/provider.mjs`'s new `IMAGE_QUALITY` constant
    defaults to `"medium"`.

    **Real cost correction (2026-08-09, item 53's follow-up), Anis checked the actual
    OpenAI billing dashboard:** a single full flyer regeneration (1 hero + 8 category
    accents = 9 images at medium quality) cost **$0.49 real, not the ~$0.27-0.36
    estimate** the $0.03/image quoted figure implied - roughly 1.5-2x higher, the same
    class of "trust a real bill over a quoted/estimated rate" correction this project has
    hit before with Anthropic and GCP costs (§13 M5/M8). At $0.49/regeneration, $5 of
    credit covers roughly 10 full flyer regenerations - relevant since Anis's explicit
    ask was to regenerate art on every single "Flyer generieren" click, not cache it.

    New `lib/ai/provider.mjs` additions: `IMAGE_MODEL = "gpt-image-1.5"`,
    `IMAGE_QUALITY = "medium"`, `getOpenAIClient()` - same one-place-to-swap-the-model
    pattern as the existing Anthropic tiers, kept as its own export since image generation
    doesn't fit the bulk/analyze/chat text-tier enum. New `lib/ai/flyer-images.mjs`:
    `generateHeroImage(listName)` (portrait `1024x1536`) and
    `generateCategoryAccentImages(categoryNames)` (landscape `1536x1024` each, concurrency
    capped at 3 - a brand-new OpenAI org sits on a low Tier 1 images-per-minute cap).
    Every prompt carries an explicit "no text, no numbers, no logos, no watermarks"
    directive - gpt-image models are known to garble rendered text, and this app was
    never going to let an AI draw a real price anyway. Both functions degrade gracefully
    per-image on failure (`null` in the Map/return value) rather than failing the whole
    flyer - a category simply renders its header without a photo texture, the cover falls
    back to the item-45/46 static cropped photo.

    **Three real bugs found and fixed via direct testing, not assumed away** (same
    "test 2-3 before scaling" discipline as every earlier AI-batch feature in this app):
    1. **Silent-failure gap in the fallback path.** The first cut only fell back to the
       static cover photo when `heroImageBuffer` was `null` (i.e. when
       `generateHeroImage` itself had already given up) - but if the AI buffer came back
       non-null and merely failed to *decode*, the code fell straight to the plain
       gradient instead of trying the static photo. Fixed: `drawCoverPage` now tries the
       AI buffer, then the static file, then the gradient, in that order, with the
       intermediate failure logged instead of silently swallowed.
    2. **Real, reproducible decode failure, root-caused by inspecting raw PNG bytes, not
       guessed:** `@napi-rs/canvas`'s `loadImage()` threw a misleading `"Invalid SVG
       image"` error on every gpt-image-1.5 output. Dumped the PNG chunk list directly
       (`IHDR/caBX/IDAT/IEND`) and found the cause - OpenAI embeds a `caBX` chunk (a real,
       spec-legal, ~25KB C2PA content-provenance manifest) ahead of `IDAT`, and
       `@napi-rs/canvas`'s parser can't handle a PNG carrying it. Fixed by stripping every
       chunk except `IHDR/PLTE/tRNS/IDAT/IEND` before decoding
       (`stripUnsupportedPngChunks()`) - confirmed by re-testing the exact same buffer
       before/after the strip (fails / succeeds). Also broadened the existing 429-only
       retry to retry once on any failure, since this is exactly the class of transient,
       real-world API flakiness that warrants one.
    3. **Unscaled embeds produced a 22.8MB PDF** - the same "PDFDocument embeds pixel data
       at face value" bug already fixed once for product photos (item in §13 M4) recurred
       here, since the hero/accent images are fresh ~2MB PNGs each and nothing was
       downscaling them before `drawImage`. Added `downscaleToPng()` (same
       offscreen-canvas + lossless-PNG-reencode approach as `getFlyerImage()` in
       `generate-focus-flyer.mjs`, not JPEG - the JPEG-double-compression bug from item 45
       applies here too) with different real targets per use: hero capped at 900px long
       side, category accents at 500px (they render into a ~58pt-tall bar, so a full
       1536px source is pure waste). Brought the full 64-product flyer from 22.8MB back
       down to ~7MB.

    `drawTopCategoryHeader()` gained an `accentImage` parameter - the photo is clipped
    into the right ~68% of the dark bar at 55% opacity with a left-edge fade back into
    `DARK_BAR` so the numbered badge and category name stay fully legible, mirroring how
    the original reference mockup (item 46 predecessor) blended a shared texture into its
    bars, but with a real distinct photo per category now. `drawCoverPage()`'s old plain
    "NORMFEST®" text wordmark was replaced with the real logo file
    (`assets/flyer/normfest-logo.png`, copied from Anis's upload) composited onto a small
    white rounded card - falls back to the text wordmark only if the logo file itself
    can't load, never to an AI-drawn substitute.

    `app/api/admin/fokus/[id]/flyer/route.ts`'s `maxDuration` bumped 60s → 300s - a full
    generation (1 hero + up to ~8 category accents, partially parallel at concurrency 3)
    measured 85-98s across several real runs in this session, comfortably under budget but
    well past the old 60s ceiling.

    Verified end-to-end exactly like item 48: first the standalone generator against the
    real active "August Kracher 2026" list's real 64 products (read-only, nothing
    written) - rendered pages visually confirmed the sharp AI hero, the real logo card,
    and real category-relevant accent photos (bolts/washers for "DIN- & Normteile",
    tools for "Werkstattausrüstung") blended correctly into each bar, with every product
    name/SKU/price still 100% deterministic and unchanged. Then re-verified through the
    real `POST /api/admin/fokus/[id]/flyer` route with a throwaway inactive test list (4
    real products cloned from the real active list, throwaway admin session created and
    deleted after) - confirmed a *second*, genuinely different AI hero photo rendered
    correctly through the full auth/Storage-upload path, and confirmed the real active
    list's `pdf_path` was untouched before and after. Typecheck/lint clean, full suite
    green (41/41).

50. **Ambiguous Places queue: real scale discovered + a free name-similarity
    auto-resolve pass — 2026-08-09.** Anis, looking at Alan's 1,000-company book: "you
    left me with 1000 companies to decide by hand whats the right google maps" - flagged
    as too much manual labor. Investigated with real numbers rather than guessing: the
    ambiguous queue (§9, `company_enrichment.places_ambiguous`) is **1,291 companies
    whole-book**, not the 55 last documented (§14 item 5's memory note) - the whole-book
    Places rollout (§13 M5, 2026-07-27, 13,546 companies) grew this ~23x and it was never
    flagged back as a new backlog. Alan's own book only accounts for 52 of the 1,291 - the
    rest is spread across the other nine agents.

    Ran the existing free same-address auto-merge script
    (`scripts/rescan-ambiguous-same-address.mjs`) first - **found a real bug in that
    script itself**: an unpaginated fetch silently capped at PostgREST's 1000-row default
    (same class of bug already hit and fixed multiple times elsewhere in this app),
    understating the real 1,291 as 1,000. Fixed via the same `.range()` pagination
    pattern used everywhere else. Re-run against the full, correct set: **0 matches** -
    a real, notable finding, not a bug this time. Diagnosed why by inspecting real
    `places_candidates` payloads directly: for the whole-book rollout, many companies got
    3-20 Places search candidates spread across genuinely different addresses/postal
    codes/even different towns (e.g. "KFZ Style Hamm" got 12 candidates across 6 streets
    and 3 postal codes in Hamm; another company's candidates spanned three unrelated
    towns) - these are different, unrelated businesses that happened to match a loose
    text search, not the same real business under two Google listings. `pickResolution()`
    (`lib/enrichment/places.mjs`) only ever auto-resolved on exact PLZ match or identical
    address - it never checked candidate NAME similarity against the real company name,
    the most obviously decisive signal for telling "wrong business" apart from "right
    business, different listing."

    New `scripts/rescan-ambiguous-by-name.mjs` - same "free, re-reads already-stored
    `places_candidates`, zero new Places API calls" shape as the address-merge script,
    reusing the exact normalize/Jaccard word-overlap scoring already proven in
    `scripts/detect-catalog-duplicates.mjs`/`fill-representative-images.mjs`, with a
    company-name-appropriate stopword list (legal-form words like `gmbh`/`kg`/`ohg` and
    generic Kfz-industry words like `auto`/`autohaus`/`kfz`/`werkstatt` filtered out -
    without this, two unrelated auto shops would score artificially high just from
    sharing "autohaus"). Deliberately conservative auto-resolve rule: only fires when the
    top-scoring candidate's name match is decisive (score ≥ 0.5 AND at least double the
    runner-up) - a wrong auto-pick here means showing an agent a stranger's Google
    reviews as if they were the real company's, so it errs toward leaving genuinely
    unclear cases in the manual queue rather than guessing.

    Dry-run first, inspected the real output before writing anything: **244 of 1,291
    (19%) auto-resolved**, the vast majority exact or near-exact name matches ("Harald
    Pawelzik" → "Harald Pawelzik", "Autohaus Mezger GmbH" → "Autohaus Mezger GmbH",
    "AllCars GmbH" → "AllCars GmbH", etc.) - spot-checked several by eye and all looked
    genuinely correct. Two borderline cases flagged before applying (generic
    municipal-entity names - "Freiwillige Feuerwehr" → "Freiwillige Feuerwehr
    Wilhelmsburg", "Feuerwehr Hamburg" → "...Einsatzabteilung (F02)" - where the
    "decisive" name match is real but the underlying entity is large enough that a wrong
    branch pick is plausible) - accepted as an acceptable minority risk given the overall
    hit quality, not silently ignored. Ran for real after the dry-run review (Anis: "do
    the zero api cost script"): **244 real rows updated, verified via direct query
    (ambiguous count 1,291 → 1,047, spot-checked "Harald Pawelzik" resolved correctly in
    the DB)**.

    Whole-book ambiguous queue: 1,291 → 1,047 (a 19% cut at zero additional API cost).
    **Remaining 1,047 genuinely don't have a decisive automatic answer** - either no
    candidate's name resembles the real company closely enough, or several score
    similarly (multiple real candidates, no clear winner) - these still need a human, but
    the queue is now smaller and (per the scoring logic) skews toward genuinely hard
    calls rather than being padded with cases a simple name check could have already
    settled. Not yet addressed: whether the *initial* Places text search itself could be
    tightened (e.g. location-biased search near the VIS address) to return fewer
    unrelated candidates in the first place, which would reduce how often this situation
    recurs for newly-enriched companies - flagged as a follow-up, not built this pass.
    Typecheck/lint clean, full suite green (41/41) - this pass only touched
    `company_enrichment` data via existing legitimate script paths, no schema/RLS changes.

51. **Same-day follow-up on item 50: fixed the display cap, baked the fix into live
    resolution (not just the backlog sweep), and added confidence highlighting -
    2026-08-09.** Anis: "in the enrichment menu tab, if make it to show number greater
    then 1000, atm it just shows 1000 while beeing 1000+" + "i will do the api enrichment
    for all agents, what need to be done to minimazie this in preparation to the massive
    import" + "can you highlight where you think the match is 80%+ for manual check."

    **The display bug was the same PostgREST-1000-row-cap class of bug as item 50's
    script fix, just in the UI this time.** `/admin/enrichment`
    (`app/(app)/admin/enrichment/page.tsx`) fetched the ambiguous list with no
    `count`/`.range()` and used `ambiguous.length` as the displayed total - both the
    displayed count AND the fully-rendered list (all 1,047+ rows on one page) were real
    problems at this scale, not just the count. Fixed both: a real
    `count: "exact", head: true` query for the header ("Unklare Treffer (1047)" - verified
    live, no longer capped), and actual pagination (`PAGE_SIZE = 20`, `?page=` param,
    Zurück/Weiter links) so the page renders one page's worth of candidate pickers at a
    time instead of all 1,047+.

    **"Minimize this before the massive import"**: the real fix was moving item 50's
    name-similarity scoring from an after-the-fact backlog sweep into the LIVE resolver
    itself. Extracted the scoring (`scoreNameMatch`, `rankByNameMatch`,
    `NAME_MATCH_DECISIVE_THRESHOLD`/`_MARGIN`) into `lib/enrichment/places.mjs` -
    `pickResolution()` now tries a decisive name match as one more auto-resolve step
    before falling through to `ambiguous`, right alongside the existing PLZ/address
    checks. Both real entry points Anis would use for the upcoming run
    (`scripts/enrich-pilot.mjs`/`scripts/enrich-places.mjs` for the CLI batch,
    `app/api/enrich/route.ts` for the on-demand button) call this same
    `pickResolution()` under the hood, so every company resolved from now on gets this
    check automatically - no separate rescan needed afterward for new companies.
    `scripts/rescan-ambiguous-by-name.mjs` (item 50) was refactored to import and reuse
    this same shared logic instead of its own copy, so the live path and the backlog-sweep
    script can never drift apart on what counts as a match (§3.2.6) - re-ran it after the
    refactor to confirm identical behavior (0 new matches, since the 244 real ones were
    already cleared by item 50).

    **80%+ highlighting**: `components/ambiguous-candidate-picker.tsx` now takes a
    `companyName` prop, scores every candidate against it with the same shared
    `scoreNameMatch()`, and renders a green `Badge` ("Name-Match NN%") + a tinted card
    border on any candidate scoring ≥80% - a visual nudge for the fast, common case
    without ever auto-picking on the admin's behalf (still fully manual - the picker
    still requires a real click).

    Verified live end-to-end (throwaway admin test account, deleted after): the real
    page now shows the correct total (1,047), real pagination ("Seite 1 von 53" -
    1,047/20 ≈ 52.35, correctly rounds up), and real 80%+ badges rendering on genuine
    close-name-match rows still sitting in the queue (e.g. "Autozentrum Köln" showing
    two different 100%-match candidates - a case that's still genuinely ambiguous
    between two near-identically-named businesses, correctly held back from
    auto-resolving by the decisive-margin rule, now visually flagged for a fast manual
    pick instead of requiring the admin to read every candidate's address closely).
    Typecheck/lint clean, full suite green (41/41).

52. **Enrichment queue: soft-match tier + top-5 candidate cap — 2026-08-09.** Anis: "don't
    list more then 5, it's usually in the first 3 suggestions" + "do the soft match you
    suggested to clean up a bit, since 1k too much by hand." Added a second, looser
    auto-resolve tier (`NAME_MATCH_SOFT_THRESHOLD = 0.7`, `NAME_MATCH_SOFT_MARGIN = 1.3`,
    `lib/enrichment/places.mjs`) alongside item 50's decisive tier - fires when the top
    candidate's name match is high in absolute terms (≥70%) even without a strict 2x
    margin over the runner-up, since a high absolute score is real signal on its own.
    Refactored `pickResolution()`/the rescan script/the admin UI to share one
    `bestNameMatch()` (decisive, then soft) so none of the three can drift apart on what
    counts as a match. Ran the dry-run first, spot-checked the real matches (all looked
    genuinely correct - punctuation/word-order variants of the same real business, e.g.
    "Transporte Weber GmbH" → "Weber Transporte GmbH", "Nobilia-Werke J. Stickling
    GmbH+Co. KG" → "nobilia-Werke J. Stickling GmbH & Co. KG"), then applied for real:
    **28 more resolved, queue 1,047 → 1,019 → 986** (a few more had already resolved from
    live testing in between). A modest additional cut on top of item 50's 244, honestly
    reported as such - most of what's left genuinely has no decisive automatic answer.

    Separately, `components/ambiguous-candidate-picker.tsx` now sorts candidates by real
    name-match score and shows only the top 5 (`MAX_SHOWN`), with a small
    "N weitere Kandidaten mit niedrigerer Namensähnlichkeit ausgeblendet" note when
    truncated - some rows had 12-20 raw Places candidates (most of them unrelated
    businesses that matched a loose text search), and Anis confirmed the real answer is
    always near the top once sorted by relevance. Verified live: a real row showed "9
    weitere Kandidaten... ausgeblendet" correctly, and the real total dropped to 986 in
    the page header. Typecheck/lint clean, full suite green (41/41).

53. **Fokus flyer, 2nd round of design feedback — shipped 2026-08-09.** Anis reviewed the
    AI-art version (item 49) and gave five concrete notes, plus asked to see a fresh
    AI-generated hero/accent set once done:
    - **Logo aspect ratio was actually broken** - `drawCoverPage()`'s logo card computed
      `drawImage`'s width from `cardH * aspect` but its height from a different base
      (`cardH - 8`), so the two dimensions didn't share the source ratio and the logo
      rendered visibly stretched. Fixed by deriving both width and height from the same
      inner box (`innerH = 58`, `innerW = innerH * aspect`) and enlarged per "needs to be
      bigger."
    - **Sidebar texture**: the cover's dark text panel was a flat fill - added a subtle
      off-center radial glow plus very faint diagonal hairlines (clipped to just that
      panel, low enough opacity to never compete with the text on top).
    - **Banner rearranged**: `drawOnlineOrderBanner()` redrawn full-bleed (edge to edge,
      like the category header bars) instead of a MARGIN-indented box, with a left accent
      bar and better-proportioned text - no longer reads as a leftover strip glued
      between the product grid and the footer.
    - **Real product descriptions added**: `products.description` (already
      bullet-formatted text from `scripts/generate-product-descriptions.mjs`) is now
      parsed into real bullets (`parseBullets()`) and rendered in the card when a
      category earns the "detailed" layout.
    - **Grid varies by real content, not a coin flip**: a category where ≥50% of its
      cells have a description gets a wider 2-column "detailed" card (bigger image, room
      for bullets); one without stays on the denser 3-column "compact" card - and every
      row's height is now measured from its own real content (`drawProductCard()` called
      once with `measureOnly=true` per card, same font/wrap logic as the real draw pass
      so the two can never disagree) instead of one fixed height for every card in the
      flyer.

    Real bugs found via direct rendering, not assumed: forgot to actually send the
    regenerated PDF the first time (generated it, reviewed it myself, moved on to other
    work without using `SendUserFile`) - Anis had to ask "what happened with the flyer
    generation fixes." Sent the real file once caught. Separately, the "show me a fresh
    AI hero" ask hit a real wall: the $5 OpenAI credit from item 49's testing had run out
    mid-session (`429 You have no credits remaining`) - the flyer correctly degraded to
    the static fallback photo and plain category bars (the resilience built in item 49
    working exactly as designed), but couldn't demonstrate fresh AI art until Anis adds
    more credit. Reported this plainly rather than silently sending a fallback-only
    render without explanation.

    **A sixth, unprompted-by-the-punch-list finding from Anis mid-review**: "when there
    is kinda same product with variations like the Schleifpapier, don't do 10 times same
    picture, do it over the description x1 product." Checked the real active list before
    building anything: multiple genuine same-photo variant families exist (e.g.
    "Klett-Scheiben Normfest" - 7 rows, one per Art.-Nr., all sharing one image; two
    "Mechanikerhandschuhe „NAPPA"" size families and two "Kupplungskopf" variants, 4 rows
    each). New `groupByImage()` groups focus-list rows within a category by exact,
    shared `products.image_path` (a real, exact signal - not a fuzzy name guess) into one
    cell each; `drawProductCard()` now takes a cell (1 row, or a same-photo variant
    family) and, for a family, draws the shared photo once with each variant's own
    SKU/price/note as a compact line below (capped at 6 lines, "+N weitere Varianten" if
    more) instead of N nearly-identical cards repeating the same photo. Description
    bullets (when the category has them) still render once per family, since the real
    description text is genuinely shared across size/pack-size variants of the same
    product.

    Verified end-to-end via the standalone generator against the real active list (no
    writes) - rendered every page and visually confirmed all five fixes plus the variant
    grouping: the logo renders at the correct proportions, the sidebar texture is visible
    but subtle, the banner sits well-spaced and full-bleed on the last page, real
    description bullets render under each detailed card, and - directly inspected on the
    real "Fahrzeugteile NFZ" and "Werkstattausrüstung" pages - "Kupplungskopf Automatik,
    mit Rückschlagventil" and "Mechanikerhandschuhe „NAPPA"" each now show one photo with
    4 compact variant price lines instead of 4 duplicate cards. Typecheck/lint clean,
    full suite green (41/41).

54. **Fokus flyer: scent/flavor variant families grouped onto one card, real photo
    "group shot" compositing, and a real truncation bug fixed - shipped 2026-08-09.**
    Anis, after seeing item 53's polish pass: "5 same products (for example air
    freshener) to stand out etc... could be wrong product or?" then, once told
    AI-altering real product photos would risk misrepresenting them, confirmed:
    "Grouping same family photos as well, since mainly just difference in 'smell',
    this could be done with one sentence available in scent 1, 2, 3, 4, 5 etc... And
    that would break the 'same boring' look."

    Deliberately did NOT reach for AI image generation/editing on actual product
    photos for this - same reasoning as never letting AI touch real catalog data
    elsewhere in this app (§3.2.6/§9's guardrails): a model asked to "combine" or
    "restyle" real product photos can drift on exact visual details (wrong color,
    garbled label), which would misrepresent what a customer actually receives. Item
    53's AI image calls (hero + category accent art, gpt-image-1.5) stay scoped to
    decorative art only, never product photography.

    `groupByImage()` (item 53, exact-same-`image_path` families like glove sizes)
    already existed; added a second, narrower grouping pass, `groupByScentVariant()`,
    for families whose photos genuinely DIFFER (each scent has its own can color) but
    are still the same real product line. **Real finding, tested before writing any
    production code:** name-similarity alone is NOT a safe signal here - scored the
    real "Geruchsvernichter und Lufterfrischer Aerofit" scent family (7 real SKUs)
    against the real "Hochdruck-Haftschmierfett Black/Protect/Ultra" grease line (a
    genuinely different product line) and found the grease line scores a HIGHER
    Jaccard word-overlap (max 0.80) than some true same-family scent pairs (min
    0.27) - both patterns are structurally "shared base phrase + one differentiator
    word," so no single threshold could separate them safely. Used a combined signal
    instead, requiring both to agree: the same 8-character SKU prefix (Normfest's own
    real numbering scheme) AND an explicit `(Duft N: Scent)` marker already present in
    the source `note` text (the data's own statement "this is a scent choice," not an
    inference). Verified against the real active list: correctly groups all 7 real
    Aerofit rows and correctly leaves the grease line ungrouped (its notes carry no
    "Duft" marker) - confirmed visually in the rendered PDF, not just by code review.

    New `drawImageGroup()` fans up to 5 real, already-downscaled photos within a card
    (rotation/offset/drop-shadow) so even a single repeated photo reads as a staged
    product group instead of one flat image - used for every variant family, same-
    image or different-image. 100% real, unaltered product photos; only their on-page
    arrangement is synthetic. `sharedBaseName()` computes the real shared family name
    (every word from the first member's name that also appears, case/ligature-
    normalized, in every other member's name - e.g. correctly yields "Geruchsvernichter
    und Lufterfrischer Aerofit," always a real substring, never an invented summary).
    The scent card shows one price (min, "ab X €" if prices vary), one "Erhältlich in:
    ..." sentence, and the real SKU list - instead of 7 near-identical cards.

    **Real bug found and fixed by rendering and visually inspecting the output before
    trusting it, same discipline as everywhere else in this app:** the first version's
    "Erhältlich in:" and "Art.-Nr." lines used a plain `wrapText(...).slice(0, N)` /
    first-line-only extraction, which silently cut off mid-list with no indication -
    e.g. "Art.-Nr. 2000-309-410," rendered with a dangling trailing comma and 6 real
    SKUs missing, looking like corrupted data rather than a deliberate truncation.
    Fixed with a new `fitItemList(ctx, items, prefix, maxWidth, maxLines)` helper that
    tries the full real list first, and only if it doesn't fit, progressively drops
    trailing items and appends an honest `+N weitere` until it fits - so the card
    always shows either the complete real list or a clearly-labeled partial one, never
    a silent cutoff. Re-verified after the fix: the same Aerofit card now correctly
    shows "Coolwater, Zitrus, Kirsche +4 weitere" and "Art.-Nr. 2000-309-410 +6
    weitere."

    Verified end-to-end: rendered the full real active list ("August Kracher 2026",
    read-only, no writes) and visually confirmed every page, including the grease line
    staying correctly ungrouped next to the correctly-grouped Aerofit card and an
    existing `groupByImage` family's own "+1 weitere Varianten" line rendering
    unaffected. Separately generated against a throwaway, inactive test list (7 real
    Aerofit rows copied over) to confirm the generator works standalone, not just as a
    read against the active list - correct output, real active list's `pdf_path`
    confirmed unchanged before and after, test list and all temp files deleted after.
    Typecheck/lint clean, full suite green (41/41).

55. **Fokus flyer round 3: reliable AI hero + real workwear branding, real
    background removal for grouped photos, full-width family cards, cover
    redesign — shipped 2026-08-09.** Anis's punch-list from testing item 54's
    output:
    - **Hero repeating the same photo, root-caused.** `generateHeroImage()`
      silently falls back to a static reference photo whenever the OpenAI
      call fails - and what Anis saw twice was exactly that fallback, not a
      duplicate generation (the fallback file was still the item-48-era
      cropped ChatGPT reference mockup, easy to recognize as "the same
      picture" once flagged). Retries bumped from 1 to 2 (3 attempts total,
      `lib/ai/flyer-images.mjs`'s `RETRY_DELAYS_MS`) to survive Tier-1
      per-minute rate-limit bursts (up to ~9 images requested per flyer) more
      often before falling back at all. Separately, generated a **fresh**
      static fallback photo (same style/prompt, own real AI generation, not
      reused pixels) to replace the recognizable reference crop, so even a
      rare fallback doesn't look like an obvious repeat.
    - **Real NORMFEST branding on workwear, per Anis's ask** ("if possible
      and showing on things like tshirts, caps... write Normfest in white
      font on the dark shirt"): added a narrow, explicit exception to the
      hero prompt's no-text rule (`WORKWEAR_BRAND_DIRECTIVE`) - only the real
      company name, only on the mechanic's visible workwear, never other
      random/fabricated text. Real risk flagged to Anis and accepted: text
      rendering in image models is imperfect even for short real words, so a
      given generation can occasionally come out slightly garbled - the
      practical remedy is the same as any AI-art miss, regenerate. First real
      test came out perfectly legible ("NORMFEST" correctly spelled on the
      shirt back) - not guaranteed every time, but working as intended.
    - **Real background removal for grouped/staged photos** (2026-08-09,
      Anis: "the background is pure white, should be super easy and
      precise... move it closer so it looks more staged" - accepting the
      risk flagged when this was proposed). `removeWhiteBackground()` reads
      raw pixel data and makes near-white pixels transparent with a soft
      feathered edge band (not a hard cutoff) - deterministic thresholding,
      not AI, so no real product pixel is ever altered, only background
      pixels are dropped. Applied only inside the fanned/overlapping group
      compositing (`getGroupCutoutImage()`, cached per image like the
      existing downscale cache) - single-product tiles keep their plain
      white-background photo untouched, exactly as before. With real
      collision no longer possible, `drawImageGroup()`'s fan spacing was
      tightened (offset 0.4x → 0.27x) so the staged group reads tighter/more
      deliberate. Verified visually across several real families with very
      different photo content (Aerofit scent cans, metallic Kupplungskopf
      connectors, fabric/leather gloves) - clean cutouts with no visible
      seams or holes in this pass; the known risk (a product with white
      elements on it losing a chunk) simply didn't occur on the real photos
      tested, not proof it never will on some future one.
    - **Family/variant cards now span the full row width** instead of
      matching a single grid cell (2026-08-09, Anis: "they need to take more
      place... mix it up so the whole flyer doesn't look boring in only one
      layout raster"). The row-packing loop
      (`generateFocusListFlyer`'s per-category loop) now gives any cell with
      `cellRows.length > 1` its own full-width row (`FAMILY_IMG_BOX = 120`,
      bigger than either grid's normal image box) while ordinary single-
      product cells keep packing the normal 2/3-column grid - this is what
      actually produces the visual variety, not a coin flip: some rows are
      wide feature cards, others the denser normal grid, driven by which
      products are real variant families. Verified: the real Aerofit family
      (now with room to spare) shows its full 7-scent list with zero
      truncation needed; the Kupplungskopf/glove same-image families render
      as clean wide rows with no layout overflow.
    - **Cover redesign**, per Anis's punch-list: headline bumped 34px→42px
      (with proportionally bigger line height), general cover text sizes
      bumped throughout. The tagline moved from a small fixed line pinned to
      the page bottom up to directly under the heading, and turned into a
      real designed element: **FAIR / ONLINE / KUNDENORIENTIERT /
      UNSCHLAGBAR / SYMPATHISCH**, one word per line with a blue accent rail
      and each word's first letter drawn bold/bright-white against the
      rest of the word in a muted tone - spelling **F-O-K-U-S** down the
      first letters (Anis's own catch on the existing four words; "
      Sympathisch" added specifically to complete the acrostic). The stat
      row (Aktionsprodukte/Kategorien) was rebuilt from two bare number/
      label pairs into two separated pill cards, each with a small hand-
      drawn vector icon (a price-tag icon for Aktionsprodukte, a 2x2 grid
      icon for Kategorien) - per Anis: "add symbols... separate it."
      **Confirmed unchanged, not a new risk:** `productCount`/
      `categoryCount` were already computed live from the real list's actual
      rows/categories at generation time (`generateFocusListFlyer`, not
      hardcoded) before this redesign - verified this stayed true (real
      counts 64/8 on the real list, 15/4 on a throwaway test list with
      different content) rather than assuming it.

    Verified end-to-end: rendered the full real active list ("August Kracher
    2026", read-only, no writes) across all these changes together and
    visually confirmed every page - sharp fresh hero photo with correct
    "NORMFEST" branding, FOKUS acrostic tagline, icon stat pills, wide clean
    family cards with no white-box seams. Separately generated against a
    throwaway inactive test list (a real mix of a scent family, a same-image
    family, and singles, across 4 categories) to confirm the generator works
    standalone with different real content, not just against the active
    list's specific data - correct output, correct dynamic counts (15/4),
    real active list's `pdf_path` confirmed unchanged before and after, test
    list and all temp files deleted after. Typecheck/lint clean, full suite
    green (41/41).

56. **Fokus flyer round 4: hero scene variety, cover pill fixes, and a real
    grid-alignment bug (stranded single cards) fixed — shipped 2026-08-09.**
    Anis's next punch-list, testing item 55's output:
    - **Hero scene variety.** Every generation had used the exact same
      framing ("close-up on wheel/brake area"), which read as repetitive
      even though each was a genuinely fresh AI call. `buildHeroPrompt()`
      now picks randomly from 5 real workshop scenes each time (`HERO_
      SCENES` in `lib/ai/flyer-images.mjs`): the original brake close-up,
      a wide shot of a car on a lift, an open-engine-bay shot, a workbench
      shot with a car visible behind, and two mechanics working together -
      all still real, plausible workshop settings, never fabricated.
      Verified: the very next generation came back as a genuinely different
      composition (open engine bay, mechanic's face visible, "NORMFEST"
      correctly readable on both cap and shirt).
    - **Cover text sizing.** The validity badge ("Gültig vom...") hadn't
      grown when the surrounding headline/tagline got bigger in item 55 -
      bumped its font (12px→14px) and box size to match. The Aktions-
      produkte/Kategorien stat pills were still cramped from being placed
      side-by-side (each only getting half the panel width) - stacked them
      vertically instead, each now using the full text-panel width and a
      taller pill (42px→48px), per Anis: "you have more room, place them
      one underneath the other."
    - **Real grid-alignment bug found and fixed.** Anis: "the group photo
      might have caused other products to move place so its kinda not well
      gridded... merge some 2 tiles/products in 1 tile for those group
      photos" - the round-3 fix gave every family cell the FULL page width
      as its own row, which broke the surrounding grid rhythm. Reworked to
      column-span packing instead: a family cell spans `min(2, cols)`
      columns and can share a row with a single-product cell when there's
      room, instead of always claiming the entire row (`generateFocus
      ListFlyer`'s per-category loop). **Checked the real data before
      assuming this alone would fix it, and found the actual root cause of
      what Anis was seeing**: ~99.8% of the catalog now has a real
      description (§13 M3/M4's bulk description-generation pass), so
      `hasDesc` evaluates true for essentially every category in the real
      active list, putting every category in 2-column "detailed" mode - and
      a family cell's 2-column span exactly equals a 2-column grid's total
      width, so it can never actually share a row with anything regardless
      of the column-span fix. The real symptom this produced: a single
      product landing right before a family in the cell order would get
      stranded alone at half the row's width with a visible empty gap next
      to it (confirmed directly against real category data, all 8 real
      categories in the active list are 100% description coverage → 2-col
      mode). Anis, once shown this: "its ok for family to fill row, but the
      single products have to adapt. not 1 product in line." Fixed by
      making each row's card widths proportional to the row's actual total
      column-span used rather than the nominal column count - when a row is
      fully packed this unit width equals the normal column width (no
      change from before), but when a row has leftover columns (a lone
      single stranded before a family, or a category's uneven last row) the
      leftover width distributes across that row's own cards instead of
      sitting empty. Verified: a single product that previously sat at half
      width with a gap next to it now stretches to the row's full width;
      normal fully-packed 2-up single/single rows are pixel-identical to
      before; families still correctly fill their own row when nothing else
      can share it.

    Verified end-to-end: rendered the full real active list ("August
    Kracher 2026", read-only, no writes) and visually confirmed every fix
    together across all 7 pages - no stranded singles anywhere, families
    still read cleanly, cover pills/badge properly sized. Typecheck/lint
    clean (one real `no-unused-vars` warning surfaced and fixed - the old
    flat `cellW` became dead code once width became proportional), full
    suite green (41/41).

    **Same-day follow-up: real validity-badge overflow bug.** Anis: "the
    Gültig vom 01.08 is out of boundaries" - the bumped 14px badge font from
    earlier in this round measured wider than `textPanelW` for the real
    label ("Gültig vom 01.08. bis 31.08.2026"); the badge BOX width was
    capped via `Math.min()`, but the TEXT itself was drawn uncapped and
    visibly spilled past the box and the whole cover text panel. Measured
    directly with the real registered font before guessing a fix: even at
    10px the label was right at the edge of fitting, confirming this wasn't
    a one-size-away miss. Fixed properly rather than picking a smaller fixed
    size: the badge font now shrinks in 0.5px steps (14px→9px) until the
    real label actually measures within bounds, so it can't recur for a
    differently-worded validity string on a future list either. Also
    increased the gap before the stat pills (26→36) per "shift the 64 and 8
    a bit down." Typecheck/lint clean, no new PDF generated for this pass
    per Anis's explicit ask (code fix only, verified by direct text-width
    measurement against the real font/label rather than a fresh render).

57. **Dialer softphone concept preview removed (2026-08-09).** Anis: "Softphone
    im dialer entfernen und Wie das funktionieren soll. Brauchen wir nicht
    mehr im menu" - the `/dialer` page (§13 item 13) originally shipped as a
    concept-preview page (intro paragraph, a "Wie das funktionieren soll"
    explainer card, and a working-but-disabled softphone dial-pad demo)
    ahead of any real dialer integration; the Live-Status/Verlauf sections
    added later (§14 items 13/24) are real, shipped features, not concept
    previews. Removed the intro paragraph, the "Bald" heading badge (nothing
    left on the page is actually "coming soon" - Live-Status/Verlauf are
    both live today), the "Wie das funktionieren soll" card, and the
    "Softphone (Beispiel-Layout)" card. `components/softphone-dialpad.tsx`
    deleted outright (confirmed via grep it had no other usage) rather than
    left as dead code. `/dialer` now shows only the real Live-Status and
    Verlauf cards. Typecheck/lint clean, full suite green (41/41).

58. **VIS re-import (2026-08-10) — a real, password-protected file, and a
    real architecture gap found + closed: companies dropped from VIS were
    never removed from our side.** Anis sent a fresh export
    ("VIS TeleSales Sarajevo 10.8.26.xlsx"). First attempt failed - real
    blocker: `xlsx` 0.20.3's free/community build can't decrypt modern
    Office (OOXML) password protection (confirmed: no LibreOffice/working
    Python in this environment either to strip it another way, and passing
    a `password` option to `XLSX.read()` didn't work against this file's
    encryption). Anis removed the password in Excel and re-sent; import
    then ran clean: 14,311 valid rows (2 skipped, both trailing blank
    rows), upserted, real DB total 14,349 companies, spot-checked one real
    row byte-for-byte against the source file.

    **Real question Anis raised afterward: since VIS is the source of
    truth, should companies that drop out of a fresh export get removed
    from our side too?** Investigated before answering: `companies`'
    `Löschdatum` (deletion-date) column is defined in the import's own
    column map (`COL.soft_deleted_at`) but was never actually wired into
    `mapRow()` - and checked directly against the real 14,313-row file
    whether it's even usable: **zero non-empty values across the whole
    file**. VIS's real removal signal is a company's row simply being
    absent from the export, not a stamped date. Diffing the fresh file's
    14,311 Kundennummern against the DB's real company set found **38
    companies present in our app but missing from this export** - and their
    distribution (14 of 38 in Alan Sačić's book alone, the one agent with
    real sustained usage this session) lines up exactly with what Anis
    described: agents asking Normfest directly to remove "not interested"/
    "company closed" companies, which then simply stop appearing in later
    exports.

    Implemented as a permanent pipeline step, soft-delete only - never a
    hard `DELETE`, consistent with this schema's existing soft-delete
    convention for companies/contacts/notes/kb_documents (§4): a company
    dropped from VIS keeps every real thing an agent did with it
    (`sales_feedback`, notes, focus-list history) fully intact and
    queryable, just excluded from active search/Dashboard/signals (both
    already filter on `soft_deleted_at is null`, confirmed via
    `fn_search_companies` and the RLS policy - no further UI work needed).
    `mapRow()` (`lib/vis-import/core.mjs`) now explicitly writes
    `soft_deleted_at: null` on every company present in a fresh file, so
    one that reappears later (e.g. reopened under a new contact) is
    automatically revived rather than stuck hidden. New
    `softDeleteMissingCompanies(admin, presentKundennummern)` does the
    other half - finds every not-yet-soft-deleted company absent from the
    fresh set and stamps `soft_deleted_at`, paginated the same way every
    other bulk query in this codebase now is after repeatedly hitting
    PostgREST's 1000-row default cap. Wired into both
    `scripts/import-vis.mjs` (CLI, prints the real removed list) and
    `app/api/admin/vis-import/route.ts` (self-serve upload, returns
    `softDeletedCount`/`softDeleted` in the response) so neither path can
    drift from the other.

    Verified live against real data: re-ran the import (idempotent
    re-upsert of the same 14,311 rows, harmless), confirmed all 38 real
    companies got `soft_deleted_at` stamped with the real timestamp, and
    confirmed a real still-present company (BNS GmbH Dresden) was
    untouched (`soft_deleted_at` stayed `null`). Full suite green (41/41)
    after, typecheck/lint clean.

59. **Agent-facing "Feedback diese Woche" tile scoped to own count
    (2026-08-10).** Anis: "nur seine eigenen feedbacks sehen, diesen count" -
    both the admin and agent Dashboard tiles shared one team-wide
    `sales_feedback` weekly count (the original flywheel-adoption widget,
    §5). Admin's tile stays team-wide (that's still the real intent there);
    the agent tile now runs its own query filtered to
    `agent_id = auth.uid()` - same identifier `sales_feedback.agent_id`
    already uses elsewhere (`fn_log_sales_feedback`, the `/feedback` page's
    own agent-scoping, §14 item 33). Verified with real data: team-wide
    count and Alan's own count both came back as 10 this week - not a
    differentiation bug, just confirms Alan is still the only agent with
    real sustained feedback activity this week, so the two numbers
    currently coincide; the query itself is scoped correctly by
    construction. Typecheck/lint clean, full suite green (41/41).

60. **Anwesenheit Friday Soll changed 7h→6h (2026-08-10).** Anis: "freitag
    aendern 6 stunden anstatt 7." `expectedHoursForDate()` (`lib/
    attendance.ts`) is the single shared source both the overview and
    per-agent pages compute Soll/Saldo from - updated the Friday branch,
    the "Fr 6h" overview subtitle copy, and the calendar's quick-fill button
    (was "7h", now "6h"). Real, deliberate consequence worth noting: since
    this is a pure function recomputed on every page load (not a value
    stored per attendance row), every past Friday's Soll/Saldo across all
    history recalculates under the new 6h rule too, not just future Fridays
    - matches Anis's own framing of this as changing the schedule, not
    backfilling a one-off correction. Verified the weekday logic directly
    against real Friday/Thursday/Saturday dates. Typecheck/lint clean, full
    suite green (41/41).

61. **Anthropic Batches API for the ANALYZE backlog — shipped (2026-08-11),**
    per Anis's cost-optimization ask (§13 M8's "$400-500 credit" discussion):
    "Batches api, do it then ofc if its a win... does that mean that we have
    to push all agents at once (fine by me as well) ignore promt caching."
    Real 50% discount on both input and output tokens for this bulk,
    non-realtime workload - same model, same prompt, same json_schema
    structured output as the synchronous path, just submitted asynchronously.
    Prompt caching explicitly NOT built, per Anis's own instruction (real
    cost driver here is OUTPUT tokens, which caching can't discount anyway).

    Verified the real SDK surface before writing anything (`@anthropic-ai/sdk`
    v0.112.4 ships a non-beta `messages.batches` resource - `create`/
    `retrieve`/`results`/`cancel`/`delete`/`list`) and fetched the real docs
    to confirm the two things that mattered for the "push all at once?"
    question: a single batch supports up to **100,000 requests or 256MB**,
    whichever comes first, and `output_config`/`json_schema` IS supported
    inside batch requests (only `stream`, `speed`, `store`/thread params,
    `cache_hint`, `max_tokens:0`, and a research-preview flag are excluded).
    **Answer: no need to split per agent** - the entire multi-agent backlog
    (12,114 companies as of this run) fits in one batch with massive
    headroom.

    `lib/enrichment/analyze.mjs` refactored: extracted `writeAnalysisResult()`
    (the parse-JSON/matchCatalogProducts/DB-update write-back) out of
    `analyzeCompanyEnrichment()` so both the synchronous path and the new
    batch-results path share one write-back and can never drift on what
    "done" means (same discipline as `pickResolution`/`bestNameMatch` being
    shared between the live enrichment resolver and backlog rescan scripts,
    item 51 above). New `buildBatchRequest(companyId, {company, enrichment})`
    packages one company into a batch request item (`custom_id` = company
    UUID - fits Anthropic's real `^[a-zA-Z0-9_-]{1,64}$` constraint as-is).
    New `fetchAnalyzeBacklog(admin, {gebiets})` replaces the candidate-
    selection query that used to live inline in `scripts/analyze-backlog.mjs`
    - **paginated via `.range()`, fixing the same PostgREST-1000-row-cap bug
    already found and fixed multiple times this project** (items 32/50/58):
    the old unbounded `.select()` would have silently truncated the real
    12,114-row backlog to 1,000 without erroring.

    Two new scripts: `scripts/submit-analyze-batch.mjs [limit] [gebiet1,...]`
    (fetches the backlog, builds requests, submits, prints the batch id +
    a rough cost estimate) and `scripts/process-analyze-batch.mjs <batch_id>`
    (polls status, and once `processing_status` is `"ended"`, streams the
    real `.jsonl` results via the SDK's async-iterable `JSONLDecoder` and
    writes each succeeded result back through `writeAnalysisResult()` -
    reports real per-company cost from the batch's own returned token
    usage, not an estimate).

    **Dry-run tested with real API credits, per Anis's explicit ask, before
    reporting this done:** submitted a real 3-company batch
    (`msgbatch_018wSvR7bPjyuCfLviRP3Cm4`), polled it to `"ended"` (took
    ~3.5 minutes for 3 requests - real batches can take up to 24h, most
    finish within an hour), processed the results, and verified the DB
    write-back directly: all 3 companies got real, correctly-shaped
    `strengths`/`weaknesses`/`external_opportunities` with genuine quotes
    and matched catalog products, identical output shape to the synchronous
    path. Real cost: $0.0428 for 3 companies via the batch discount. Full
    ~12,114-company backlog submission is NOT run yet - waiting on Anis's
    explicit go-ahead per his own stated plan ("I will now do the funds,
    then I tell you when to analye").

62. **Two real, unrelated bugs found and fixed while investigating dialer
    questions (2026-08-11):**
    - **"Gespeichert um X Uhr" on `/dialer`'s Verlauf card was showing raw
      UTC, not local time.** Anis: "i see its at 16:03 but we arranged at
      18:00" about the 2026-08-10 Tages-Snapshot. Investigated before
      assuming the cron was broken: `dialer_daily_snapshots.captured_at`
      for that date really is `16:03:56 UTC`, and the cron (`vercel.json`,
      `0 16 * * *` = 16:00 UTC) fires exactly on schedule - Bosnia/Germany
      are on CEST (UTC+2) right now, so 16:00 UTC genuinely is 18:00 local.
      The bug was purely in display: `new Date(captured_at)
      .toLocaleTimeString("de-DE", {...})` runs server-side (RSC) on
      Vercel's UTC Node runtime with no explicit `timeZone`, so it silently
      formatted the raw UTC hour instead of real local time. Fixed by
      adding `timeZone: "Europe/Sarajevo"` - verified computationally
      against both real stored timestamps (08-10 → 18:03 ✓, 08-06 → 16:18,
      correctly NOT 18:00 since that earlier row was from manual route
      testing, not a real scheduled 18:00 capture, per item 24's own notes).
    - **Verlauf's historical Sales figures were frozen at whatever
      `agent_daily_performance.sales_count` said at 18:00 capture time,**
      never refreshed even after Anis later imports/corrects the Team
      Dashboard Excel for that date. Anis: "But the 'Sales' part is not
      correct... sales match from the team dashboard everywhere in logs
      and live." Confirmed the real gap directly: the 2026-08-10 snapshot
      had `realSales: 0` frozen for 9 of 10 agents, while the CURRENT
      `agent_daily_performance` for that date (after a later re-import)
      already showed 1-6 real sales each. New `refreshSalesInSummaries()`
      (`lib/dialer/status.ts`) re-derives `realSales`/`conversion`/
      `salesPerHour` against a freshly-fetched sales map at render time,
      leaving every dialer-sourced field (`totalCalls`, occupancy, time
      breakdowns) frozen as a genuine point-in-time capture that can't be
      "corrected" after the fact the way a spreadsheet-sourced count can.
      `/dialer`'s Verlauf section now fetches `agent_daily_performance` for
      the *selected snapshot's date* (not just today) alongside the stored
      snapshot and overlays it - this self-corrects retroactively for
      already-stored snapshots too, with no data migration needed. Verified
      directly: the 08-10 snapshot now shows the real current sales_count
      per agent (matching agent_daily_performance exactly), not the stale
      frozen zeros.
    - Also deleted the 2026-08-06 `dialer_daily_snapshots` row per Anis's
      explicit ask ("remove the Donnerstag 06.08.2026 from the list since
      not complete day and not correct, so we start from the 10th") - that
      row was always known to be from manual route testing (item 24), not
      a real scheduled capture, so Verlauf's history now correctly starts
      at the first genuine 18:00 snapshot (08-10).
    Typecheck/lint clean, full suite green (41/41) after both fixes.

63. **Ambiguous Places-match count added to `/admin/anreicherung-uebersicht`
    (2026-08-11).** Anis: "kannst du mir in die Anreicherung-Übersicht auch
    schon the Enrichment part there, to see where those 930 companies that
    are ambigous are sorted?" - the ranking table already broke down Places/
    website/analyze completion per agent (§13 M8, original 2026-07-27 build)
    but had no visibility into the 931 real companies still sitting
    in the ambiguous-match queue (`company_enrichment.places_ambiguous`,
    §9/§14 items 5/50/51/52's ongoing cleanup). Migration
    `20260811010000_company_gebiet_enrichment_coverage_ambiguous.sql` adds
    an `ambiguous` column to the existing `company_gebiet_enrichment_coverage`
    view (`count(*) filter (where ce.places_ambiguous)`, same drop-and-
    recreate pattern as the view's two prior versions since `CREATE OR
    REPLACE VIEW` can't add columns to some Postgres versions' cached plans
    reliably - kept consistent with precedent). Applied live via
    `supabase db push --linked`, types regenerated. Page now shows a 4th
    stat tile ("Davon unklar (Places-Match)", links to `/admin/enrichment`)
    and a 6th ranking-table column, so an admin can immediately see which
    agents' books have the most unresolved matches still needing a manual
    pick. Verified the view sums correctly against the real per-row count
    (931, matching a direct `count()` query) and spot-checked the top-5
    Gebiete by ambiguous count (153/123/122/108/102) render correctly.
    Typecheck/lint clean.

---

## 15. Glossary — as v2.2, plus: VIS LIST (customer master file, all fields incl.
Kundennummer/phone/Gebiet) · Tier 1/Tier 2 (§4A data classes) · brand profile (curated
brand→consumption-category mapping) · Flywheel (feedback-driven self-improvement loop).
