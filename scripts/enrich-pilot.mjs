// M5 batch enrichment (CLAUDE.md §13). Runs the full Places -> website ->
// ANALYZE pipeline against a real slice of the customer book. Modest
// concurrency to keep total runtime reasonable without hammering the
// Places/Anthropic APIs.
//
// Usage: node scripts/enrich-pilot.mjs <limit> [gebiet] [--places-only]
// Omit gebiet to pull from across the whole eligible book instead of one
// Gebiet — used for the post-pilot 1000/1800-company rollout-readiness
// batches (2026-07-23, Anis: wants a broader sample before a real go-live
// funding decision, not scoped to one Gebiet anymore).
//
// --places-only (2026-07-27): Places resolution + website fetch never touch
// Anthropic (confirmed - neither lib/enrichment/places.mjs nor website.mjs
// import the Anthropic client), only analyzeCompanyEnrichment does. This flag
// skips the analyze call so Places/website spend (already-funded GCP credit)
// can run ahead of Anthropic credit landing - scripts/analyze-backlog.mjs
// picks up every row left with places_resolved_at set and analyzed_at null,
// so nothing here is wasted or re-fetched later.
import { createClient } from "@supabase/supabase-js";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { resolvePlaceForCompany } from "../lib/enrichment/places.mjs";
import { fetchWebsiteForCompany } from "../lib/enrichment/website.mjs";
import { analyzeCompanyEnrichment } from "../lib/enrichment/analyze.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

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

// $2/$10 per M tokens — Sonnet 5 intro pricing through 2026-08-31.
const SONNET_5_INTRO_INPUT_PER_M = 2;
const SONNET_5_INTRO_OUTPUT_PER_M = 10;

const stats = {
  resolved: 0,
  // resolvePlaceForCompany can also return "resolved_merged" (same-address
  // auto-merge, §9) - was missing here, so it printed as NaN instead of a
  // real count (cosmetic only, never affected what got written to the DB).
  resolved_merged: 0,
  ambiguous: 0,
  no_match: 0,
  websiteFetched: 0,
  analyzedWithGoogleData: 0,
  analyzedNameOnly: 0,
  errors: 0,
  analyzeInputTokens: 0,
  analyzeOutputTokens: 0,
};

async function processCompany(company, index, total, placesOnly) {
  try {
    const { status, record } = await resolvePlaceForCompany(admin, company, process.env.GOOGLE_PLACES_API_KEY);
    stats[status === "no_match" ? "no_match" : status]++;

    let hasGoogleData = false;
    if (status === "resolved") {
      hasGoogleData = Boolean(record.places_reviews?.length);
      const websiteUrl = record.places_website;
      if (websiteUrl) {
        try {
          const websiteResult = await fetchWebsiteForCompany(admin, company.id);
          if (websiteResult.fetched) {
            stats.websiteFetched++;
            hasGoogleData = true;
          }
        } catch {
          // website fetch failures are expected (bot protection etc.) — not fatal
        }
      }
    }

    if (placesOnly) {
      if ((index + 1) % 20 === 0 || index + 1 === total) {
        console.log(`[${index + 1}/${total}] progress:`, stats);
      }
      return;
    }

    // Analyze regardless of Places outcome — company name + branche (real
    // VIS master data) is evidence enough on its own, and not every company
    // has a Google Business Profile in the first place.
    try {
      const result = await analyzeCompanyEnrichment(admin, anthropic, company.id);
      if (hasGoogleData) stats.analyzedWithGoogleData++;
      else stats.analyzedNameOnly++;
      stats.analyzeInputTokens += result.usage.input_tokens;
      stats.analyzeOutputTokens += result.usage.output_tokens;
    } catch (err) {
      console.error(`[${index + 1}/${total}] ${company.name}: analyze failed —`, err.message);
      stats.errors++;
    }

    if ((index + 1) % 20 === 0 || index + 1 === total) {
      console.log(`[${index + 1}/${total}] progress:`, stats);
    }
  } catch (err) {
    console.error(`[${index + 1}/${total}] ${company.name}: FAILED —`, err.message);
    stats.errors++;
  }
}

// Priority tier (2026-07-23, Anis): enrich real/recent customers first —
// bought this year, then last year, then the year before, then companies
// with no recent purchase history at all. Real spend should go where the
// flywheel actually has a live relationship, not blindly across the book.
function purchaseTier(c) {
  if (c.revenue_current_year > 0) return 0;
  if (c.revenue_prior_year > 0) return 1;
  if (c.revenue_prior_prior_year > 0) return 2;
  return 3;
}

async function main() {
  const placesOnly = process.argv.includes("--places-only");
  const positional = process.argv.slice(2).filter((a) => a !== "--places-only");
  const limit = Number(positional[0]);
  const gebiet = positional[1];
  if (!limit) {
    console.error("Usage: node scripts/enrich-pilot.mjs <limit> [gebiet] [--places-only]");
    process.exit(1);
  }

  // Paginated the same way the companies query below already is - an
  // unpaginated select here hits PostgREST's default 1000-row cap and
  // silently drops rows once company_enrichment passes 1000 (real bug found
  // 2026-07-27: with 1078 real rows, 78 were invisible to this check, so
  // some already-enriched companies could be reprocessed as if new).
  const enrichedIds = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("company_enrichment").select("company_id").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) enrichedIds.add(row.company_id);
    if (data.length < 1000) break;
  }

  let all = [];
  let from = 0;
  for (;;) {
    let query = admin
      .from("companies")
      .select("id, name, strasse, plz, ort, revenue_current_year, revenue_prior_year, revenue_prior_prior_year")
      .eq("active", true)
      .eq("do_not_contact", false)
      .not("strasse", "is", null);
    if (gebiet) query = query.eq("gebiet", gebiet);
    const { data } = await query.range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const candidates = all.filter((c) => !enrichedIds.has(c.id));
  candidates.sort((a, b) => {
    const tierDiff = purchaseTier(a) - purchaseTier(b);
    if (tierDiff !== 0) return tierDiff;
    return (b.revenue_current_year ?? 0) - (a.revenue_current_year ?? 0);
  });
  const targets = candidates.slice(0, limit);

  const tierCounts = [0, 0, 0, 0];
  for (const c of targets) tierCounts[purchaseTier(c)]++;
  console.log(
    `${gebiet ? `Gebiet ${gebiet}` : "Gesamte Basis"}: ${targets.length} companies to process ` +
      `(of ${candidates.length} unenriched candidates, ${enrichedIds.size} already enriched overall)`,
  );
  console.log(
    `Priority mix — bought this year: ${tierCounts[0]}, last year: ${tierCounts[1]}, ` +
      `year before: ${tierCounts[2]}, no recent purchase: ${tierCounts[3]}`,
  );

  const start = Date.now();
  await pool(targets, (c, i) => processCompany(c, i, targets.length, placesOnly), 5);
  const seconds = Math.round((Date.now() - start) / 1000);

  const analyzeCost =
    (stats.analyzeInputTokens * SONNET_5_INTRO_INPUT_PER_M) / 1e6 +
    (stats.analyzeOutputTokens * SONNET_5_INTRO_OUTPUT_PER_M) / 1e6;
  console.log(`\nDone in ${seconds}s. Final stats:`, stats);
  console.log(
    `Real ANALYZE cost (Anthropic only, excludes Places API spend): $${analyzeCost.toFixed(4)}.`,
  );
}

main();
