// Follow-up to scripts/merge-webshop-products.mjs: classifies the webshop-
// origin products that got no category on merge (the Anthropic account ran
// out of credit mid-classification that day, so all 7,898 were inserted
// with category_code = null rather than leaving the whole merge blocked -
// Anis: "finish without the missing few, then we refill"). Run this once
// billing is topped up; safe to run multiple times (only ever targets rows
// still missing a category, so an interrupted run just resumes).
//
// Usage: node scripts/backfill-webshop-categories.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 80;
const CONCURRENCY = 5;

const CATEGORIES = [
  ["01", "Inspektion & Wartung"], ["02", "Karosseriereparatur"], ["03", "Verglasung"],
  ["04", "Fahrzeugaufbereitung"], ["05", "Klima"], ["06", "Lampen"], ["07", "Elektrik"],
  ["08", "Elektromobilität"], ["09", "Reifenmontage"], ["10", "Lackierung"],
  ["11", "Fahrzeugteile PKW"], ["12", "Fahrzeugteile NFZ"], ["13", "Werkstattausrüstung"],
  ["14", "Druckluft"], ["15", "Werkzeuge"], ["16", "DIN- & Normteile"], ["17", "Sortimente"],
];
const CATEGORY_NAME_BY_CODE = new Map(CATEGORIES);

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
  return ClassifyResultSchema.parse(JSON.parse(textBlock.text)).assignments;
}

async function main() {
  const products = await fetchAll("products", "id, sku, name", (q) =>
    q.eq("source", "webshop").is("category_code", null),
  );
  console.log(`${products.length} unkategorisierte Webshop-Produkte.`);
  if (products.length === 0) return;

  const batches = chunk(products, BATCH_SIZE);
  const updates = [];
  let done = 0;
  let failedBatches = 0;
  await pool(
    batches,
    async (batch) => {
      try {
        const assignments = await classifyBatch(batch);
        for (const a of assignments) {
          const product = batch.find((p) => p.sku === a.sku);
          if (product) updates.push({ id: product.id, category_code: a.category_code });
        }
      } catch (e) {
        failedBatches++;
        console.log(`\n  [Batch fehlgeschlagen] ${e.message}`);
      }
      done++;
      process.stdout.write(`\r  Batch ${done}/${batches.length}`);
    },
    CONCURRENCY,
  );
  console.log(`\n${updates.length} klassifiziert, ${failedBatches} Batches fehlgeschlagen (bleiben für den nächsten Lauf offen).`);

  if (DRY_RUN) {
    console.log(JSON.stringify(updates.slice(0, 10), null, 2));
    console.log("\n--dry-run: keine Schreibvorgänge.");
    return;
  }

  console.log("Schreibe category_code/category_name...");
  let written = 0;
  for (const batch of chunk(updates, 500)) {
    const { error } = await admin.rpc("fn_bulk_set_product_category", {
      pairs: batch.map((u) => ({
        product_id: u.id,
        category_code: u.category_code,
        category_name: CATEGORY_NAME_BY_CODE.get(u.category_code),
      })),
    });
    if (error) console.log(`  Fehler: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  ${written}/${updates.length}`);
  }
  console.log(`\n\nFertig: ${updates.length} Produkte kategorisiert.`);
}

main();
