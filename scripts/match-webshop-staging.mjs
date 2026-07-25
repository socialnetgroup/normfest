// Matches webshop_products_staging (crawled products) against the existing
// products (PDF catalog origin), by exact SKU. Answers three things at once
// (Anis, 2026-07-24):
//   1. How many staged products are genuinely new/unique vs already in our
//      catalog under the same Art.-Nr.
//   2. Fills products.image_path for every existing product that has a real
//      webshop photo, instead of re-crawling the PDF for image crops.
//   3. Resolves each staged product's cross-sell candidates (from the crawl)
//      back to real products.id pairs and writes them into product_relations,
//      so the Katalog product page can show real cross-sell suggestions.
//
// Read-only against `products` rows themselves (only fills the new
// image_path column) - never inserts, deletes, or renames anything there.
// Whether the genuinely-new products actually get added to the live Katalog
// is intentionally a separate, later, reviewed step.
//
// Usage: node scripts/match-webshop-staging.mjs
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH_SIZE = 500;

async function fetchAll(table, columns) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkUpsert(table, rows, onConflict, extra = {}) {
  let done = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { error } = await admin.from(table).upsert(batch, { onConflict, ...extra });
    if (error) console.log(`  Fehler beim Batch-Upsert in ${table}: ${error.message}`);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${rows.length}`);
  }
  console.log();
}

// PostgREST upsert always issues an INSERT-shaped statement, so a
// partial-column payload (just id + one other column) trips NOT NULL on
// every column not included - confirmed directly against this table. These
// two columns are patched via a real bulk UPDATE RPC instead.
async function bulkRpcUpdate(fnName, rows, mapRow) {
  let done = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { error } = await admin.rpc(fnName, { pairs: batch.map(mapRow) });
    if (error) console.log(`  Fehler bei ${fnName}: ${error.message}`);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${rows.length}`);
  }
  console.log();
}

async function main() {
  console.log("Lade Produkte + Staging-Daten...");
  const [products, staged] = await Promise.all([
    fetchAll("products", "id, sku, name, image_path"),
    fetchAll(
      "webshop_products_staging",
      "id, sku, name, image_stored_path, cross_sell_candidates, matched_product_id",
    ),
  ]);
  console.log(`  ${products.length} bestehende Produkte, ${staged.length} gecrawlte Produkte.\n`);

  const productBySku = new Map(products.map((p) => [p.sku, p]));

  console.log("1/3 Exakter SKU-Abgleich...");
  const matches = [];
  for (const s of staged) {
    const product = productBySku.get(s.sku);
    if (product) matches.push({ stagingId: s.id, sku: s.sku, productId: product.id, imagePath: s.image_stored_path });
  }
  const newUnique = staged.length - matches.length;
  console.log(`  ${matches.length} exakte Treffer, ${newUnique} neue/eindeutige Produkte (nicht im bestehenden Katalog).\n`);

  console.log("2/3 Schreibe matched_product_id (Staging) + image_path (Produkte)...");
  await bulkRpcUpdate("fn_bulk_set_matched_product", matches, (m) => ({
    staging_id: m.stagingId,
    product_id: m.productId,
  }));
  const withImage = matches.filter((m) => m.imagePath);
  await bulkRpcUpdate("fn_bulk_set_image_path", withImage, (m) => ({
    product_id: m.productId,
    image_path: m.imagePath,
  }));
  console.log(`  ${withImage.length} bestehende Produkte haben jetzt ein echtes Foto.\n`);

  console.log("3/3 Löse Cross-Sell-Kandidaten zu echten Produkten auf...");
  const skuToProductId = new Map(matches.map((m) => [m.sku, m.productId]));
  const resolvedPairs = [];
  let candidatePairs = 0;
  for (const s of staged) {
    const anchorProductId = skuToProductId.get(s.sku);
    if (!anchorProductId || !s.cross_sell_candidates) continue;
    for (const candidate of s.cross_sell_candidates) {
      candidatePairs++;
      const relatedProductId = skuToProductId.get(candidate.sku);
      if (!relatedProductId || relatedProductId === anchorProductId) continue;
      resolvedPairs.push({
        product_id: anchorProductId,
        related_product_id: relatedProductId,
        relation_type: "cross_sell",
        origin: "curated",
        weight: 2,
        note: `Quelle: normfest-shop.com "Könnte Sie auch interessieren"`,
      });
    }
  }
  console.log(`  ${candidatePairs} Kandidaten-Paare, ${resolvedPairs.length} zu echten Katalog-Produkten aufgelöst.`);
  await bulkUpsert("product_relations", resolvedPairs, "product_id,related_product_id,relation_type", {
    ignoreDuplicates: true,
  });

  const { count: relationCount } = await admin
    .from("product_relations")
    .select("id", { count: "exact", head: true })
    .eq("origin", "curated")
    .eq("relation_type", "cross_sell");

  console.log("\n=== Zusammenfassung ===");
  console.log(`Bestehender Katalog: ${products.length} Produkte`);
  console.log(`Webshop-Crawl: ${staged.length} Produkte`);
  console.log(`  - davon bereits im Katalog (gleiche Art.-Nr.): ${matches.length}`);
  console.log(`  - davon neu/eindeutig (nicht im Katalog): ${newUnique}`);
  console.log(`Bestehende Produkte mit neuem Foto: ${withImage.length} von ${products.length}`);
  console.log(`Cross-Sell-Paare gesamt in der Datenbank: ${relationCount}`);
}

main();
