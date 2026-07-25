// Uploads the exact crop files already sitting in scripts/_crop-preview
// (produced by a --dry-run of crop-catalog-images.mjs and visually verified
// via scripts/make-contact-sheet.mjs) rather than re-running the vision
// pipeline. The vision call proved non-deterministic across runs (e.g. "07"
// and "7101-005-004" correctly found a real photo in one run, then found a
// text-only table fragment in the very next run on identical input) - by
// uploading the specific bytes already reviewed, there's no risk of a fresh
// call silently swapping in a worse crop between review and upload.
//
// Usage: node scripts/upload-verified-crops.mjs
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DIR = "scripts/_crop-preview";

// Confirmed bad on final visual review of this exact batch - a text/table
// fragment instead of the product's own photo (07: knife-replacement-blade
// order table; 7101-005-004: just the section heading, no photo).
const FINAL_REJECT_SKUS = new Set(["07", "7101-005-004"]);

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".png") && !f.startsWith("_sheet"));
  const skus = files
    .map((f) => f.replace(/\.png$/, ""))
    .filter((sku) => !FINAL_REJECT_SKUS.has(sku));

  console.log(`${files.length} verifizierte Crops gefunden, ${skus.length} werden hochgeladen.`);

  const { data: products, error } = await admin.from("products").select("id, sku").in("sku", skus);
  if (error) throw error;
  const bySku = new Map(products.map((p) => [p.sku, p.id]));

  const pairs = [];
  for (const sku of skus) {
    const productId = bySku.get(sku);
    if (!productId) {
      console.log(`  [kein Produkt gefunden für SKU] ${sku}`);
      continue;
    }
    const buffer = readFileSync(`${DIR}/${sku}.png`);
    const imagePath = `catalog/${sku}.png`;
    const { error: uploadError } = await admin.storage.from("product-images").upload(imagePath, buffer, {
      contentType: "image/png",
      upsert: true,
    });
    if (uploadError) {
      console.log(`  Fehler beim Upload ${sku}: ${uploadError.message}`);
      continue;
    }
    pairs.push({ product_id: productId, image_path: imagePath });
    console.log(`  [hochgeladen] ${sku}`);
  }

  console.log(`\nSchreibe image_path für ${pairs.length} Produkte...`);
  const { error: rpcError } = await admin.rpc("fn_bulk_set_image_path", { pairs });
  if (rpcError) console.log(`Fehler: ${rpcError.message}`);

  console.log("Aktualisiere image_is_representative...");
  const { error: flagError } = await admin.rpc("fn_flag_representative_images");
  if (flagError) console.log(`Fehler: ${flagError.message}`);

  console.log(`\nFertig: ${pairs.length} Produkte haben jetzt ein echtes eigenes Foto aus dem PDF.`);
}

main();
