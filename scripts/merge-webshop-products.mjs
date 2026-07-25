// Final step of the webshop catalog rebuild (CLAUDE.md §14 item 12): merges
// the 7,898 genuinely new/unique products found by the webshop crawl
// (scripts/crawl-webshop-catalog.mjs) into the live `products` table,
// bringing the Katalog up to its full real assortment instead of just the
// 4,011-product PDF extract. Anis explicitly asked to finish this now.
//
// What this does, in order:
//   1. Decode HTML entities in webshop product names (source data has some,
//      e.g. "R&uuml;ckstell-Profil" -> "Rückstell-Profil").
//   2. Classify each new product into one of the 17 real catalog categories
//      via a cheap-tier LLM pass (Haiku, §3.2.9 "bulk") - the webshop crawl
//      never captured our category taxonomy (category_breadcrumb is null
//      for 100% of the new set, confirmed directly), so without this every
//      merged product would be invisible to the Katalog's category filter.
//   3. Drop the handful of generic-logo placeholder "photos" (6 of 7,898 -
//      confirmed via image_hotlink_url containing "Logo_CI") rather than
//      present a CI logo as if it were the product's own photo.
//   4. Insert as `products.source = 'webshop'` (new column, distinguishes
//      these from the PDF-extraction-origin rows - §3.2.7 provenance).
//   5. Mark the corresponding webshop_products_staging rows as matched (so
//      the staging table stays internally consistent / idempotent).
//   6. Re-resolve cross-sell candidates across the now-much-larger SKU
//      universe (old 4,011 + new 7,898) - many candidate pairs that
//      couldn't resolve before (because one side was in the "new" bucket)
//      now can.
//
// Usage: node scripts/merge-webshop-products.mjs [--dry-run] [--limit=N]
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;
const CLASSIFY_BATCH_SIZE = 80;
const CLASSIFY_CONCURRENCY = 5;
const WRITE_BATCH_SIZE = 500;

const CATEGORIES = [
  ["01", "Inspektion & Wartung"], ["02", "Karosseriereparatur"], ["03", "Verglasung"],
  ["04", "Fahrzeugaufbereitung"], ["05", "Klima"], ["06", "Lampen"], ["07", "Elektrik"],
  ["08", "Elektromobilität"], ["09", "Reifenmontage"], ["10", "Lackierung"],
  ["11", "Fahrzeugteile PKW"], ["12", "Fahrzeugteile NFZ"], ["13", "Werkstattausrüstung"],
  ["14", "Druckluft"], ["15", "Werkzeuge"], ["16", "DIN- & Normteile"], ["17", "Sortimente"],
];
const CATEGORY_NAME_BY_CODE = new Map(CATEGORIES);

const HTML_ENTITIES = {
  uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", auml: "ä", Auml: "Ä", szlig: "ß",
  quot: '"', amp: "&", apos: "'", times: "×", reg: "®", trade: "™", ndash: "–",
  mdash: "—", eacute: "é", egrave: "è", ccedil: "ç", deg: "°", micro: "µ", euro: "€",
  hellip: "…", sect: "§", para: "¶", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  nbsp: " ",
};

function decodeEntities(str) {
  return str
    .replace(/&(\w+);/g, (m, name) => HTML_ENTITIES[name] ?? m)
    .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

async function fetchAll(table, columns, filterFn) {
  let all = [];
  let from = 0;
  for (;;) {
    let q = admin.from(table).select(columns).range(from, from + 999);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
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

async function pool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

const ClassifyResultSchema = z.object({
  assignments: z.array(z.object({ sku: z.string(), category_code: z.string() })),
});

async function classifyBatch(batch) {
  const response = await anthropic.messages.create({
    model: getModel("bulk"),
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content:
          `Ordne jedes Produkt (Kfz-Ersatzteile/Verbrauchsmaterial-Großhandel) genau einer der 17 Kategorien zu ` +
          `(nur den Code zurückgeben):\n` +
          CATEGORIES.map(([code, name]) => `${code} = ${name}`).join("\n") +
          `\n\nProdukte:\n` +
          batch.map((p) => `${p.sku}: ${p.name}`).join("\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                  category_code: { type: "string", enum: CATEGORIES.map(([code]) => code) },
                },
                required: ["sku", "category_code"],
                additionalProperties: false,
              },
            },
          },
          required: ["assignments"],
          additionalProperties: false,
        },
      },
    },
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);
  return ClassifyResultSchema.parse(parsed).assignments;
}

async function main() {
  console.log("Lade neue/eindeutige Webshop-Produkte...");
  let staged = await fetchAll(
    "webshop_products_staging",
    "id, sku, name, image_stored_path, image_hotlink_url, cross_sell_candidates",
    (q) => q.is("matched_product_id", null),
  );
  if (LIMIT) staged = staged.slice(0, LIMIT);
  console.log(`  ${staged.length} Produkte.\n`);

  console.log("1/5 Namen dekodieren (HTML-Entities)...");
  const products = staged.map((s) => ({ ...s, name: decodeEntities(s.name) }));

  console.log("2/5 Kategorie-Klassifizierung (Haiku, bulk-tier)...");
  const batches = chunk(products, CLASSIFY_BATCH_SIZE);
  const categoryBySku = new Map();
  let done = 0;
  let failedBatches = 0;
  await pool(
    batches,
    async (batch) => {
      try {
        const assignments = await classifyBatch(batch);
        for (const a of assignments) categoryBySku.set(a.sku, a.category_code);
      } catch (e) {
        failedBatches++;
        console.log(`\n  [Batch fehlgeschlagen, Produkte bleiben ohne Kategorie] ${e.message}`);
      }
      done++;
      process.stdout.write(`\r  Batch ${done}/${batches.length}`);
    },
    CLASSIFY_CONCURRENCY,
  );
  console.log();
  const uncategorized = products.filter((p) => !categoryBySku.has(p.sku));
  console.log(`  ${failedBatches} Batches fehlgeschlagen, ${uncategorized.length} Produkte ohne Kategorie-Zuordnung (werden trotzdem angelegt - Kategorie kann später nachgetragen werden).\n`);

  console.log("3/5 Generische Logo-Platzhalterbilder herausfiltern...");
  let logoFiltered = 0;
  for (const p of products) {
    if (p.image_hotlink_url && /logo/i.test(p.image_hotlink_url)) {
      p.image_stored_path = null;
      logoFiltered++;
    }
  }
  console.log(`  ${logoFiltered} Platzhalterbilder entfernt (Produkt bleibt ohne eigenes Foto).\n`);

  const rows = products.map((p) => {
    const code = categoryBySku.get(p.sku) ?? null;
    return {
      sku: p.sku,
      name: p.name,
      category_code: code,
      category_name: code ? CATEGORY_NAME_BY_CODE.get(code) : null,
      image_path: p.image_stored_path,
      source: "webshop",
    };
  });

  console.log(`4/5 ${DRY_RUN ? "(dry-run) Würde" : "Schreibe"} ${rows.length} neue Produkte...`);
  if (DRY_RUN) {
    console.log("Stichprobe (10):");
    console.log(JSON.stringify(rows.slice(0, 10), null, 2));
    console.log("\n--dry-run: keine Schreibvorgänge.");
    return;
  }

  const insertedIds = [];
  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    const { data, error } = await admin.from("products").insert(batch).select("id, sku");
    if (error) {
      console.log(`  Fehler beim Insert-Batch: ${error.message}`);
      continue;
    }
    insertedIds.push(...data);
    process.stdout.write(`\r  ${insertedIds.length}/${rows.length}`);
  }
  console.log(`\n  ${insertedIds.length} Produkte eingefügt.\n`);

  console.log("5/5 Markiere Staging-Zeilen als übernommen + löse Cross-Sell erneut auf...");
  const skuToNewId = new Map(insertedIds.map((r) => [r.sku, r.id]));
  const stagingMatchPairs = staged
    .filter((s) => skuToNewId.has(s.sku))
    .map((s) => ({ staging_id: s.id, product_id: skuToNewId.get(s.sku) }));
  for (const batch of chunk(stagingMatchPairs, WRITE_BATCH_SIZE)) {
    const { error } = await admin.rpc("fn_bulk_set_matched_product", { pairs: batch });
    if (error) console.log(`  Fehler: ${error.message}`);
  }

  // Re-resolve cross-sell across the full, now much larger SKU universe.
  const allProducts = await fetchAll("products", "id, sku");
  const skuToProductId = new Map(allProducts.map((p) => [p.sku, p.id]));
  const allStaged = await fetchAll("webshop_products_staging", "sku, cross_sell_candidates", (q) =>
    q.not("cross_sell_candidates", "is", null),
  );
  const resolvedPairs = [];
  for (const s of allStaged) {
    const anchorId = skuToProductId.get(s.sku);
    if (!anchorId) continue;
    for (const candidate of s.cross_sell_candidates ?? []) {
      const relatedId = skuToProductId.get(candidate.sku);
      if (!relatedId || relatedId === anchorId) continue;
      resolvedPairs.push({
        product_id: anchorId,
        related_product_id: relatedId,
        relation_type: "cross_sell",
        origin: "curated",
        weight: 2,
        note: `Quelle: normfest-shop.com "Könnte Sie auch interessieren"`,
      });
    }
  }
  console.log(`  ${resolvedPairs.length} Cross-Sell-Paare gefunden (voller SKU-Raum)...`);
  for (const batch of chunk(resolvedPairs, WRITE_BATCH_SIZE)) {
    const { error } = await admin
      .from("product_relations")
      .upsert(batch, { onConflict: "product_id,related_product_id,relation_type", ignoreDuplicates: true });
    if (error) console.log(`  Fehler beim Cross-Sell-Upsert: ${error.message}`);
  }

  const { count: totalProducts } = await admin.from("products").select("id", { count: "exact", head: true });
  const { count: relationCount } = await admin
    .from("product_relations")
    .select("id", { count: "exact", head: true })
    .eq("origin", "curated")
    .eq("relation_type", "cross_sell");
  console.log(`\n=== Fertig ===`);
  console.log(`Katalog gesamt: ${totalProducts} Produkte`);
  console.log(`Cross-Sell-Paare gesamt: ${relationCount}`);
}

main();
