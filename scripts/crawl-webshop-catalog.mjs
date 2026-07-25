// Full webshop catalog crawl (CLAUDE.md §14 item 12) — Phase 1 of the
// rebuild: STAGE everything from normfest-shop.com into
// webshop_products_staging (name, SKU, category, image). Dedup against the
// existing 4,011 products and any merge/delete decisions are a deliberately
// separate, later, reviewed step - this script never touches `products`.
//
// v2 (2026-07-24): v1 assumed every /produkte/ sitemap URL was a category
// listing page and tried to extract product tiles from all of them. Real
// finding from a stalled first run: of the 14,238 sitemap URLs, 9,630 are
// already DIRECT individual product pages (their slug ends in a numeric
// SKU, e.g. "...-1004-20-1"), and only 4,608 are true category hub pages
// (opaque non-numeric slug, e.g. "...-yqmir1"). v1 ran tile-extraction
// against the direct product pages too, which pulled unrelated products
// from a "das könnte Sie auch interessieren" bundle widget instead of the
// page's own product - explains why the unique-product count stalled
// after the first few hundred.
//
// v2 crawls both sources properly:
//   A. All 9,630 direct product URLs - fetched directly, no tile step.
//   B. All 4,608 category hub pages - tiles extracted, any SKU not already
//      covered by (A) gets fetched too (catches products only reachable
//      via a category, if any).
//
// Resumable: skips SKUs already present in the staging table, so
// re-running after an interruption only does the remaining work.
//
// Usage: node scripts/crawl-webshop-catalog.mjs
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://www.normfest-shop.com";
const SITEMAP_URL = `${BASE}/shop/sitemaps/de_DE/sitemap-de_DE-0.xml.gz`;
const REQUEST_DELAY_MS = 250;
const CONCURRENCY = 5;
const SKU_SUFFIX_RE = /-([0-9]{3,}(?:-[0-9]+)*)$/;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractProductTiles(html) {
  const results = [];
  const tileRe = /<a href="([^"]+)"[^>]*class="item[^"]*"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g;
  let m;
  while ((m = tileRe.exec(html))) {
    const href = m[1];
    const name = m[2].trim();
    const skuMatch = href.match(SKU_SUFFIX_RE);
    if (skuMatch) results.push({ href, name, sku: skuMatch[1] });
  }
  return results;
}

function extractProductDetail(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imgRe = new RegExp(`<img[^>]*src="([^"]*pictures[^"]*)"[^>]*data-zoom-image="([^"]*)"[^>]*alt="${escaped}"`);
  const imgMatch = html.match(imgRe);
  const fallbackImgRe = /<img[^>]*src="([^"]*pictures[^"]*)"[^>]*data-zoom-image="([^"]*)"/;
  const fallback = html.match(fallbackImgRe);
  const [, src, zoom] = imgMatch ?? fallback ?? [];

  const breadcrumbMatch = html.match(/<nav[^>]*breadcrumb[\s\S]{0,600}?<\/nav>/i);
  const breadcrumb = breadcrumbMatch
    ? [...breadcrumbMatch[0].matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim()).join(" > ")
    : null;

  return { imageUrl: zoom ?? src ?? null, breadcrumb };
}

function extractTitleName(html) {
  return html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? null;
}

/** Extracts {sku, name} pairs from the "Könnte Sie auch interessieren" section -
 * same HTML fetch as the product itself, so this is free. See
 * scripts/mine-shop-crosssell.mjs, which does the same extraction but had to
 * pay for a second fetch per product since it searched backward from our SKUs. */
function extractCrossSell(html) {
  const start = html.indexOf("<!-- G16_Crossseller Anfang -->");
  const end = html.indexOf("<!-- G16_Crossseller Ende -->");
  if (start === -1 || end === -1 || end <= start) return [];
  return extractProductTiles(html.slice(start, end)).map((t) => ({ sku: t.sku, name: t.name }));
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&szlig;/g, "ß")
    .replace(/&Auml;/g, "Ä")
    .replace(/&auml;/g, "ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&ouml;/g, "ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&uuml;/g, "ü")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&#39;/g, "'");
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

async function downloadAndStore(imageUrl, sku) {
  const res = await fetch(imageUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { ok: false };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) return { ok: false };

  const ext = imageUrl.split(".").pop().split("?")[0];
  const path = `catalog/${sku}.${ext}`;
  const { error } = await admin.storage
    .from("product-images")
    .upload(path, buf, { contentType: res.headers.get("content-type") ?? "image/png", upsert: true });
  if (error) return { ok: false };
  return { ok: true, path };
}

async function stageProduct({ url, sku, name, isDirect }) {
  try {
    const html = await fetchText(url);
    const resolvedName = isDirect ? extractTitleName(html) ?? name : name;
    const detail = extractProductDetail(html, resolvedName);
    let storedPath = null;
    if (detail.imageUrl) {
      const stored = await downloadAndStore(detail.imageUrl, sku);
      if (stored.ok) storedPath = stored.path;
    }
    const crossSell = extractCrossSell(html).filter((c) => c.sku !== sku);
    await admin.from("webshop_products_staging").upsert(
      {
        sku,
        name: decodeEntities(resolvedName),
        category_breadcrumb: detail.breadcrumb,
        source_url: url,
        image_hotlink_url: detail.imageUrl,
        image_stored_path: storedPath,
        cross_sell_candidates: crossSell.length > 0 ? crossSell : null,
      },
      { onConflict: "sku" },
    );
    return { ok: true, hasImage: !!storedPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log("Lade Sitemap...");
  const sitemapRes = await fetch(SITEMAP_URL, { headers: { "User-Agent": UA } });
  const xml = gunzipSync(Buffer.from(await sitemapRes.arrayBuffer())).toString("utf8");
  const produkteUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.includes("/produkte/"));

  const directProducts = [];
  const categoryHubs = [];
  for (const url of produkteUrls) {
    const skuMatch = url.match(SKU_SUFFIX_RE);
    if (skuMatch) directProducts.push({ url, sku: skuMatch[1] });
    else categoryHubs.push(url);
  }
  console.log(`${produkteUrls.length} /produkte/ URLs: ${directProducts.length} direkte Produkte, ${categoryHubs.length} Kategorie-Seiten.\n`);

  const testLimit = process.env.TEST_LIMIT ? Number(process.env.TEST_LIMIT) : null;
  const directProductsRun = testLimit ? directProducts.slice(0, testLimit) : directProducts;
  const categoryHubsRun = testLimit ? categoryHubs.slice(0, Math.max(2, Math.floor(testLimit / 5))) : categoryHubs;

  const { data: existingRows } = await admin.from("webshop_products_staging").select("sku");
  const alreadyDone = new Set((existingRows ?? []).map((r) => r.sku));
  console.log(`${alreadyDone.size} bereits in der Staging-Tabelle.\n`);

  console.log("Phase A: Direkte Produktseiten...");
  const remainingDirect = directProductsRun.filter((p) => !alreadyDone.has(p.sku));
  console.log(`  ${remainingDirect.length} verbleibend von ${directProductsRun.length}.`);
  let doneA = 0;
  let imagesA = 0;
  let errorsA = 0;
  await pool(
    remainingDirect,
    async (p) => {
      const result = await stageProduct({ url: p.url, sku: p.sku, name: p.sku, isDirect: true });
      if (result.ok) {
        alreadyDone.add(p.sku);
        if (result.hasImage) imagesA++;
      } else {
        errorsA++;
      }
      doneA++;
      if (doneA % 200 === 0 || doneA === remainingDirect.length) {
        console.log(`  [A ${doneA}/${remainingDirect.length}] mit Bild: ${imagesA}, Fehler: ${errorsA}`);
      }
    },
    CONCURRENCY,
  );
  console.log(`Phase A fertig: ${doneA} verarbeitet, ${imagesA} mit Bild, ${errorsA} Fehler.\n`);

  console.log("Phase B: Kategorie-Seiten (finde zusätzliche Produkte)...");
  const extraTilesBySku = new Map();
  let doneB = 0;
  await pool(
    categoryHubsRun,
    async (url) => {
      try {
        const html = await fetchText(url);
        for (const tile of extractProductTiles(html)) {
          if (!alreadyDone.has(tile.sku) && !extraTilesBySku.has(tile.sku)) {
            extraTilesBySku.set(tile.sku, tile);
          }
        }
      } catch (err) {
        console.log(`  Kategorie-Fehler ${url}: ${err.message}`);
      }
      doneB++;
      if (doneB % 500 === 0 || doneB === categoryHubsRun.length) {
        console.log(`  [B ${doneB}/${categoryHubsRun.length}] Kategorien, ${extraTilesBySku.size} zusätzliche Produkte gefunden bisher`);
      }
    },
    CONCURRENCY,
  );
  console.log(`Phase B, Kategorien durchsucht: ${extraTilesBySku.size} zusätzliche Produkte gefunden.\n`);

  console.log("Phase C: Zusätzliche Produkte aus Kategorien laden...");
  const extraTiles = [...extraTilesBySku.values()];
  let doneC = 0;
  let imagesC = 0;
  let errorsC = 0;
  await pool(
    extraTiles,
    async (tile) => {
      const url = tile.href.startsWith("http") ? tile.href : `${BASE}${tile.href}`;
      const result = await stageProduct({ url, sku: tile.sku, name: tile.name, isDirect: false });
      if (result.ok && result.hasImage) imagesC++;
      if (!result.ok) errorsC++;
      doneC++;
      if (doneC % 200 === 0 || doneC === extraTiles.length) {
        console.log(`  [C ${doneC}/${extraTiles.length}] mit Bild: ${imagesC}, Fehler: ${errorsC}`);
      }
    },
    CONCURRENCY,
  );
  console.log(`Phase C fertig: ${doneC} verarbeitet, ${imagesC} mit Bild, ${errorsC} Fehler.\n`);

  const { count } = await admin.from("webshop_products_staging").select("id", { count: "exact", head: true });
  console.log(`\nGesamt in webshop_products_staging: ${count}`);
}

main();
