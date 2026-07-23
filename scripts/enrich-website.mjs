// M5 — website fetch/distill CLI. Core logic lives in
// lib/enrichment/website.mjs, shared with the on-demand API route.
//
// Usage: node scripts/enrich-website.mjs <companyId> [companyId...]
import { createClient } from "@supabase/supabase-js";
import { fetchWebsiteForCompany } from "../lib/enrichment/website.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function enrichOne(companyId) {
  const { data: enrichment } = await admin
    .from("company_enrichment")
    .select("places_name")
    .eq("company_id", companyId)
    .single();
  const label = enrichment?.places_name ?? companyId;

  try {
    const result = await fetchWebsiteForCompany(admin, companyId);
    if (!result.fetched) {
      console.log(`${label}: no website on file, skipping`);
    } else {
      console.log(`${label}: fetched ${result.text.length} chars`);
    }
  } catch (err) {
    console.error(`${label}: fetch failed —`, err.message);
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: node scripts/enrich-website.mjs <companyId> [companyId...]");
    process.exit(1);
  }
  for (const id of ids) {
    await enrichOne(id);
  }
}

main();
