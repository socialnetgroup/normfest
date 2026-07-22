# TODO — Normfest Sales Assistant (solo build: Anis + Claude Code)

Princip: vertikalne kriške, svaka završava zeleno i deployana na staging. Tool ide
agentima uživo već na **M2** (tanka verzija) — flywheel kreće da se vrti dok ti gradiš
ostatak iza njega.

---

## 0. PRIPREMA (prije prve linije koda — možeš odmah, ~2–3h ukupno)

**Nalozi / pristupi:**
- [ ] GitHub repo `normfest-assistant` (private) — ubaci CLAUDE.md u root
- [ ] Supabase: dva projekta, **EU regija** — `normfest-staging`, `normfest-prod`
- [ ] Vercel account + projekat povezan na repo
- [ ] DNS: pristup social-net.ba zoni → CNAME `normfest` → Vercel (može i kasnije, M0)
- [ ] Anthropic API key (server env)
- [ ] Google Cloud projekat + Places API key — **treba tek za M5**, ne žuri

**Fajlovi (handover meni/Claude Code-u kad budu spremni):**
- [ ] **VIS LIST** (master kupci) → treba za **M1**
- [ ] **Katalog PDF** (800 str.) → treba za **M3**
- [ ] **KB folder** (svi materijali + skripta) → treba za **M6**
- [ ] Provjera: **fakture/narudžbe** — postoji li tabelarni export (Excel/CSV) ili samo
      PDF? → određuje Tier 2 (M8 ili post-MVP)

**Ljudi (kratko, ali bitno):**
- [ ] Workshop 1–2h: **brand_consumption_profiles** seed (ti + Sanin + top agent) →
      prije M4. Usput: pack_rank/sezona za fokus-kategorije.
- [ ] Sanin: najava agentima da tool dolazi na M2 + "feedback je gorivo" poruka

---

## 1. MILESTONE PLAN (šta radiš ti, šta radi Claude Code)

| M | Sedmica | Claude Code gradi | Ti radiš (PO uloga) | Done kad |
|---|---|---|---|---|
| **M0** | 1 | Repo skeleton, CI, auth, profiles, settings, RLS + `fn_company_visible` | Nalozi gore; DNS; kreiraš user naloge agenata | Login radi na normfest.social-net.ba (staging) |
| **M1** | 1–2 | VIS import wizard + merge queue; Firmen search + profil skeleton | Daš VIS list; **kalibracija mapiranja** sa mnom (30 min); spot-check 10 firmi | Realni kupci pretraživi |
| **M2** | 2–3 | sales_feedback + 2-tap UI; Fokus meni v1; Dashboard v1 | Napraviš **prvu fokus listu ručno**; onboarding agenata (15-min demo); pratiš adoption widget | **Agenti uživo logују feedback ≤10s** |
| **M3** | 3–5 | Katalog PDF pipeline (segment→extract→QA→commit); Katalog UI; KB produkte feed | Daš PDF; **QA queue** prolaziš (fokus-kategorije prve); bulk-approve čisto | ≥90% proizvoda u bazi |
| **M4** | 5–6 | Tier-1 signali + scoring + Empfehlungen tab + winner report + generisani draft | Workshop seed unesen; plauzibilnost 30 signala (ti+Sanin); odobriš prvi generisani draft | Prvi winner report iz stvarnog feedbacka |
| **M5** | 6–8 | Enrichment: Places+website+analiza+guardrails; Brief-Karte; admin panel | Places key; izbor pilot-Gebieta; spot-check 20 briefova; riješiš ambiguous queue | Pilot ~200 firmi, ≥70% ok; floor-cleaner test prolazi |
| **M6** | 8–9 | KB ingest + objection cards + Wissen + Skript meniji | Daš KB folder; review/publish dokumenata; provjeriš objection kartice | Sav materijal objavljen |
| **M7** | 9–10 | Chat asistent: tools, citati, context injection, budžeti | Napišeš/odobriš acceptance set (24 pitanja); testiraš ih sam | Acceptance prolazi |
| **M8** | 10–11 | Hardening; restore drill; ostali Gebieti enrichment; Tier-2 import ako je tabelaran | UAT sa 3 agenta (1 sedmica); go-live odluka; hypercare check-in dnevno | Puni go-live |

**Kritični put je kod tebe, ne kod koda:** VIS list (M1), katalog PDF (M3), workshop
(pre-M4), KB folder (M6). Kod se piše brzo — handover fajlova je ono što diktira tempo.

---

## 2. RITAM RADA (preporuka za solo + Claude Code)

- **Sesija = jedna kriška.** Otvoriš Claude Code, on pročita CLAUDE.md, kažeš "M2:
  feedback capture UI" — ne miješaj dvije kriške u sesiji.
- **Kraj svake sesije:** typecheck+testovi zeleni → commit → push → staging deploy.
  Nikad ne ostavljaš crveni main (pravilo §3.2.9 u CLAUDE.md).
- **Tvojih 15 min dnevno** kad je live (od M2): adoption widget + feedback count +
  jedna poruka timu. Flywheel umire bez ovoga brže nego bez ijednog feature-a.
- **Petkom:** kratki pogled na milestone tabelu — šta blokira sljedeću krišku (obično
  fajl ili odluka, ne kod).

---

## 3. RIZICI SOLO BUILDA (pošteno)

| Rizik | Drži ga |
|---|---|
| Tvoje vrijeme (PM posao + ovo) | Kriške su pauzabilne; M2 live rano = vrijednost čak i ako stane |
| Katalog PDF ekstrakcija ispod očekivanja | QA queue + fokus-kategorije prve; ostatak iterativno |
| Adoption agenata | M2 rano + Sanin + dnevni ritual + winner report kao dokaz vrijednosti |
| Tier 2 nikad ne stigne | Sistem dizajniran da radi bez njega (§4A); feedback nosi |
| Scope creep (tvoj vlastiti 😄) | CLAUDE.md je ugovor — nova ideja ide u §14.2 backlog, ne u tekuću krišku |

---

## 4. PRVI KONKRETNI KORACI (danas/sutra)

1. [ ] GitHub repo + CLAUDE.md u root
2. [ ] Supabase staging (EU) + Vercel projekat
3. [ ] Claude Code sesija #1: "M0 — repo skeleton po CLAUDE.md §3.4, auth, RLS skeleton"
4. [ ] Paralelno: nabavi VIS LIST i katalog PDF (kritični put!)
5. [ ] Zakaži workshop sa Saninom (pre-M4, može odmah u kalendar)
