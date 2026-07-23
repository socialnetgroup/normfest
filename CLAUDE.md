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
- Admin adds: catalog ingest panel (upload PDF, batch progress, QA queue §11.1).
- Dashboard adds a small "Flywheel" widget: team feedback count this week (adoption
  visibility — social proof).
- **Team** (admin-only, §4.11): per-agent daily/monthly Umsatz, Sales, Anrufe, CR —
  ranked by revenue, one card per imported month.

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
| `first_order_followup` | 2 | first invoice 14–45d ago, no second |
| `basket_expansion` | 2 | avg order value vs peer median |

**§6.2b feedback_replenishment:** for (company, product) with ≥3 'sold' feedback entries,
cycle = avg gap of feedback dates; overdue at ×1.25 — same math as invoice version,
weaker source, labeled "laut Feedback". Auto-superseded by `replenishment_due` when
Tier 2 covers the pair.

Reason templates: as v2.1/2.2, plus
`brand_profile_match`: "Fokus auf {Marke} — {Kategorie} mit erhöhtem Verbrauch
({Begründung aus Profil}). Noch nicht im Sortiment des Kunden."

---

## 7. Focus loop — as v2.2 (≤10s feedback UX; winner thresholds in settings; objection
clustering; winner_derived relations; generated drafts **approved by Anis**; "Extern
bestätigt" column; discrepancy report activates only with Tier 2).

---

## 8. Knowledge base & script — as v2.1/2.2. Additional source: the catalog PDF's
product texts flow into `produkte` collection chunks **linked to product records**
(chunk metadata carries sku) so the assistant answers tech questions with catalog
citations. Script = the existing single file (bilingual Agent Sales Guide lineage),
collection `skript`, own menu.

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

### M5 — Enrichment (week 6–8)
Places resolver + ambiguous queue; website fetch/distill; analyze + guardrails; Brief-
Karte; external_opportunity + brand_focus verification chain; admin enrichment panel;
pilot slice (~200 companies, one Gebiet).
**Done:** ≥70% pilot ok; 20 briefs spot-checked; floor-cleaner canonical test passes.

### M6 — KB + Skript (week 8–9)
KB ingest of the material folder; objection_cards extraction; Wissen + Skript menus.
**Done:** all supplied materials published; objection cards searchable.

### M7 — Assistant (week 9–10)
Chat route + full toolset + citations + context injection + feedback-confirm + budgets.
**Done:** acceptance set passes (§13.4); latency targets met.

### M8 — Hardening & full go-live (week 10–11)
Security checklist, restore drill, remaining-Gebiet enrichment batches, Tier-2 import if
invoices confirmed tabular, hypercare 2 weeks.

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
6. **Team Dashboard data source — RESOLVED 2026-07-23:** confirmed manual (agents
   type in each sale as it happens), so the Excel hand-off is now replaced by the
   in-app `fn_log_sale` entry (§4.11) — no dialer/CRM export integration needed.
7. **Katalog / Team Dashboard drill-down UI (added 2026-07-23, backlog — not started):**
   (a) per-agent profile page showing their own monthly history (not just the
   team-wide leaderboard already on the Dashboard); (b) a retroactive daily
   view/pivot — all the data already exists in `agent_daily_performance`, this is
   purely a display/reshaping task (group by agent, list by day instead of only
   monthly aggregates). Anis explicitly deferred this ("to necu sad") — do not
   build until asked.
   UX detail for the daily bonus view specifically (added same day, P.S. note):
   prev/next-day arrow navigation instead of always showing only today; a
   compact calendar control on the overview that doesn't take much space, which
   expands into a full list of the month's days on click/drill-in — Anis
   referenced Genesys's depth-of-view pattern as the interaction model to copy.

---

## 15. Glossary — as v2.2, plus: VIS LIST (customer master file, all fields incl.
Kundennummer/phone/Gebiet) · Tier 1/Tier 2 (§4A data classes) · brand profile (curated
brand→consumption-category mapping) · Flywheel (feedback-driven self-improvement loop).
