// M4 — mines real cross-sell/upsell pairs from the live Normfest webshop's
// own "Könnte Sie auch interessieren" merchandising (CLAUDE.md §4.3). This
// is Normfest's own production site (robots.txt: `Allow: /`, publishes a
// sitemap), used here to power Normfest's own internal tool — not
// third-party scraping. Read-only: only fetches public product pages
// (no login), never touches price (login-gated, irrelevant here anyway).
//
// v2 (2026-07-24): v1 matched by exact SKU only and got ~3% hit rate —
// our PDF-extracted catalog has many pack-size/variant SKUs per product
// family (e.g. 5 separate "Thermotape" rows), but the shop's search index
// surfaces roughly one canonical SKU per family, so exact-SKU search
// mostly missed real, existing products. v2 searches by NAME instead,
// scores candidate results by word-overlap against our product name, and
// accepts the best match above a threshold — same principle applied on
// both ends (finding our anchor's page, and matching the crossseller
// section's results back to our catalog). Exact-SKU match is still tried
// first and preferred when it works (more precise than fuzzy name
// matching), name-matching is the fallback that catches the common case.
//
// Usage: node scripts/mine-shop-crosssell.mjs [limit]
// Omit limit to process the entire catalog.
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://www.normfest-shop.com";
const REQUEST_DELAY_MS = 350;
const CONCURRENCY = 3;
const NAME_MATCH_THRESHOLD = 0.5;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const STOPWORDS = new Set(["für", "und", "mit", "aus", "der", "die", "das", "von", "zur", "zum", "auf", "im"]);

/** Lowercases, strips pack-size-like tokens (numbers+unit), and drops stopwords/short tokens. */
function significantWords(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[®™„"()]/g, " ")
    .replace(/\d+([.,]\d+)?\s*(ml|l|kg|g|mm|m|cm|liter|stück|st\.?|kanister|aerosoldose)\b/gi, " ")
    .replace(/[^a-zäöüß0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Jaccard-like word-overlap score between two pre-tokenized word sets, 0..1. */
function setSimilarity(wa, wb) {
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

function nameSimilarity(a, b) {
  return setSimilarity(new Set(significantWords(a)), new Set(significantWords(b)));
}

/** Parses {href, name, sku} entries from any block of shop HTML containing product tiles. */
function extractProductTiles(html) {
  const results = [];
  const tileRe = /<a href="([^"]+)"[^>]*class="item[^"]*"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g;
  let m;
  while ((m = tileRe.exec(html))) {
    const href = m[1];
    const name = m[2].trim();
    const skuMatch = href.match(/-([0-9]{3,}(?:-[0-9a-zA-Z]+)*)$/);
    if (skuMatch) results.push({ href, name, sku: skuMatch[1] });
  }
  return results;
}

/** Also parses the plain search-results list layout (different markup from the crossseller slider). */
function extractSearchResultLinks(html) {
  const results = [];
  const linkRe = /<a href="([^"]*\/shop\/de\/produkte\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g;
  let m;
  while ((m = linkRe.exec(html))) {
    const href = m[1];
    const skuMatch = href.match(/-([0-9]{3,}(?:-[0-9a-zA-Z]+)*)$/);
    if (!skuMatch) continue;
    const nameMatch = m[2].match(/<h3[^>]*>([^<]+)<\/h3>/) || m[2].match(/>([^<>{2,}]{4,80})<\/(?:span|div)>/);
    const name = nameMatch ? nameMatch[1].trim() : null;
    if (name) results.push({ href, name, sku: skuMatch[1] });
  }
  return results;
}

/** Finds the canonical product page URL for our product: exact SKU first, then best name match. */
async function findProductUrl(product) {
  const html = await fetchText(`${BASE}/shop/de/produktsuche?SearchTerm=${encodeURIComponent(product.name)}`);
  const candidates = [...extractProductTiles(html), ...extractSearchResultLinks(html)];
  if (candidates.length === 0) return null;

  const exact = candidates.find((c) => c.sku === product.sku);
  if (exact) return { url: exact.href, matchedBy: "sku" };

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = nameSimilarity(c.name, product.name);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best && bestScore >= NAME_MATCH_THRESHOLD) return { url: best.href, matchedBy: `name(${bestScore.toFixed(2)})` };
  return null;
}

/** Extracts {sku, name} pairs from the "Könnte Sie auch interessieren" section. */
function extractCrossSell(html) {
  const start = html.indexOf("<!-- G16_Crossseller Anfang -->");
  const end = html.indexOf("<!-- G16_Crossseller Ende -->");
  if (start === -1 || end === -1 || end <= start) return [];
  return extractProductTiles(html.slice(start, end));
}

/** Matches a crossseller result back to our own catalog: exact SKU first, else best name match
 * against a precomputed {product, words} index (avoids re-tokenizing all 4,011 names per call). */
function matchToCatalog(candidate, skuToProduct, catalogIndex) {
  const exact = skuToProduct.get(candidate.sku);
  if (exact) return exact;

  const candidateWords = new Set(significantWords(candidate.name));
  let best = null;
  let bestScore = 0;
  for (const entry of catalogIndex) {
    const score = setSimilarity(entry.words, candidateWords);
    if (score > bestScore) {
      bestScore = score;
      best = entry.product;
    }
  }
  return best && bestScore >= NAME_MATCH_THRESHOLD ? best : null;
}

async function pool(items, worker, concurrency) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

const stats = {
  checked: 0,
  foundBySku: 0,
  foundByName: 0,
  notFound: 0,
  pairsCandidate: 0,
  pairsMatched: 0,
  pairsInserted: 0,
  errors: 0,
};

async function processProduct(product, index, total, skuToProduct, catalogIndex) {
  try {
    const found = await findProductUrl(product);
    if (!found) {
      stats.notFound++;
      if (process.env.DEBUG_MINE) console.log(`  not found: ${product.sku} (${product.name})`);
      return;
    }
    if (found.matchedBy === "sku") stats.foundBySku++;
    else stats.foundByName++;

    const html = await fetchText(found.url);
    const related = extractCrossSell(html);
    stats.pairsCandidate += related.length;

    for (const r of related) {
      const match = matchToCatalog(r, skuToProduct, catalogIndex);
      if (!match || match.id === product.id) continue;
      stats.pairsMatched++;

      const { error } = await admin
        .from("product_relations")
        .insert({
          product_id: product.id,
          related_product_id: match.id,
          relation_type: "cross_sell",
          origin: "curated",
          weight: 2,
          note: `Quelle: normfest-shop.com "Könnte Sie auch interessieren"`,
        })
        .select("id")
        .maybeSingle();
      // ignore unique-constraint conflicts (pair already exists) — not an error
      if (!error) stats.pairsInserted++;
    }
  } catch (err) {
    stats.errors++;
    console.error(`[${index + 1}/${total}] ${product.name} (${product.sku}): FAILED —`, err.message);
  }
  stats.checked++;
  if (stats.checked % 25 === 0 || index + 1 === total) {
    console.log(`[${index + 1}/${total}] progress:`, stats);
  }
}

async function fetchAllProducts() {
  // PostgREST caps unbounded selects at 1000 rows — page through explicitly.
  let all = [];
  let from = 0;
  for (;;) {
    const { data } = await admin
      .from("products")
      .select("id, sku, name")
      .eq("active", true)
      .order("sku")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;

  const allProducts = await fetchAllProducts();
  const skuToProduct = new Map(allProducts.map((p) => [p.sku, p]));
  const catalogIndex = allProducts.map((p) => ({ product: p, words: new Set(significantWords(p.name)) }));

  const targets = limit ? shuffle(allProducts).slice(0, limit) : allProducts;
  console.log(`Mining cross-sell from ${targets.length} products (of ${allProducts.length} total in catalog).`);

  const start = Date.now();
  await pool(targets, (p, i) => processProduct(p, i, targets.length, skuToProduct, catalogIndex), CONCURRENCY);
  const seconds = Math.round((Date.now() - start) / 1000);

  console.log(`\nDone in ${seconds}s. Final stats:`, stats);
}

main();
