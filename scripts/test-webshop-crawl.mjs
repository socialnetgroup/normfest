// Test crawl for the "rebuild Katalog from the live webshop" idea (CLAUDE.md
// §14 item 12). Small sample only — validates crawl approach + both image
// strategies (hotlink vs. download-to-Supabase-Storage) before committing to
// the full ~14,700-product crawl. Read-only against the shop's own public
// pages (robots.txt: Allow /, publishes a sitemap) - same site already used
// for cross-sell mining.
//
// Usage: node scripts/test-webshop-crawl.mjs [sampleSize]
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
const SAMPLE_SIZE = process.argv[2] ? Number(process.argv[2]) : 40;
const CATEGORY_PAGES_TO_SAMPLE = 8;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
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

/** Pulls {breadcrumbCategory, mainImageSrc, mainImageZoom} from a single product detail page. */
function extractProductDetail(html, name) {
  // The zoomable product image tag carries both a thumbnail src and a
  // higher-res data-zoom-image - alt text should match the product name.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imgRe = new RegExp(
    `<img[^>]*src="([^"]*pictures[^"]*)"[^>]*data-zoom-image="([^"]*)"[^>]*alt="${escaped}"`,
  );
  const imgMatch = html.match(imgRe);

  // Fallback: first pictures/ image with a data-zoom-image, if the alt-text
  // match fails (name may be HTML-escaped differently on the page).
  const fallbackImgRe = /<img[^>]*src="([^"]*pictures[^"]*)"[^>]*data-zoom-image="([^"]*)"/;
  const fallback = html.match(fallbackImgRe);

  const [, src, zoom] = imgMatch ?? fallback ?? [];

  const breadcrumbMatch = html.match(/<nav[^>]*breadcrumb[\s\S]{0,600}?<\/nav>/i);
  const breadcrumbText = breadcrumbMatch
    ? [...breadcrumbMatch[0].matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim()).join(" > ")
    : null;

  return { imageSrc: src ?? null, imageZoom: zoom ?? null, breadcrumb: breadcrumbText };
}

async function downloadAndStore(imageUrl, sku) {
  const res = await fetch(imageUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  // The shop's own placeholder is a small, fixed file - flag suspiciously
  // tiny downloads rather than silently storing a "not found" graphic.
  if (buf.length < 800) return { ok: false, reason: `verdächtig klein (${buf.length} bytes) - evtl. Platzhalter` };

  const ext = imageUrl.split(".").pop().split("?")[0];
  const path = `test/${sku}.${ext}`;
  const { error } = await admin.storage
    .from("product-images")
    .upload(path, buf, { contentType: res.headers.get("content-type") ?? "image/png", upsert: true });
  if (error) return { ok: false, reason: error.message };

  const { data } = admin.storage.from("product-images").getPublicUrl(path);
  return { ok: true, bytes: buf.length, storedUrl: data.publicUrl };
}

async function main() {
  console.log("1/4 Lade Sitemap...");
  const sitemapRes = await fetch(SITEMAP_URL, { headers: { "User-Agent": UA } });
  const gz = Buffer.from(await sitemapRes.arrayBuffer());
  const xml = gunzipSync(gz).toString("utf8");
  const categoryUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.includes("/produkte/") && !u.slice(u.indexOf("/produkte/") + 10).includes("/"));
  console.log(`   ${categoryUrls.length} Kategorie-Seiten gefunden.`);

  console.log(`2/4 Sammle Produkt-Links aus ${CATEGORY_PAGES_TO_SAMPLE} zufälligen Kategorien...`);
  const shuffled = [...categoryUrls].sort(() => Math.random() - 0.5).slice(0, CATEGORY_PAGES_TO_SAMPLE);
  const allTiles = [];
  for (const url of shuffled) {
    try {
      const html = await fetchText(url);
      const tiles = extractProductTiles(html);
      allTiles.push(...tiles);
      console.log(`   ${url.split("/produkte/")[1]}: ${tiles.length} Produkte`);
    } catch (err) {
      console.log(`   FEHLER bei ${url}: ${err.message}`);
    }
  }

  const uniqueTiles = [...new Map(allTiles.map((t) => [t.sku, t])).values()];
  const sample = uniqueTiles.slice(0, SAMPLE_SIZE);
  console.log(`   ${uniqueTiles.length} eindeutige Produkte gefunden, teste ${sample.length}.\n`);

  console.log("3/4 Lade Produktdetailseiten + Bilder...");
  const results = [];
  for (const [i, tile] of sample.entries()) {
    const url = tile.href.startsWith("http") ? tile.href : `${BASE}${tile.href}`;
    try {
      const html = await fetchText(url);
      const detail = extractProductDetail(html, tile.name);
      let hotlink = null;
      let stored = null;
      if (detail.imageZoom || detail.imageSrc) {
        const imgUrl = detail.imageZoom ?? detail.imageSrc;
        hotlink = imgUrl;
        stored = await downloadAndStore(imgUrl, tile.sku);
      }
      results.push({ ...tile, url, breadcrumb: detail.breadcrumb, hotlink, stored });
      console.log(
        `   [${i + 1}/${sample.length}] ${tile.name} (${tile.sku}) - Bild: ${stored?.ok ? "OK" : stored?.reason ?? "kein Bild gefunden"}`,
      );
    } catch (err) {
      results.push({ ...tile, url, error: err.message });
      console.log(`   [${i + 1}/${sample.length}] ${tile.name} - FEHLER: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n4/4 Schreibe Report...");
  const summary = {
    categoriesSampled: shuffled.length,
    uniqueProductsFound: uniqueTiles.length,
    tested: results.length,
    withImage: results.filter((r) => r.stored?.ok).length,
    imageFailed: results.filter((r) => r.hotlink && !r.stored?.ok).length,
    noImageFound: results.filter((r) => !r.hotlink && !r.error).length,
    errors: results.filter((r) => r.error).length,
  };
  console.log(JSON.stringify(summary, null, 2));

  const fs = await import("node:fs");
  fs.writeFileSync("webshop-test-report.json", JSON.stringify({ summary, results }, null, 2));
  console.log("\nReport gespeichert: webshop-test-report.json");
}

main();
