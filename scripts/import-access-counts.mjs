// Imports real webshop page-access counts per product from Normfest's own
// "Zugriffe je Artikel 2026" export (Anis, 2026-08-22) into
// products.access_count_2026 - used to rank the Firmenbrief's Externe
// Chancen matches (lib/enrichment/analyze.mjs's matchCatalogProducts()) by
// real customer interest instead of the earlier cross-sell-frequency proxy.
//
// Matches on SKU, exact first, then with a trailing pack-size suffix
// (e.g. "/100") stripped - same normalization already proven for invoice
// line-item matching (§14 item 71). A SKU present in the file but not in
// our catalog is skipped and counted, never guessed - most such rows are
// internal service/placeholder codes (e.g. "0000-700-001"), not real
// missing products (checked directly before building this).
//
// Idempotent: re-running with a refreshed file safely overwrites every
// matched product's access_count_2026. Usage:
//   node scripts/import-access-counts.mjs <path-to-xlsx> [--dry-run]
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import fs from "fs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function stripPackSuffix(sku) {
  return sku.replace(/\/\d+$/, "");
}

async function fetchAllProducts() {
  let products = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin.from("products").select("id, sku").range(from, from + 999);
    if (error) throw error;
    products = products.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return products;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("Usage: node scripts/import-access-counts.mjs <path-to-xlsx> [--dry-run]");
    process.exit(1);
  }

  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null }).slice(1);
  console.log(`${rows.length} row(s) in ${file}${dryRun ? " (DRY RUN - no writes)" : ""}`);

  const products = await fetchAllProducts();
  const bySku = new Map(products.map((p) => [p.sku, p.id]));

  // Several real webshop SKU variants (different pack sizes of the same
  // catalog product) can strip down to the same base catalog SKU - each
  // represents a genuinely distinct webshop page, so their real access
  // counts are summed onto that one catalog product rather than the last
  // row silently overwriting the others (caught by comparing "matched" rows
  // against distinct products actually touched - a real ~1,600-row gap on
  // the first run before this fix).
  const countByProductId = new Map();
  let matched = 0;
  let skipped = 0;
  for (const row of rows) {
    const sku = String(row[0] ?? "").trim();
    const count = Number(row[1]);
    if (!sku || !Number.isFinite(count)) {
      skipped++;
      continue;
    }
    const productId = bySku.get(sku) ?? bySku.get(stripPackSuffix(sku));
    if (!productId) {
      skipped++;
      continue;
    }
    countByProductId.set(productId, (countByProductId.get(productId) ?? 0) + count);
    matched++;
  }
  const updates = [...countByProductId.entries()].map(([id, access_count_2026]) => ({ id, access_count_2026 }));

  console.log(`Matched: ${matched} file row(s) → ${updates.length} distinct product(s), skipped: ${skipped}`);

  if (dryRun) {
    console.log("Dry run - no writes made.");
    return;
  }

  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const { error } = await admin.rpc("fn_bulk_set_access_count", {
      pairs: batch.map((u) => ({ id: u.id, access_count_2026: u.access_count_2026 })),
    });
    if (error) throw error;
    console.log(`${Math.min(i + BATCH, updates.length)}/${updates.length} written`);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
