// M5 — Places resolver CLI (CLAUDE.md §9/§13). Core logic lives in
// lib/enrichment/places.mjs, shared with the on-demand API route.
//
// Usage: node scripts/enrich-places.mjs <companyId> [companyId...]
import { createClient } from "@supabase/supabase-js";
import { resolvePlaceForCompany } from "../lib/enrichment/places.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function enrichOne(companyId) {
  const { data: company, error } = await admin
    .from("companies")
    .select("id, name, strasse, plz, ort")
    .eq("id", companyId)
    .single();
  if (error || !company) {
    console.error(`${companyId}: company not found`, error);
    return;
  }

  const { status, record } = await resolvePlaceForCompany(admin, company, process.env.GOOGLE_PLACES_API_KEY);

  if (status === "no_match") {
    console.log(`${company.name}: no Places match found`);
  } else if (status === "ambiguous") {
    console.log(`${company.name}: AMBIGUOUS (${record.places_candidates.length} candidates) — queued for admin review`);
  } else {
    console.log(
      `${company.name}: resolved -> "${record.places_name}" (${record.places_review_count ?? 0} reviews, ` +
        `website: ${record.places_website ?? "none"})`,
    );
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: node scripts/enrich-places.mjs <companyId> [companyId...]");
    process.exit(1);
  }
  for (const id of ids) {
    try {
      await enrichOne(id);
    } catch (err) {
      console.error(`${id}: FAILED`, err.message);
    }
  }
}

main();
