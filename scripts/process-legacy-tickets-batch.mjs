// Step 3 of 3 for the legacy ticket-comment import (CLAUDE.md §14 item 135).
// Polls/retrieves one Message Batch submitted by
// scripts/submit-legacy-tickets-batch.mjs and, once processing has ended,
// writes every useful=true row into legacy_ticket_comments - noise rows are
// never inserted at all, matching Anis's "save the positive ones" ask (not
// "save everything and flag it"). custom_id in each result line is the
// staging row's synthetic id (t0, t1, ...), looked up against the same
// staging file to recover company_id/occurred_at/comment/agent_name.
//
// Usage: node scripts/process-legacy-tickets-batch.mjs <batch_id>
// Safe to re-run, including after processing_status is already "ended" -
// a real bug found live (2026-08-21): the first version used a plain
// .insert(), and re-running it against an already-processed batch silently
// double-inserted every row (2,169 real duplicates, cleaned up manually).
// legacy_ticket_comments now has a real unique constraint on
// (company_id, occurred_at, comment) and this uses .upsert(...,
// {ignoreDuplicates: true}) instead, so a second run against the same
// batch is a genuine no-op.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { getAnthropicClient } from "../lib/ai/provider.mjs";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

const STAGING_PATH =
  process.env.LEGACY_TICKETS_STAGING_PATH ??
  "C:\\Users\\an1s\\AppData\\Local\\Temp\\claude\\C--Users-an1s-Desktop-normfest\\c871ff7f-002d-4337-88c4-483d023ac9f0\\scratchpad\\legacy-tickets-matched.json";

// Real Batches API 50% discount on Haiku 4.5 pricing ($1/1M in, $5/1M out).
const BATCH_INPUT_PER_M = 1 * 0.5;
const BATCH_OUTPUT_PER_M = 5 * 0.5;
const INSERT_CHUNK = 500;

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("Usage: node scripts/process-legacy-tickets-batch.mjs <batch_id>");
    process.exit(1);
  }

  const batch = await anthropic.messages.batches.retrieve(batchId);
  console.log(`Status: ${batch.processing_status}`, batch.request_counts);
  if (batch.processing_status !== "ended") {
    console.log("Still processing - re-run this script once processing_status is \"ended\".");
    return;
  }

  const rowsById = new Map(JSON.parse(fs.readFileSync(STAGING_PATH, "utf8")).map((r) => [r.id, r]));

  const stats = { succeeded: 0, useful: 0, noise: 0, errored: 0, other: 0, inputTokens: 0, outputTokens: 0 };
  const errors = [];
  const toInsert = [];

  async function flushInserts() {
    if (toInsert.length === 0) return;
    const { error } = await admin
      .from("legacy_ticket_comments")
      .upsert(toInsert.splice(0, toInsert.length), {
        onConflict: "company_id,occurred_at,comment",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  const results = await anthropic.messages.batches.results(batchId);
  for await (const line of results) {
    const row = rowsById.get(line.custom_id);
    const result = line.result;

    if (result.type === "succeeded") {
      stats.succeeded++;
      stats.inputTokens += result.message.usage.input_tokens;
      stats.outputTokens += result.message.usage.output_tokens;
      const textBlock = result.message.content.find((b) => b.type === "text");
      const parsed = JSON.parse(textBlock.text);
      if (parsed.useful) {
        stats.useful++;
        if (row) {
          toInsert.push({
            company_id: row.company_id,
            occurred_at: row.occurred_at,
            comment: row.comment,
            agent_name: row.agent_name,
          });
        }
      } else {
        stats.noise++;
      }
    } else if (result.type === "errored") {
      stats.errored++;
      errors.push(`${line.custom_id}: ${result.error?.error?.type ?? "unknown"}`);
    } else {
      stats.other++;
    }

    if (toInsert.length >= INSERT_CHUNK) await flushInserts();

    const done = stats.succeeded + stats.errored + stats.other;
    if (done % 5000 === 0) console.log(`...${done} processed`, stats);
  }
  await flushInserts();

  const cost = (stats.inputTokens * BATCH_INPUT_PER_M) / 1e6 + (stats.outputTokens * BATCH_OUTPUT_PER_M) / 1e6;
  console.log("\nDone. Final stats:", stats);
  console.log(`Real cost (50% batch discount applied): $${cost.toFixed(4)}.`);
  console.log(`${stats.useful} rows classified useful (upserted - a re-run against an already-processed batch is a no-op, not a re-insert).`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 30)) console.log(`  - ${e}`);
    if (errors.length > 30) console.log(`  ...and ${errors.length - 30} more.`);
  }
}

main();
