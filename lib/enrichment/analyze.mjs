// M5 LLM ANALYZE core logic (Sonnet-class per §3.2.9), shared between
// scripts/enrich-analyze.mjs and the on-demand API route. Anti-
// hallucination guardrail: every claim must carry a verbatim quote; the
// json_schema forces the field to exist, the prompt forces it to be real.
export const MODEL = "claude-sonnet-5";

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
          },
          required: ["category", "reason", "quote", "catalog_category", "search_terms"],
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

  return (
    `Du analysierst eine Firma für einen Verkaufsinnendienst, der Kfz-Werkstätten und ` +
    `verwandte Betriebe mit Verbrauchsmaterial beliefert (Öle, Reiniger, Dichtungen, ` +
    `Werkstattbedarf, DIN-Normteile, Lackier-/Aufbereitungsprodukte, etc.).\n\n` +
    `Firma: ${company.name} (${company.branche_name ?? "Branche unbekannt"}), ${company.ort ?? ""}\n\n` +
    `Google-Bewertungen (${enrichment.places_rating ?? "?"}/5, ${enrichment.places_review_count ?? 0} gesamt):\n` +
    `${reviewsText || "(keine Bewertungstexte verfügbar)"}\n\n` +
    `Website-Text:\n${enrichment.website_text || "(keine Website verfügbar)"}\n\n` +
    `Gib zurück:\n` +
    `- strengths: erkennbare Stärken der Firma, jede mit einem WÖRTLICHEN Zitat als Beleg\n` +
    `- weaknesses: erkennbare Schwächen, jede mit einem WÖRTLICHEN Zitat als Beleg\n` +
    `- brand_focus_guess: falls konkrete Automarken erwähnt werden, auf die sich die Firma ` +
    `erkennbar spezialisiert (z.B. "Mercedes", "BMW") — sonst leere Liste\n` +
    `- external_opportunities: konkrete Produktchancen für Normfest, jede mit:\n` +
    `  - category: kurzes, freies Label der Chance\n` +
    `  - reason, quote: Begründung + WÖRTLICHES Zitat als Beleg\n` +
    `  - catalog_category: welche EINE der folgenden echten Katalog-Kategorien am besten passt ` +
    `(exakt einen dieser Namen übernehmen, sonst null wenn keine passt):\n` +
    `    ${CATALOG_CATEGORIES.join(", ")}\n` +
    `  - search_terms: 1-3 kurze deutsche Suchbegriffe (einzelne Wörter, keine Sätze), die im ` +
    `NAMEN eines echten Katalogprodukts dieser Kategorie vorkommen könnten (z.B. "Politur", ` +
    `"Bremsenreiniger", "Dichtring") — leer lassen wenn catalog_category null ist\n\n` +
    `WICHTIG: Erfinde nichts. Jede Aussage muss durch ein direktes, wörtliches Zitat aus den ` +
    `obigen Texten belegt sein. Wenn es für eine Kategorie keine Belege gibt, gib eine leere ` +
    `Liste zurück statt zu spekulieren. Platzhalter wie "(keine Website verfügbar)" oder ` +
    `"(kein Text)" sind KEINE Belege — das Fehlen einer Website oder eines Bewertungstexts ` +
    `ist selbst keine Stärke oder Schwäche der Firma und darf nicht als eine ausgegeben werden.`
  );
}

/** Escapes a search term for safe use inside a PostgREST .or() ilike filter string. */
function sanitizeTerm(term) {
  return term.replace(/[,()%]/g, "").trim();
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

/** Runs the LLM ANALYZE step for one company and stores the result. Returns { skipped, parsed? } */
export async function analyzeCompanyEnrichment(admin, anthropic, companyId) {
  const [{ data: company }, { data: enrichment }] = await Promise.all([
    admin.from("companies").select("id, name, branche_name, ort").eq("id", companyId).single(),
    admin.from("company_enrichment").select("*").eq("company_id", companyId).single(),
  ]);
  if (!company || !enrichment) throw new Error("missing company or enrichment row");
  if (!enrichment.places_reviews?.length && !enrichment.website_text) {
    return { skipped: true, reason: "no_evidence" };
  }

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: buildPrompt({ company, enrichment }) }],
    output_config: { format: { type: "json_schema", schema: buildAnalysisSchema() } },
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "max_tokens") {
    throw new Error("analysis truncated at max_tokens");
  }

  const textBlock = response.content.find((b) => b.type === "text");
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
    })
    .eq("company_id", companyId);
  if (error) throw error;

  return { skipped: false, parsed: { ...parsed, external_opportunities: opportunitiesWithProducts } };
}
