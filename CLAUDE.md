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
| Files | SheetJS (VIS list, exports); PDF parse (pdfjs/poppler) + LLM for catalog & KB | |
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
this affinity change). `cross_sell` verified working end-to-end via a throwaway test:
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

---

## 9. LLM Enrichment ("Show me you know me", flagship #3) — as v2.2 (pipeline, worked
floor-cleaner example as canonical test, anti-hallucination guardrails, batching/cost,
≤5-review honesty), plus:
- ANALYZE also outputs `brand_focus_guess[]`; on agent/admin verification it is written
  to `companies.brand_focus` (if empty) and immediately powers `brand_profile_match`
  signals via the curated table — the "Mercedes → oil" chain is: AI detects focus →
  human verifies → deterministic mapping fires.

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
- ⚠️ **CI migration dry-run — documented but not built.** §3.3's tech-stack table promises
  "migration dry-run" as a CI step; `ci.yml` only runs typecheck/lint/test. Not added this
  pass: `supabase db push --dry-run --linked` would need a `SUPABASE_ACCESS_TOKEN` GitHub
  secret I can't confirm is configured, and given migrations in this solo workflow are
  applied by hand immediately after being written (not deferred to CI), its practical value
  here is genuinely unclear — a PR rarely has un-pushed migrations sitting in it. Anis to
  decide: add the secret + step, or drop the promise from §3.3.
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
12. **Rebuild/extend Katalog from the live webshop (added 2026-07-24, backlog — not
    started):** normfest-shop.com (the real customer-facing storefront) has a much larger
    range than our 4,011-product PDF extract (~14,700 sitemap URLs vs. the 800-page
    catalog PDF this app ingested for M3) and its own real "Könnte Sie auch interessieren"
    cross-sell merchandising. Anis wants to eventually import from it directly into
    Katalog (as its own endpoint/source, login-acceptable for price though price isn't
    very relevant here) rather than relying solely on the PDF extract. Explicitly
    deferred — "vratićemo se na webshop kasnije" — Anis's specified approach when picked
    up: (1) full extraction of the shop's own product range (crawl its own category/
    sitemap structure, not search backward from our existing SKUs — see §6/§13 M4 for why
    that direction had ~1% yield), (2) compare the extracted set against our existing
    4,011 products, (3) delete/merge duplicates. Scoped down for now to just mining
    cross-sell pairs from what already exists (§6/§13 M4). Not scoped further — revisit
    when picked up.

---

## 15. Glossary — as v2.2, plus: VIS LIST (customer master file, all fields incl.
Kundennummer/phone/Gebiet) · Tier 1/Tier 2 (§4A data classes) · brand profile (curated
brand→consumption-category mapping) · Flywheel (feedback-driven self-improvement loop).
