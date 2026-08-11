// Submits the ANALYZE backlog (§13 M5/M8) via the Anthropic Message Batches
// API instead of one-at-a-time sync calls (scripts/analyze-backlog.mjs) —
// 50% off both input and output tokens for this bulk/non-realtime workload,
// zero quality tradeoff (same model, same prompt, same json_schema
// structured output — Batches just changes HOW the requests are sent, not
// what they ask for). CLAUDE.md, "Batches API implementation" discussion,
// 2026-08-11.
//
// A single batch supports up to 100,000 requests / 256MB (confirmed against
// the real docs, not assumed) — the entire multi-agent backlog fits in ONE
// batch with room to spare, so there's no need to split per agent unless you
// want to (the --gebiet filter still lets you do that if useful for other
// reasons, e.g. reviewing one agent's results before moving to the next).
//
// Usage:
//   node scripts/submit-analyze-batch.mjs [limit] [gebiet1,gebiet2,...]
// Omit limit to submit the entire matching backlog. Omit gebiet to submit
// across the whole book. Never re-fetches Places/website data — only reads
// already-saved company_enrichment rows, same as analyze-backlog.mjs.
import { createClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { buildBatchRequest, fetchAnalyzeBacklog } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

// Real measured sync-call baseline (CLAUDE.md §13 M8): $0.0433/company,
// halved for the real Batches API 50% discount. Estimate only — actual
// batch cost is only known once results land and carry their own usage
// tokens (see scripts/process-analyze-batch.mjs).
const ESTIMATED_PER_COMPANY = 0.0433 * 0.5;

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  const gebiets = process.argv[3] ? process.argv[3].split(",").map((g) => g.trim()) : undefined;

  console.log("Fetching backlog...", gebiets ? `(Gebiet: ${gebiets.join(", ")})` : "(whole book)");
  const backlog = await fetchAnalyzeBacklog(admin, { gebiets });
  const targets = limit ? backlog.slice(0, limit) : backlog;

  console.log(`Backlog: ${backlog.length} companies total, submitting ${targets.length}.`);
  if (targets.length === 0) {
    console.log("Nothing to submit.");
    return;
  }
  if (targets.length > 100000) {
    console.error(`${targets.length} exceeds the real 100,000-request-per-batch limit — pass a smaller limit or split by gebiet.`);
    process.exit(1);
  }

  const requests = targets.map((row) =>
    buildBatchRequest(row.company_id, {
      company: row.companies,
      enrichment: row,
    }),
  );

  console.log(`Estimated cost (rough, based on the measured sync-call average): ~$${(targets.length * ESTIMATED_PER_COMPANY).toFixed(2)}.`);
  console.log("Submitting batch...");

  const batch = await anthropic.messages.batches.create({ requests });

  console.log("\nBatch created.");
  console.log(`  id:                ${batch.id}`);
  console.log(`  processing_status: ${batch.processing_status}`);
  console.log(`  request_counts:    ${JSON.stringify(batch.request_counts)}`);
  console.log(`  expires_at:        ${batch.expires_at}`);
  console.log(`\nMost batches finish within an hour, up to 24h max. Once processing_status`);
  console.log(`is "ended", run:\n`);
  console.log(`  node scripts/process-analyze-batch.mjs ${batch.id}\n`);
  console.log(`to write the results back and see the real cost.`);
}

main();
