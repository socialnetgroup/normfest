// CLAUDE.md §14 item 11, resolved 2026-07-24 (Anis: "moze kad vec imamo, ali
// iz VIS liste kao default ostaviti ako odstupa" — write Places-sourced
// contact data into companies master data, but VIS import data always wins
// on conflict). Fill-empty-only, same pattern as the existing brand_focus
// write-back (§9): never overwrites a real VIS value, only fills a blank.
//
// Scope: telefon + website. Address deliberately excluded (see migration
// 20260724010000 comment) — Places only gives one formatted address string,
// and parsing that into companies' structured strasse/plz/ort/land risks
// silently corrupting good VIS data for no clear benefit.
//
// Idempotent / safely re-runnable: run again any time new companies get
// enriched — it only ever touches rows where the target field is still null.
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAllEnriched() {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("company_enrichment")
      .select("company_id, places_phone, places_website")
      .or("places_phone.not.is.null,places_website.not.is.null")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function main() {
  const enriched = await fetchAllEnriched();
  console.log(`Found ${enriched.length} companies with Places phone/website data.`);

  const companyIds = enriched.map((e) => e.company_id);
  const byId = new Map();
  const chunkSize = 200;
  for (let i = 0; i < companyIds.length; i += chunkSize) {
    const chunk = companyIds.slice(i, i + chunkSize);
    const { data: companies, error } = await admin.from("companies").select("id, telefon, website").in("id", chunk);
    if (error) throw error;
    for (const c of companies) byId.set(c.id, c);
  }

  let phoneFilled = 0;
  let websiteFilled = 0;
  let skipped = 0;

  for (const e of enriched) {
    const company = byId.get(e.company_id);
    if (!company) continue;

    const patch = {};
    if (!company.telefon && e.places_phone) patch.telefon = e.places_phone;
    if (!company.website && e.places_website) patch.website = e.places_website;

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    const { error: updateError } = await admin.from("companies").update(patch).eq("id", e.company_id);
    if (updateError) {
      console.error(`FAILED — ${e.company_id}:`, updateError.message);
      continue;
    }
    if (patch.telefon) phoneFilled++;
    if (patch.website) websiteFilled++;
  }

  console.log(`\nDone. telefon filled: ${phoneFilled}, website filled: ${websiteFilled}, already complete: ${skipped}.`);
}

main();
