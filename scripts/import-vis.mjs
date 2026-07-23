// One-time/re-run VIS-list import (CLAUDE.md §11.2). Reads input/VIS.xlsx
// and upserts into `companies` on `kundennummer` conflict via the
// service-role client (bypasses RLS). Parsing/mapping logic lives in
// lib/vis-import/core.mjs, shared with the self-serve admin upload screen
// (§14 item 9) — this script is now just the CLI wrapper around it.
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { parseVisWorkbook, writeCompanies } from "../lib/vis-import/core.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const buf = readFileSync("input/VIS.xlsx");
  const { records, skipped } = parseVisWorkbook(buf);

  console.log(`Parsed ${records.length} valid rows, skipped ${skipped.length}`);
  if (skipped.length > 0) console.log("Skipped sample:", skipped.slice(0, 10));

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Dry run — not writing. Sample record:", records[0]);
    return;
  }

  const written = await writeCompanies(admin, records);
  console.log(`Upserted ${written}/${records.length}.`);
  console.log("Done.");
}

main();
