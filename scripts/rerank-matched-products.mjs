// Zero-LLM-cost re-match/re-rank pass for real company_enrichment.external_opportunities
// rows (2026-08-20), Anis: "dodaj vise prijedloga po eksternoj sansi... rangiraj
// bitnije prema manje bitnijim proizvodima" - lib/enrichment/analyze.mjs's
// matchCatalogProducts() was fixed to rank candidates by a real cross-sell-
// frequency proxy instead of showing an arbitrary DB-order top 3 (see that
// file's own comment on the new ranking). That fix only applies to FUTURE
// ANALYZE calls, though - the ~14,169 companies already analyzed keep their
// old, unranked matched_products until re-matched. Since catalog_category
// and search_terms are already stored per opportunity (real LLM output from
// the original analysis), re-running just the matching/ranking step needs
// zero Anthropic spend - this script does exactly that, never touching
// strengths/weaknesses/quotes.
//
// Usage: node scripts/rerank-matched-products.mjs [--dry-run] [--limit N]
import { createClient } from "@supabase/supabase-js";

import { matchCatalogProducts } from "../lib/enrichment/analyze.mjs";

process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const limitArgIdx = process.argv.indexOf("--limit");
const LIMIT = limitArgIdx >= 0 ? Number(process.argv[limitArgIdx + 1]) : null;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAllWithOpportunities() {
  const rows = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    let query = admin
      .from("company_enrichment")
      .select("company_id, external_opportunities")
      .not("external_opportunities", "is", null)
      .order("company_id")
      .range(from, from + PAGE - 1);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

function sameMatchedProducts(a, b) {
  const idsA = (a ?? []).map((p) => p.id).join(",");
  const idsB = (b ?? []).map((p) => p.id).join(",");
  return idsA === idsB;
}

async function processRow(row) {
  const opportunities = row.external_opportunities ?? [];
  let changed = false;
  const rematched = await Promise.all(
    opportunities.map(async (o) => {
      const newMatches = await matchCatalogProducts(admin, o.catalog_category, o.search_terms);
      if (!sameMatchedProducts(o.matched_products, newMatches)) changed = true;
      return { ...o, matched_products: newMatches };
    }),
  );
  if (!changed) return { changed: false };
  if (!DRY_RUN) {
    const { error } = await admin
      .from("company_enrichment")
      .update({ external_opportunities: rematched })
      .eq("company_id", row.company_id);
    if (error) throw error;
  }
  return { changed: true };
}

// Bounded concurrency pool - pure DB read/write per row, no external API,
// safe to run reasonably parallel.
async function runPool(rows, concurrency, fn) {
  let index = 0;
  let done = 0;
  let changed = 0;
  let errors = 0;
  async function worker() {
    while (index < rows.length) {
      const i = index++;
      try {
        const result = await fn(rows[i]);
        if (result.changed) changed++;
      } catch (e) {
        errors++;
        console.error(`error on ${rows[i].company_id}:`, e.message);
      }
      done++;
      if (done % 500 === 0 || done === rows.length) {
        console.log(`${done}/${rows.length} processed, ${changed} changed, ${errors} errors`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { changed, errors };
}

const rows = await fetchAllWithOpportunities();
console.log(`${rows.length} companies with external_opportunities${DRY_RUN ? " (dry run)" : ""}`);
const { changed, errors } = await runPool(rows, 15, processRow);
console.log(`Done. ${changed} of ${rows.length} companies got different matched_products, ${errors} errors.`);
