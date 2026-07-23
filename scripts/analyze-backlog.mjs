// M5 — analyze-only catch-up pass (CLAUDE.md §13 M5 status). The 788-company
// rollout batch on 2026-07-23 ran Places resolution to completion for all
// targets but hit an Anthropic billing wall partway through ANALYZE, leaving
// 856 companies with real, already-paid-for Places/website data sitting
// unanalyzed. Now that credit is restored, this re-runs ONLY the ANALYZE
// step (analyzeCompanyEnrichment, Sonnet-class per §3.2.9) over that exact
// backlog — it must never re-trigger Places/website fetches, since that
// data is already saved and re-fetching would waste spend for nothing.
//
// Usage: node scripts/analyze-backlog.mjs [limit]
// Omit limit to process the entire backlog.
import { createClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { analyzeCompanyEnrichment } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

async function pool(items, worker, concurrency) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

function purchaseTier(c) {
  if (c.revenue_current_year > 0) return 0;
  if (c.revenue_prior_year > 0) return 1;
  if (c.revenue_prior_prior_year > 0) return 2;
  return 3;
}

// $2/$10 per M tokens — Sonnet 5 intro pricing through 2026-08-31 (CLAUDE.md
// claude-api skill cache, 2026-06-24). Real usage is now tracked per-row
// (company_enrichment.analysis_input_tokens/analysis_output_tokens, added
// this migration) specifically because the pre-instrumentation cost
// estimate for this exact script turned out to be well under what was
// actually spent — this printed total should be trusted over any
// character-count guess.
const SONNET_5_INTRO_INPUT_PER_M = 2;
const SONNET_5_INTRO_OUTPUT_PER_M = 10;

const stats = { analyzed: 0, errors: 0, inputTokens: 0, outputTokens: 0 };

async function analyzeOne(target, index, total) {
  try {
    const result = await analyzeCompanyEnrichment(admin, anthropic, target.company_id);
    stats.analyzed++;
    stats.inputTokens += result.usage.input_tokens;
    stats.outputTokens += result.usage.output_tokens;
  } catch (err) {
    console.error(`[${index + 1}/${total}] ${target.name}: FAILED —`, err.message);
    stats.errors++;
  }
  if ((index + 1) % 25 === 0 || index + 1 === total) {
    console.log(`[${index + 1}/${total}] progress:`, stats);
  }
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;

  const { data: backlog, error } = await admin
    .from("company_enrichment")
    .select("company_id, companies(name, revenue_current_year, revenue_prior_year, revenue_prior_prior_year)")
    .is("analyzed_at", null)
    .not("places_resolved_at", "is", null);
  if (error) throw error;

  const targets = (backlog ?? []).map((row) => ({
    company_id: row.company_id,
    name: row.companies?.name ?? row.company_id,
    revenue_current_year: row.companies?.revenue_current_year ?? 0,
    revenue_prior_year: row.companies?.revenue_prior_year ?? 0,
    revenue_prior_prior_year: row.companies?.revenue_prior_prior_year ?? 0,
  }));

  targets.sort((a, b) => {
    const tierDiff = purchaseTier(a) - purchaseTier(b);
    if (tierDiff !== 0) return tierDiff;
    return (b.revenue_current_year ?? 0) - (a.revenue_current_year ?? 0);
  });

  const run = limit ? targets.slice(0, limit) : targets;
  const tierCounts = [0, 0, 0, 0];
  for (const t of run) tierCounts[purchaseTier(t)]++;

  console.log(`Backlog: ${targets.length} companies total, processing ${run.length}.`);
  console.log(
    `Priority mix — bought this year: ${tierCounts[0]}, last year: ${tierCounts[1]}, ` +
      `year before: ${tierCounts[2]}, no recent purchase: ${tierCounts[3]}`,
  );

  const start = Date.now();
  await pool(run, (t, i) => analyzeOne(t, i, run.length), 5);
  const seconds = Math.round((Date.now() - start) / 1000);

  const cost =
    (stats.inputTokens * SONNET_5_INTRO_INPUT_PER_M) / 1e6 +
    (stats.outputTokens * SONNET_5_INTRO_OUTPUT_PER_M) / 1e6;
  console.log(`\nDone in ${seconds}s. Final stats:`, stats);
  console.log(
    `Real cost: $${cost.toFixed(4)} for ${stats.analyzed} companies ` +
      `($${(cost / Math.max(stats.analyzed, 1)).toFixed(4)}/company).`,
  );
}

main();
