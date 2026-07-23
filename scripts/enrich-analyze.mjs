// M5 — LLM ANALYZE step (CLAUDE.md §9, Sonnet-class per §3.2.9 cost-tier
// rule: enrichment ANALYZE needs quote fidelity, not the cheap bulk tier).
// Anti-hallucination guardrail: every strength/weakness/opportunity must
// carry a verbatim quote from the actual reviews/website text — the
// json_schema forces the field to exist, and the prompt forces it to be
// a real quote, not a paraphrase. Empty arrays are the correct output
// when there's no evidence, not a failure.
//
// Usage: node scripts/enrich-analyze.mjs <companyId> [companyId...]
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MODEL = "claude-sonnet-5";

const anthropic = new Anthropic();

const AnalysisSchema = {
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
        },
        required: ["category", "reason", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["strengths", "weaknesses", "brand_focus_guess", "external_opportunities"],
  additionalProperties: false,
};

function buildPrompt({ company, enrichment }) {
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
    `- external_opportunities: konkrete Produktchancen für Normfest, jede mit category, ` +
    `reason und einem WÖRTLICHEN Zitat als Beleg\n\n` +
    `WICHTIG: Erfinde nichts. Jede Aussage muss durch ein direktes, wörtliches Zitat aus den ` +
    `obigen Texten belegt sein. Wenn es für eine Kategorie keine Belege gibt, gib eine leere ` +
    `Liste zurück statt zu spekulieren.`
  );
}

async function analyzeOne(companyId) {
  const [{ data: company }, { data: enrichment }] = await Promise.all([
    admin.from("companies").select("id, name, branche_name, ort").eq("id", companyId).single(),
    admin.from("company_enrichment").select("*").eq("company_id", companyId).single(),
  ]);

  if (!company || !enrichment) {
    console.error(`${companyId}: missing company or enrichment row — run enrich-places.mjs first`);
    return;
  }
  if (!enrichment.places_reviews?.length && !enrichment.website_text) {
    console.log(`${company.name}: no reviews or website text — nothing to analyze, skipping`);
    return;
  }

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: buildPrompt({ company, enrichment }) }],
    output_config: { format: { type: "json_schema", schema: AnalysisSchema } },
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "max_tokens") {
    console.error(`${company.name}: truncated at max_tokens — skipping (raise max_tokens and retry)`);
    return;
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);

  const { error } = await admin
    .from("company_enrichment")
    .update({
      strengths: parsed.strengths.map((s) => s.claim),
      weaknesses: parsed.weaknesses.map((w) => w.claim),
      brand_focus_guess: parsed.brand_focus_guess,
      external_opportunities: parsed.external_opportunities,
      analysis_raw: parsed,
      analyzed_at: new Date().toISOString(),
      analysis_model: MODEL,
    })
    .eq("company_id", companyId);
  if (error) {
    console.error(`${company.name}: DB write failed`, error);
    return;
  }

  console.log(`\n=== ${company.name} ===`);
  console.log("Stärken:", parsed.strengths.map((s) => `${s.claim} ("${s.quote}")`));
  console.log("Schwächen:", parsed.weaknesses.map((w) => `${w.claim} ("${w.quote}")`));
  console.log("Markenfokus:", parsed.brand_focus_guess);
  console.log(
    "Chancen:",
    parsed.external_opportunities.map((o) => `${o.category} — ${o.reason} ("${o.quote}")`),
  );
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: node scripts/enrich-analyze.mjs <companyId> [companyId...]");
    process.exit(1);
  }
  for (const id of ids) {
    await analyzeOne(id);
  }
}

main();
