// Polls/retrieves a Message Batch submitted by scripts/submit-analyze-batch.mjs
// and, once processing has ended, streams its .jsonl results and writes each
// succeeded ANALYZE result back to company_enrichment via the same
// writeAnalysisResult() write-back used by the synchronous path
// (analyzeCompanyEnrichment) — so the two paths can never disagree on what
// "done" means. custom_id in each result line is the company_id (see
// buildBatchRequest in lib/enrichment/analyze.mjs).
//
// Usage: node scripts/process-analyze-batch.mjs <batch_id>
// Safe to re-run — if you run it before processing_status is "ended" it
// just reports status and exits without writing anything.
import { createClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { writeAnalysisResult } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

// Real Batches API 50% discount on Sonnet 5 intro pricing.
const BATCH_INPUT_PER_M = 2 * 0.5;
const BATCH_OUTPUT_PER_M = 10 * 0.5;

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("Usage: node scripts/process-analyze-batch.mjs <batch_id>");
    process.exit(1);
  }

  const batch = await anthropic.messages.batches.retrieve(batchId);
  console.log(`Status: ${batch.processing_status}`, batch.request_counts);

  if (batch.processing_status !== "ended") {
    console.log("Batch is still processing — re-run this script once processing_status is \"ended\".");
    return;
  }

  const stats = { succeeded: 0, errored: 0, canceled: 0, expired: 0, writeFailed: 0, inputTokens: 0, outputTokens: 0 };
  const errors = [];

  const results = await anthropic.messages.batches.results(batchId);
  for await (const line of results) {
    const companyId = line.custom_id;
    const result = line.result;

    if (result.type === "succeeded") {
      try {
        const { usage } = await writeAnalysisResult(admin, companyId, result.message);
        stats.succeeded++;
        stats.inputTokens += usage.input_tokens;
        stats.outputTokens += usage.output_tokens;
      } catch (err) {
        stats.writeFailed++;
        errors.push(`${companyId}: write-back failed — ${err.message}`);
      }
    } else if (result.type === "errored") {
      stats.errored++;
      errors.push(`${companyId}: API error — ${result.error?.error?.type ?? "unknown"}`);
    } else {
      stats[result.type] = (stats[result.type] ?? 0) + 1;
    }

    const done = stats.succeeded + stats.errored + stats.canceled + stats.expired + stats.writeFailed;
    if (done % 100 === 0) console.log(`...${done} processed`, stats);
  }

  const cost = (stats.inputTokens * BATCH_INPUT_PER_M) / 1e6 + (stats.outputTokens * BATCH_OUTPUT_PER_M) / 1e6;
  console.log("\nDone. Final stats:", stats);
  console.log(
    `Real cost (50% batch discount applied): $${cost.toFixed(4)} for ${stats.succeeded} companies ` +
      `($${(cost / Math.max(stats.succeeded, 1)).toFixed(4)}/company).`,
  );
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 30)) console.log(`  - ${e}`);
    if (errors.length > 30) console.log(`  ...and ${errors.length - 30} more.`);
  }
}

main();
