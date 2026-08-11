// M5 LLM ANALYZE core logic (Sonnet-class per §3.2.9), shared between
// scripts/enrich-analyze.mjs and the on-demand API route. Anti-
// hallucination guardrail: every claim must carry a verbatim quote; the
// json_schema forces the field to exist, the prompt forces it to be real.
import { getModel } from "../ai/provider.mjs";

export const MODEL = getModel("analyze");

// 2026-08-11: bumped from 8000 after the first-wave 5,292-company batch
// (CLAUDE.md §14 item 67) truncated 16 real companies at the old ceiling -
// real headroom, not a cost increase, only spent if the model actually
// needs it (same reasoning as the earlier 6000->8000 bump). Shared by both
// the sync path and buildBatchRequest so they can never drift apart.
export const MAX_TOKENS = 16000;

// The 17 real catalog categories (product_categories view) — injected into
// the prompt and enforced via json_schema enum so the model can only ever
// point at a category that actually exists, never invent one.
export const CATALOG_CATEGORIES = [
  "Inspektion & Wartung",
  "Karosseriereparatur",
  "Verglasung",
  "Fahrzeugaufbereitung",
  "Klima",
  "Lampen",
  "Elektrik",
  "Elektromobilität",
  "Reifenmontage",
  "Lackierung",
  "Fahrzeugteile PKW",
  "Fahrzeugteile NFZ",
  "Werkstattausrüstung",
  "Druckluft",
  "Werkzeuge",
  "DIN- & Normteile",
  "Sortimente",
];

export function buildAnalysisSchema() {
  return {
    type: "object",
    properties: {
      strengths: {
        type: "array",
        items: {
          type: "object",
          properties: { claim: { type: "string" }, quote: { type: "string" } },
          required: ["claim", "quote"],
          additionalProperties: false,
        },
      },
      weaknesses: {
        type: "array",
        items: {
          type: "object",
          properties: { claim: { type: "string" }, quote: { type: "string" } },
          required: ["claim", "quote"],
          additionalProperties: false,
        },
      },
      brand_focus_guess: { type: "array", items: { type: "string" } },
      external_opportunities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            reason: { type: "string" },
            quote: { type: "string" },
            catalog_category: {
              anyOf: [{ type: "string", enum: CATALOG_CATEGORIES }, { type: "null" }],
            },
            search_terms: { type: "array", items: { type: "string" } },
            evidence_source: { type: "string", enum: ["review", "website", "name_branche"] },
          },
          required: ["category", "reason", "quote", "catalog_category", "search_terms", "evidence_source"],
          additionalProperties: false,
        },
      },
    },
    required: ["strengths", "weaknesses", "brand_focus_guess", "external_opportunities"],
    additionalProperties: false,
  };
}

export function buildPrompt({ company, enrichment }) {
  const reviewsText = (enrichment.places_reviews ?? [])
    .map((r, i) => `Bewertung ${i + 1} (${r.rating}/5 Sterne): "${r.text ?? "(kein Text)"}"`)
    .join("\n");
  const hasGoogleData = Boolean(enrichment.places_reviews?.length || enrichment.website_text);

  return (
    `Du analysierst eine Firma für einen Verkaufsinnendienst, der Kfz-Werkstätten und ` +
    `verwandte Betriebe mit Verbrauchsmaterial beliefert (Öle, Reiniger, Dichtungen, ` +
    `Werkstattbedarf, DIN-Normteile, Lackier-/Aufbereitungsprodukte, etc.).\n\n` +
    `Firma: ${company.name} (Branche: ${company.branche_code ?? ""} ${company.branche_name ?? "unbekannt"}), ${company.ort ?? ""}\n\n` +
    `Google-Bewertungen (${enrichment.places_rating ?? "?"}/5, ${enrichment.places_review_count ?? 0} gesamt):\n` +
    `${reviewsText || "(kein Google-Places-Treffer bzw. keine Bewertungstexte — diese Firma hat möglicherweise " +
      "gar kein Google-Unternehmensprofil)"}\n\n` +
    `Website-Text:\n${enrichment.website_text || "(keine Website verfügbar)"}\n\n` +
    `Gib zurück:\n` +
    `- strengths: NUR verkaufsrelevante Fakten — womit die Firma sich beschäftigt, was sie reparieren/ ` +
    `anbieten/verkaufen, welche Art von Service/Ausrüstung/Spezialisierung erkennbar ist (z.B. "repariert ` +
    `eigenständig Elektrik", "führt Lackierarbeiten durch", "große Werkstatt mit mehreren Hebebühnen"). ` +
    `KEINE reinen Freundlichkeits-/Stimmungs-Aussagen ohne Sortiments-/Produktbezug (z.B. NICHT "freundlich", ` +
    `"nett", "ehrlich", "zuverlässig" allein — nur wenn direkt mit einer konkreten Leistung verknüpft, z.B. ` +
    `"schneller technischer Notdienst auch am Wochenende" ist ok, "nettes Team" ist es nicht). Jede Aussage ` +
    `mit einem WÖRTLICHEN Zitat als Beleg — NUR aus Bewertungen oder Website-Text ableitbar. Wenn keine ` +
    `davon vorhanden sind, leere Liste — Name/Branche sagen nichts über tatsächliche Servicequalität aus.\n` +
    `- weaknesses: wie strengths, gleiche Regel (verkaufsrelevant, kein reines Stimmungsurteil)\n` +
    `- brand_focus_guess: falls konkrete Automarken erwähnt werden (in Bewertungen, Website, ODER weil die ` +
    `Branche-Bezeichnung selbst eine Marke ist, z.B. Branche "Ford" oder "Fiat") — sonst leere Liste\n` +
    `- external_opportunities: konkrete Produktchancen für Normfest, jede mit:\n` +
    `  - category: kurzes, freies Label der Chance\n` +
    `  - reason: Begründung\n` +
    `  - quote: WÖRTLICHER Beleg — entweder ein Zitat aus Bewertung/Website, ODER (falls keine davon ` +
    `Hinweise liefern) der relevante Teil des Firmennamens oder der Branche-Bezeichnung selbst, wörtlich ` +
    `übernommen (z.B. Firma "Ausbeultechnik Müller" → quote: "Ausbeultechnik" → deutet auf Karosserie-/` +
    `Dellenreparatur hin, unabhängig von Google-Daten)\n` +
    `  - evidence_source: "review", "website" oder "name_branche" — je nachdem woher das quote stammt\n` +
    `  - catalog_category: welche EINE der folgenden echten Katalog-Kategorien am besten passt ` +
    `(exakt einen dieser Namen übernehmen, sonst null wenn keine passt):\n` +
    `    ${CATALOG_CATEGORIES.join(", ")}\n` +
    `  - search_terms: 1-3 kurze deutsche Suchbegriffe (einzelne Wörter, keine Sätze), die im ` +
    `NAMEN eines echten Katalogprodukts dieser Kategorie vorkommen könnten (z.B. "Politur", ` +
    `"Bremsenreiniger", "Dichtring") — leer lassen wenn catalog_category null ist\n\n` +
    (hasGoogleData
      ? ""
      : `WICHTIG: Für diese Firma gibt es KEINE Google-Daten — arbeite ausschließlich mit Firmenname und ` +
        `Branche. Das ist normal (nicht jede Firma hat ein Google-Unternehmensprofil) und kein Fehler. ` +
        `Nutze erkennbare Fachbegriffe im Namen (z.B. "Ausbeultechnik", "Reifenservice", "Lackiererei", ` +
        `"Karosserie") aktiv für external_opportunities mit evidence_source "name_branche" — aber KEINE ` +
        `strengths/weaknesses ohne echte Bewertungs-/Website-Belege.\n\n`) +
    `WICHTIG (gilt IMMER, auch wenn Bewertungen/Website vorhanden sind): Bewertungen/Website decken oft nur ` +
    `einen Teil dessen ab, was die Branche der Firma nahelegt — z.B. erwähnt eine Spedition in ihren ` +
    `Bewertungen selten explizit die Wartung des eigenen Fuhrparks, obwohl sie fast sicher einen hat. Nutze ` +
    `die Branche-Bezeichnung (z.B. "Speditionen", "Betriebsint. NFZ-Werkstätten") DESHALB ZUSÄTZLICH als ` +
    `eigenständige Quelle für external_opportunities mit evidence_source "name_branche" — parallel zu, nicht ` +
    `nur ersatzweise für, Bewertungs-/Website-Belege. Das gilt NICHT für strengths/weaknesses (die bleiben ` +
    `ausschließlich an echte Bewertungs-/Website-Zitate gebunden).\n\n` +
    `WICHTIG: Erfinde nichts. Jede Aussage muss durch ein direktes, wörtliches Zitat belegt sein — aus ` +
    `Bewertungen, Website, ODER dem Firmennamen/der Branche-Bezeichnung selbst (bei external_opportunities). ` +
    `Wenn es für eine Kategorie keine Belege gibt, gib eine leere Liste zurück statt zu spekulieren. ` +
    `Platzhalter wie "(keine Website verfügbar)" oder "(kein Text)" sind KEINE Belege.`
  );
}

/** Escapes a search term for safe use inside a PostgREST .or() ilike filter string. */
function sanitizeTerm(term) {
  return term.replace(/[,()%]/g, "").trim();
}

/**
 * Fetches every company_enrichment row still needing ANALYZE (Places done,
 * not yet analyzed), optionally scoped to a set of Gebiet codes. Paginated
 * via .range() rather than one unbounded select — PostgREST's default
 * 1000-row cap silently truncated the equivalent query in
 * scripts/analyze-backlog.mjs before this (same class of bug already found
 * and fixed multiple times this project, e.g. CLAUDE.md §14 items 32/50).
 *
 * Excludes places_ambiguous rows (2026-08-11, Anis: "dont analyze those
 * 'unklar' firmen" — a real gap this fixes: places_resolved_at gets set
 * even when resolution status is "ambiguous", so without this filter the
 * ANALYZE step would run on companies whose attached reviews/name/address
 * may belong to the wrong real business until a human picks the right
 * candidate in the enrichment queue. Revisit these once the manual queue
 * is cleared — see CLAUDE.md §14's open-items note.
 */
export async function fetchAnalyzeBacklog(admin, { gebiets } = {}) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = admin
      .from("company_enrichment")
      .select(
        "company_id, places_reviews, places_rating, places_review_count, website_text, " +
          "companies!inner(name, branche_code, branche_name, ort, gebiet)",
      )
      .is("analyzed_at", null)
      .not("places_resolved_at", "is", null)
      .eq("places_ambiguous", false)
      .range(from, from + PAGE - 1);
    if (gebiets?.length) query = query.in("companies.gebiet", gebiets);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Looks up up to 3 real products matching an opportunity's catalog_category + search_terms. */
export async function matchCatalogProducts(admin, catalogCategory, searchTerms) {
  const terms = (searchTerms ?? []).map(sanitizeTerm).filter(Boolean);
  if (!catalogCategory || terms.length === 0) return [];

  const orFilter = terms.map((t) => `name.ilike.%${t}%`).join(",");
  const { data, error } = await admin
    .from("products")
    .select("id, sku, name, category_name")
    .eq("category_name", catalogCategory)
    .or(orFilter)
    .limit(3);
  if (error) return [];
  return data ?? [];
}

/**
 * Shared write-back for a completed ANALYZE response — used by both the
 * synchronous path (analyzeCompanyEnrichment) and the Batches API path
 * (scripts/process-analyze-batch.mjs), so the two can never drift on what
 * "done" means (same discipline as pickResolution/rankByNameMatch being
 * shared between the live enrichment resolver and the backlog rescan
 * scripts, CLAUDE.md §14 item 51).
 */
export async function writeAnalysisResult(admin, companyId, message) {
  if (message.stop_reason === "max_tokens") {
    throw new Error("analysis truncated at max_tokens");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);

  const opportunitiesWithProducts = await Promise.all(
    parsed.external_opportunities.map(async (o) => ({
      ...o,
      matched_products: await matchCatalogProducts(admin, o.catalog_category, o.search_terms),
    })),
  );

  const { error } = await admin
    .from("company_enrichment")
    .update({
      strengths: parsed.strengths.map((s) => s.claim),
      weaknesses: parsed.weaknesses.map((w) => w.claim),
      brand_focus_guess: parsed.brand_focus_guess,
      external_opportunities: opportunitiesWithProducts,
      analysis_raw: parsed,
      analyzed_at: new Date().toISOString(),
      analysis_model: MODEL,
      analysis_input_tokens: message.usage.input_tokens,
      analysis_output_tokens: message.usage.output_tokens,
    })
    .eq("company_id", companyId);
  if (error) throw error;

  return {
    parsed: { ...parsed, external_opportunities: opportunitiesWithProducts },
    usage: message.usage,
  };
}

/**
 * Builds one Message Batches API request item for a company — same prompt/
 * schema as the synchronous call, just packaged for
 * client.messages.batches.create({requests: [...]}). custom_id must match
 * ^[a-zA-Z0-9_-]{1,64}$ (Anthropic's real constraint) — a company UUID
 * fits that as-is, so custom_id doubles as the company_id for write-back.
 */
export function buildBatchRequest(companyId, { company, enrichment }) {
  return {
    custom_id: companyId,
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: buildPrompt({ company, enrichment }) }],
      output_config: { format: { type: "json_schema", schema: buildAnalysisSchema() } },
    },
  };
}

/**
 * Runs the LLM ANALYZE step for one company and stores the result. Always
 * runs — company name + branche (real VIS master data) is evidence enough
 * on its own for external_opportunities, even with zero Google data (not
 * every company has a Google Business Profile). strengths/weaknesses stay
 * empty without real review/website text, since name/branche say nothing
 * about actual service quality. Returns { skipped, parsed? } — skipped is
 * always false now, kept in the return shape for caller compatibility.
 */
export async function analyzeCompanyEnrichment(admin, anthropic, companyId) {
  const [{ data: company }, { data: enrichment }] = await Promise.all([
    admin.from("companies").select("id, name, branche_code, branche_name, ort").eq("id", companyId).single(),
    admin.from("company_enrichment").select("*").eq("company_id", companyId).single(),
  ]);
  if (!company || !enrichment) throw new Error("missing company or enrichment row");

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: buildPrompt({ company, enrichment }) }],
    output_config: { format: { type: "json_schema", schema: buildAnalysisSchema() } },
  });
  const response = await stream.finalMessage();
  const result = await writeAnalysisResult(admin, companyId, response);

  return { skipped: false, ...result };
}
