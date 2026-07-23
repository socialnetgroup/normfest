// M4 — first real product_relations seed (§4.3, cross_sell). Curated pairs
// from Anis directly (2026-07-23 workshop-style pass over a catalog-browse
// artifact) — this is what makes the `cross_sell` signal type start firing
// for the first time; the schema/scoring already existed (§6), it was just
// empty.
//
// Usage: node scripts/seed-product-relations.mjs
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAIRS = [
  {
    sku: "3557-001-50",
    relatedSku: "8714-02-11",
    note: "Aderendhülse isoliert + passendes Werkzeug — Anis: 'nicht 100%, aber Beispiel, Hülse und Zange'",
  },
  {
    sku: "2897-333-600",
    relatedSku: "7875-1",
    note: "Bremsenreiniger + Putzpapier (Zellstoffrolle) zum Abwischen",
  },
  {
    sku: "9879-413",
    relatedSku: "8696-510-002",
    note: "Reifenventil + Schlagschrauber (Reifenmontage-Zubehör + Werkzeug)",
  },
  {
    sku: "2000-602-1",
    relatedSku: "2897-910-2",
    note: "Autoschwamm + Airspray-Druckflasche (Fahrzeugpflege/Reinigung)",
  },
  {
    sku: "8696-113-9",
    relatedSku: "7983-011-1",
    note: "Druckluftpistole + Staubsauger (Werkstattreinigung)",
  },
];

async function main() {
  for (const pair of PAIRS) {
    const [{ data: product }, { data: related }] = await Promise.all([
      admin.from("products").select("id, name").eq("sku", pair.sku).single(),
      admin.from("products").select("id, name").eq("sku", pair.relatedSku).single(),
    ]);
    if (!product || !related) {
      console.error(`SKIP — missing product for ${pair.sku} or ${pair.relatedSku}`);
      continue;
    }

    const { error } = await admin.from("product_relations").insert({
      product_id: product.id,
      related_product_id: related.id,
      relation_type: "cross_sell",
      origin: "curated",
      weight: 3,
      note: pair.note,
    });
    if (error) {
      console.error(`FAILED — ${product.name} -> ${related.name}:`, error.message);
      continue;
    }
    console.log(`OK — ${product.name} (${pair.sku}) -> ${related.name} (${pair.relatedSku})`);
  }
}

main();
