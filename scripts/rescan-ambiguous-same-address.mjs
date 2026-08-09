// One-off: re-checks every currently-ambiguous company_enrichment row
// against the new same-address auto-merge rule (lib/enrichment/places.mjs
// pickResolution) without calling the Places API again - the candidates
// are already stored in places_candidates from the original search, so
// this is free and safe to run any time.
//
// Usage: node scripts/rescan-ambiguous-same-address.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";

import { mergeCandidates } from "../lib/enrichment/places.mjs";

process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function addressKey(formattedAddress) {
  if (!formattedAddress) return null;
  const street = formattedAddress.split(",")[0]?.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  const plzMatch = formattedAddress.match(/\b\d{5}\b/);
  if (!street || !plzMatch) return null;
  return `${street}|${plzMatch[0]}`;
}

async function fetchAllAmbiguous() {
  // PostgREST defaults to a 1000-row cap - the whole-book Places rollout
  // (2026-07-27) grew the ambiguous queue to 1,291, so an unpaginated
  // fetch here silently truncates and produces misleading results (same
  // class of bug already hit and fixed elsewhere in this app, e.g. the
  // company_gebiet_coverage / strip-pleasantry-claims scripts).
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("company_enrichment")
      .select("id, company_id, places_candidates, companies(name)")
      .eq("places_ambiguous", true)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function main() {
  const rows = await fetchAllAmbiguous();

  console.log(`${rows.length} ambiguous Einträge werden geprüft...\n`);

  let merged = 0;
  let stillAmbiguous = 0;
  for (const row of rows) {
    const candidates = row.places_candidates ?? [];
    const keys = candidates.map((c) => addressKey(c.formattedAddress));
    const sameAddress = candidates.length > 1 && keys.every((k) => k && k === keys[0]);

    if (!sameAddress) {
      stillAmbiguous++;
      continue;
    }

    merged++;
    console.log(`  [gleiche Adresse, zusammengeführt] ${row.companies?.name ?? row.company_id}`);
    console.log(`    ${candidates.map((c) => c.displayName?.text).join("  +  ")}`);

    if (!DRY_RUN) {
      const record = mergeCandidates(candidates);
      const { error: updateError } = await admin.from("company_enrichment").update(record).eq("id", row.id);
      if (updateError) console.log(`    Fehler: ${updateError.message}`);
    }
  }

  console.log(`\nZusammengeführt (gleiche Adresse): ${merged}`);
  console.log(`Bleibt echt mehrdeutig (unterschiedliche Adresse): ${stillAmbiguous}`);
  if (DRY_RUN) console.log("\n--dry-run: keine Schreibvorgänge.");
}

main();
