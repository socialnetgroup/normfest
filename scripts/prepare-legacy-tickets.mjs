// Step 1 of 3 for the legacy ticket-system import (CLAUDE.md §14 item 135).
// Parses input/kunden_tickets_FINAL_v2.csv (900,400 real rows from a
// decommissioned old ticketing system), resolves each row's Kundennummer to
// a real company_id, and writes ONLY the matched rows (real number: 29,345
// of 900,400, confirmed directly before building anything) to a local
// staging file for the classification batch step. Nothing is written to the
// database here - this step is pure, free, local CSV parsing.
//
// Usage: node scripts/prepare-legacy-tickets.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import readline from "readline";

import { isFreeNoise } from "../lib/legacy-tickets/noise.mjs";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Written outside the repo (scratchpad, not committed) - a 29k-row staging
// file has no reason to live in version control, same reasoning as every
// other pure-data-migration script in this project.
const OUT_PATH =
  process.env.LEGACY_TICKETS_STAGING_PATH ??
  "C:\\Users\\an1s\\AppData\\Local\\Temp\\claude\\C--Users-an1s-Desktop-normfest\\c871ff7f-002d-4337-88c4-483d023ac9f0\\scratchpad\\legacy-tickets-matched.json";

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        fields.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

async function main() {
  console.log("Loading companies...");
  // Paginated via .range() - PostgREST's default 1000-row cap has silently
  // truncated an unbounded .select() like this multiple times before in
  // this project (CLAUDE.md §14 items 32/50/58/61/70) - always paginate.
  const companies = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin.from("companies").select("id, kundennummer").range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    companies.push(...data);
    if (data.length < PAGE) break;
  }
  const companyByKnr = new Map(companies.map((c) => [c.kundennummer, c.id]));
  console.log(`${companyByKnr.size} companies loaded.`);

  const rl = readline.createInterface({
    input: fs.createReadStream("input/kunden_tickets_FINAL_v2.csv"),
    crlfDelay: Infinity,
  });

  const matched = [];
  let lineNo = 0;
  let total = 0;
  let freeNoiseCount = 0;
  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) continue; // header
    if (!line.trim()) continue;
    const [kundennummer, zeitstempel, kommentar, benutzer] = parseCsvLine(line);
    total++;
    const companyId = companyByKnr.get(kundennummer);
    if (!companyId) continue;
    if (!kommentar || !kommentar.trim()) continue;
    // Free, zero-risk pre-filter (§14 item 135, lib/legacy-tickets/noise.mjs)
    // - a real, reviewed exact-match noise list, never a substring match, so
    // real content is never at risk of being silently dropped here.
    if (isFreeNoise(kommentar)) {
      freeNoiseCount++;
      continue;
    }
    matched.push({
      id: `t${matched.length}`,
      company_id: companyId,
      occurred_at: zeitstempel,
      comment: kommentar.trim(),
      agent_name: benutzer?.trim() || null,
    });
  }

  console.log(`${total} total rows, ${matched.length + freeNoiseCount} matched a real company.`);
  console.log(`${freeNoiseCount} dropped for free (exact-match noise, no LLM call).`);
  console.log(`${matched.length} remain for real LLM classification.`);
  fs.writeFileSync(OUT_PATH, JSON.stringify(matched));
  console.log(`Wrote ${matched.length} rows to ${OUT_PATH}.`);
}

main();
