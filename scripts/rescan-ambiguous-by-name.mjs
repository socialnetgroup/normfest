// Zero-API-cost auto-resolve pass for the ambiguous Places queue
// (2026-08-09), Anis: after the whole-book Places rollout grew the queue
// from 55 to 1,291, direct inspection showed the existing auto-resolve
// rules (exact PLZ match, same address) don't apply to almost any of them -
// zero rows shared an address (scripts/rescan-ambiguous-same-address.mjs
// found 0/1291). Real cause: for many companies, the raw Places text search
// returned several unrelated businesses in the same city/area (e.g. "KFZ
// Style Hamm" got 12 candidates across 6 different streets/3 postal codes)
// rather than 2 listings of the same real business - the resolver never
// checked candidate NAME similarity, only address, so all of those got
// dumped into the manual queue even when one candidate's name obviously
// matches the real company.
//
// This re-scores already-stored places_candidates (no new Places API calls -
// same "free, safe to run any time" shape as the address-merge script),
// reusing the exact same scoring (bestNameMatch: decisive tier, then a
// softer tier) that lib/enrichment/places.mjs's pickResolution() now
// applies live during new resolutions - one implementation, never two that
// can drift apart (§3.2.6). This script exists to sweep the *existing*
// ambiguous backlog; pickResolution() prevents new ones from needing it.
//
// Usage: node scripts/rescan-ambiguous-by-name.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";

import { bestNameMatch } from "../lib/enrichment/places.mjs";

process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAllAmbiguous() {
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

function mergeSingle(place) {
  return {
    places_place_id: place.id,
    places_name: place.displayName?.text ?? null,
    places_address: place.formattedAddress ?? null,
    places_website: place.websiteUri ?? null,
    places_phone: place.nationalPhoneNumber ?? null,
    places_rating: place.rating ?? null,
    places_review_count: place.userRatingCount ?? null,
    places_reviews: (place.reviews ?? []).slice(0, 5).map((r) => ({
      rating: r.rating ?? null,
      text: r.text?.text ?? null,
      published_at: r.publishTime ?? null,
    })),
    places_ambiguous: false,
    places_candidates: null,
    places_resolved_at: new Date().toISOString(),
  };
}

async function main() {
  const rows = await fetchAllAmbiguous();
  console.log(`${rows.length} ambiguous Einträge werden nach Namensähnlichkeit geprüft...\n`);

  let resolved = 0;
  let staysAmbiguous = 0;

  for (const row of rows) {
    const companyName = row.companies?.name;
    const candidates = row.places_candidates ?? [];
    if (!companyName || candidates.length < 2) {
      staysAmbiguous++;
      continue;
    }

    const match = bestNameMatch(candidates, companyName);
    if (!match) {
      staysAmbiguous++;
      continue;
    }

    resolved++;
    console.log(`  [Name-Match] "${companyName}" -> "${match.displayName?.text}" (${match.formattedAddress})`);

    if (!DRY_RUN) {
      const { error } = await admin.from("company_enrichment").update(mergeSingle(match)).eq("id", row.id);
      if (error) console.log(`    Fehler: ${error.message}`);
    }
  }

  console.log(`\nAufgelöst (Namens-Match): ${resolved}`);
  console.log(`Bleibt echt mehrdeutig: ${staysAmbiguous}`);
  if (DRY_RUN) console.log("\n--dry-run: keine Schreibvorgänge.");
}

main();
