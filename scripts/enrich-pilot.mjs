// M5 pilot batch (CLAUDE.md §13: "~200 companies, one Gebiet"). Runs the
// full Places -> website -> ANALYZE pipeline against a real slice of the
// customer book. Modest concurrency to keep total runtime reasonable
// without hammering the Places/Anthropic APIs.
//
// Usage: node scripts/enrich-pilot.mjs <gebiet> [limit=200]
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolvePlaceForCompany } from "../lib/enrichment/places.mjs";
import { fetchWebsiteForCompany } from "../lib/enrichment/website.mjs";
import { analyzeCompanyEnrichment } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = new Anthropic();

async function pool(items, worker, concurrency) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

const stats = { resolved: 0, ambiguous: 0, no_match: 0, websiteFetched: 0, analyzed: 0, skippedAnalysis: 0, errors: 0 };

async function processCompany(company, index, total) {
  try {
    const { status, record } = await resolvePlaceForCompany(admin, company, process.env.GOOGLE_PLACES_API_KEY);
    stats[status === "no_match" ? "no_match" : status]++;

    if (status === "resolved") {
      const websiteUrl = record.places_website;
      if (websiteUrl) {
        try {
          const websiteResult = await fetchWebsiteForCompany(admin, company.id);
          if (websiteResult.fetched) stats.websiteFetched++;
        } catch {
          // website fetch failures are expected (bot protection etc.) — not fatal
        }
      }
      try {
        const analysis = await analyzeCompanyEnrichment(admin, anthropic, company.id);
        if (analysis.skipped) stats.skippedAnalysis++;
        else stats.analyzed++;
      } catch (err) {
        console.error(`[${index + 1}/${total}] ${company.name}: analyze failed —`, err.message);
        stats.errors++;
      }
    }

    if ((index + 1) % 20 === 0 || index + 1 === total) {
      console.log(`[${index + 1}/${total}] progress:`, stats);
    }
  } catch (err) {
    console.error(`[${index + 1}/${total}] ${company.name}: FAILED —`, err.message);
    stats.errors++;
  }
}

async function main() {
  const gebiet = process.argv[2];
  const limit = Number(process.argv[3] ?? 200);
  if (!gebiet) {
    console.error("Usage: node scripts/enrich-pilot.mjs <gebiet> [limit=200]");
    process.exit(1);
  }

  const { data: alreadyEnriched } = await admin.from("company_enrichment").select("company_id");
  const enrichedIds = new Set((alreadyEnriched ?? []).map((e) => e.company_id));

  let all = [];
  let from = 0;
  while (all.length < limit * 3) {
    const { data } = await admin
      .from("companies")
      .select("id, name, strasse, plz, ort")
      .eq("gebiet", gebiet)
      .eq("active", true)
      .eq("do_not_contact", false)
      .not("strasse", "is", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const targets = all.filter((c) => !enrichedIds.has(c.id)).slice(0, limit);
  console.log(`Gebiet ${gebiet}: ${targets.length} companies to process (of ${all.length} eligible, ${enrichedIds.size} already enriched overall)`);

  const start = Date.now();
  await pool(targets, (c, i) => processCompany(c, i, targets.length), 5);
  const seconds = Math.round((Date.now() - start) / 1000);

  console.log(`\nDone in ${seconds}s. Final stats:`, stats);
}

main();
