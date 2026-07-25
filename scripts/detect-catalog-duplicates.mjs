// CLAUDE.md M8 follow-up plan, P6 (2026-07-25): after the webshop catalog
// merge (§13 M4), exact-SKU duplicates were already excluded during the
// merge itself, but near-duplicates likely remain - the same real product
// under a different SKU/naming scheme in the PDF catalog vs. the webshop
// (the same root cause already documented for the earlier cross-sell mining
// attempt and the fuzzy image-matching pass).
//
// Detection only - this script never touches `products` itself. It stages
// ranked candidate pairs into product_duplicate_candidates for Anis to
// review at /admin/katalog-dedup; the actual merge (a real, destructive
// action) happens only when he clicks "zusammenführen" there, via
// fn_merge_duplicate_products.
//
// Reuses the same Jaccard word-overlap approach already proven in
// scripts/fill-representative-images.mjs. Restricted to cross-source pairs
// (one catalog_pdf + one webshop product) within the same category_code -
// same-source duplicates were already QA'd in M3 (catalog_pdf) or excluded
// at merge time (webshop, via exact-SKU dedup against catalog_pdf, though
// not against itself - a possible remaining gap, not covered by this pass).
//
// Usage: node scripts/detect-catalog-duplicates.mjs [--threshold=0.6] [--limit=300]
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.6;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 300;

const STOPWORDS = new Set([
  "mit", "für", "und", "aus", "des", "der", "die", "das", "von", "im", "in",
  "zu", "an", "auf", "je", "pro", "bis", "ohne", "als", "am", "ca",
]);

function normalize(name) {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function fetchAll(source) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("products")
      .select("id, sku, name, category_code")
      .eq("source", source)
      .not("category_code", "is", null)
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
  console.log("Lade Produkte (catalog_pdf + webshop)...");
  const [pdfProducts, webshopProducts] = await Promise.all([fetchAll("catalog_pdf"), fetchAll("webshop")]);
  console.log(`  catalog_pdf: ${pdfProducts.length}, webshop: ${webshopProducts.length}`);

  const byCategory = new Map();
  for (const p of webshopProducts) {
    if (!byCategory.has(p.category_code)) byCategory.set(p.category_code, []);
    byCategory.get(p.category_code).push({ ...p, words: normalize(p.name) });
  }

  console.log(`Vergleiche pro Kategorie (Schwelle ${THRESHOLD})...`);
  const candidates = [];
  for (const pdfProduct of pdfProducts) {
    const pool = byCategory.get(pdfProduct.category_code);
    if (!pool || pool.length === 0) continue;
    const pdfWords = normalize(pdfProduct.name);
    if (pdfWords.size === 0) continue;

    let best = null;
    for (const webProduct of pool) {
      const score = jaccard(pdfWords, webProduct.words);
      if (score >= THRESHOLD && (!best || score > best.score)) {
        best = { score, webProduct };
      }
    }
    if (best) {
      candidates.push({
        product_a_id: pdfProduct.id,
        product_b_id: best.webProduct.id,
        similarity: Math.round(best.score * 1000) / 1000,
        namesForLog: `${pdfProduct.name}  <->  ${best.webProduct.name}`,
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const top = candidates.slice(0, LIMIT);
  console.log(`\nGefunden: ${candidates.length} Kandidaten über Schwelle, davon Top ${top.length} werden gespeichert.`);

  if (top.length > 0) {
    const rows = top.map(({ product_a_id, product_b_id, similarity }) => ({ product_a_id, product_b_id, similarity }));
    const { error } = await admin
      .from("product_duplicate_candidates")
      .upsert(rows, { onConflict: "product_a_id,product_b_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  console.log("\nBeispiele (Top 10):");
  for (const c of top.slice(0, 10)) {
    console.log(`  [${c.similarity}] ${c.namesForLog}`);
  }
}

main();
