// Full webshop catalog crawl (CLAUDE.md §14 item 12) — Phase 1 of the
// rebuild: STAGE everything from normfest-shop.com into
// webshop_products_staging (name, SKU, category, image). Dedup against the
// existing 4,011 products and any merge/delete decisions are a deliberately
// separate, later, reviewed step - this script never touches `products`.
//
// Two phases:
//   1. Walk every /produkte/ category page in the real sitemap, collect
//      unique {sku, name, href} product tiles (dedup by SKU - the same
//      product can appear in multiple categories).
//   2. For each unique product: fetch its detail page, pull the category
//      breadcrumb + main image, download the image into Supabase Storage,
//      upsert into the staging table.
//
// Resumable: phase 1 checkpoints the category-URL list to disk; phase 2
// skips SKUs already present in the staging table, so re-running after an
// interruption only does the remaining work.
//
// Usage: node scripts/crawl-webshop-catalog.mjs
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

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
const TILES_CHECKPOINT = "webshop-crawl-tiles.json";

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
    const skuMatch = href.match(/-([0-9]{2,}(?:-[0-9]+)*)$/);
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

async function phase1CollectTiles() {
  if (existsSync(TILES_CHECKPOINT)) {
    const saved = JSON.parse(readFileSync(TILES_CHECKPOINT, "utf8"));
    console.log(`Phase 1: Checkpoint gefunden, ${saved.length} eindeutige Produkte aus vorherigem Lauf.`);
    return saved;
  }

  console.log("Phase 1: Lade Sitemap...");
  const sitemapRes = await fetch(SITEMAP_URL, { headers: { "User-Agent": UA } });
  const xml = gunzipSync(Buffer.from(await sitemapRes.arrayBuffer())).toString("utf8");
  const categoryUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.includes("/produkte/") && !u.slice(u.indexOf("/produkte/") + 10).includes("/"));
  console.log(`Phase 1: ${categoryUrls.length} Kategorie-Seiten. Sammle Produkt-Kacheln...`);

  const bySku = new Map();
  let done = 0;
  await pool(
    categoryUrls,
    async (url) => {
      try {
        const html = await fetchText(url);
        for (const tile of extractProductTiles(html)) {
          if (!bySku.has(tile.sku)) bySku.set(tile.sku, tile);
        }
      } catch (err) {
        console.log(`  Kategorie-Fehler ${url}: ${err.message}`);
      }
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${categoryUrls.length} Kategorien, ${bySku.size} eindeutige Produkte bisher`);
    },
    CONCURRENCY,
  );

  const tiles = [...bySku.values()];
  writeFileSync(TILES_CHECKPOINT, JSON.stringify(tiles));
  console.log(`Phase 1 fertig: ${tiles.length} eindeutige Produkte gefunden.\n`);
  return tiles;
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

async function phase2Enrich(tiles) {
  const { data: existingRows } = await admin.from("webshop_products_staging").select("sku");
  const alreadyDone = new Set((existingRows ?? []).map((r) => r.sku));
  const remaining = tiles.filter((t) => !alreadyDone.has(t.sku));
  console.log(`Phase 2: ${alreadyDone.size} bereits in der Staging-Tabelle, ${remaining.length} verbleibend.\n`);

  let done = 0;
  let withImage = 0;
  let errors = 0;

  await pool(
    remaining,
    async (tile) => {
      const url = tile.href.startsWith("http") ? tile.href : `${BASE}${tile.href}`;
      try {
        const html = await fetchText(url);
        const detail = extractProductDetail(html, tile.name);
        let storedPath = null;
        if (detail.imageUrl) {
          const stored = await downloadAndStore(detail.imageUrl, tile.sku);
          if (stored.ok) {
            storedPath = stored.path;
            withImage++;
          }
        }

        await admin.from("webshop_products_staging").upsert(
          {
            sku: tile.sku,
            name: decodeEntities(tile.name),
            category_breadcrumb: detail.breadcrumb,
            source_url: url,
            image_hotlink_url: detail.imageUrl,
            image_stored_path: storedPath,
          },
          { onConflict: "sku" },
        );
      } catch (err) {
        errors++;
        console.log(`  Fehler ${tile.sku} (${tile.name}): ${err.message}`);
      }
      done++;
      if (done % 100 === 0 || done === remaining.length) {
        console.log(`  [${done}/${remaining.length}] mit Bild: ${withImage}, Fehler: ${errors}`);
      }
    },
    CONCURRENCY,
  );

  console.log(`\nPhase 2 fertig. ${done} verarbeitet, ${withImage} mit Bild, ${errors} Fehler.`);
}

async function main() {
  const tiles = await phase1CollectTiles();
  await phase2Enrich(tiles);

  const { count } = await admin.from("webshop_products_staging").select("id", { count: "exact", head: true });
  console.log(`\nGesamt in webshop_products_staging: ${count}`);
}

main();
