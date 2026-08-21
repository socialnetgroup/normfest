// Step 2 of 3 for the legacy ticket-comment import (CLAUDE.md §14 item 135).
// Reads the staging file written by prepare-legacy-tickets.mjs and submits
// classification requests via the Anthropic Message Batches API (bulk/Haiku
// tier, 50% batch discount) - one request per remaining comment (the free
// noise pre-filter already dropped the unambiguous-noise rows before this
// point, see lib/legacy-tickets/noise.mjs).
//
// A single batch supports up to 100,000 requests (confirmed against the
// real docs, CLAUDE.md §14 item 61) - real row count here (184,513) exceeds
// that, so this splits into multiple batches automatically and prints every
// batch_id (process-legacy-tickets-batch.mjs takes one batch_id at a time).
//
// Usage: node scripts/submit-legacy-tickets-batch.mjs
import fs from "fs";
import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";
import { buildClassifyBatchRequest } from "../lib/legacy-tickets/classify.mjs";

process.loadEnvFile(".env.local");

const STAGING_PATH =
  process.env.LEGACY_TICKETS_STAGING_PATH ??
  "C:\\Users\\an1s\\AppData\\Local\\Temp\\claude\\C--Users-an1s-Desktop-normfest\\c871ff7f-002d-4337-88c4-483d023ac9f0\\scratchpad\\legacy-tickets-matched.json";

const CHUNK_SIZE = 90000; // real limit is 100,000 - safety margin

const anthropic = getAnthropicClient();
const model = getModel("bulk");

async function main() {
  const rows = JSON.parse(fs.readFileSync(STAGING_PATH, "utf8"));
  console.log(`${rows.length} rows to classify.`);

  const batchIds = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const requests = chunk.map((row) => buildClassifyBatchRequest(row, model));
    const batch = await anthropic.messages.batches.create({ requests });
    batchIds.push(batch.id);
    console.log(`Submitted batch ${batch.id} with ${chunk.length} requests (rows ${i}-${i + chunk.length - 1}).`);
  }

  console.log(`\nAll batches submitted: ${batchIds.join(", ")}`);
  console.log("Poll each with: node scripts/process-legacy-tickets-batch.mjs <batch_id>");
}

main();
