// M5 — LLM ANALYZE CLI. Core logic lives in lib/enrichment/analyze.mjs,
// shared with the on-demand API route.
//
// Usage: node scripts/enrich-analyze.mjs <companyId> [companyId...]
import { createClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { analyzeCompanyEnrichment } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

async function analyzeOne(companyId) {
  const { data: company } = await admin.from("companies").select("name").eq("id", companyId).single();
  const label = company?.name ?? companyId;

  try {
    const result = await analyzeCompanyEnrichment(admin, anthropic, companyId);
    if (result.skipped) {
      console.log(`${label}: no reviews or website text — nothing to analyze, skipping`);
      return;
    }
    const { parsed, usage } = result;
    console.log(`\n=== ${label} ===`);
    console.log("Stärken:", parsed.strengths.map((s) => `${s.claim} ("${s.quote}")`));
    console.log("Schwächen:", parsed.weaknesses.map((w) => `${w.claim} ("${w.quote}")`));
    console.log("Markenfokus:", parsed.brand_focus_guess);
    console.log(
      "Chancen:",
      parsed.external_opportunities.map((o) => `${o.category} — ${o.reason} ("${o.quote}")`),
    );
    console.log(`Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);
  } catch (err) {
    console.error(`${label}: FAILED —`, err.message);
  }
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
