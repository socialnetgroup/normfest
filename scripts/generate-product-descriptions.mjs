// Generates a short sales-facing description for products that have none
// (Anis, 2026-07-25: 9,545 of 11,909 - all 7,898 webshop-origin products,
// where the crawl never captured description text, plus 1,647 PDF-origin
// ones whose catalog card genuinely has no prose, per the M3 QA pass).
//
// Explicitly NOT sourced from real Normfest documentation - general product-
// type knowledge only (what it is, typical use case, a couple of honest
// selling angles), so it must never be presented as official Normfest text.
// Flagged via products.description_is_generated and badged in the UI - same
// "never silently mixed" principle as image_is_representative.
//
// Usage: node scripts/generate-product-descriptions.mjs [--dry-run] [--limit=N]
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
const BATCH_SIZE = 30;
const CONCURRENCY = 5;
const WRITE_BATCH_SIZE = 500;

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

const ResultSchema = z.object({
  descriptions: z.array(z.object({ sku: z.string(), description: z.string() })),
});

async function generateBatch(batch) {
  const response = await anthropic.messages.create({
    model: getModel("bulk"),
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content:
          `Schreibe für jedes Produkt (Kfz-Werkstattbedarf/Verbrauchsmaterial-Großhandel) eine kurze, ` +
          `verkaufsorientierte Produktbeschreibung auf Deutsch für einen Telesales-Agenten. Format: 2-4 ` +
          `Stichpunkte, jeweils mit "- " beginnend (gleiches Format wie echte Katalogtexte). Inhalt: was das ` +
          `Produkt ist, typischer Einsatzzweck in der Kfz-Werkstatt, 1-2 ehrliche Verkaufsargumente. ` +
          `WICHTIG: Nutze nur allgemeines Fachwissen über diesen Produkttyp - erfinde KEINE konkreten ` +
          `technischen Daten, Maße, Normen oder Zertifizierungen, die für dieses exakte Normfest-Produkt ` +
          `falsch sein könnten. Bleib bei generischen, für die Produktkategorie sicher wahren Aussagen.\n\n` +
          `Produkte:\n` +
          batch.map((p) => `${p.sku}: ${p.name}${p.category_name ? ` (${p.category_name})` : ""}`).join("\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            descriptions: {
              type: "array",
              items: {
                type: "object",
                properties: { sku: { type: "string" }, description: { type: "string" } },
                required: ["sku", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["descriptions"],
          additionalProperties: false,
        },
      },
    },
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return ResultSchema.parse(JSON.parse(textBlock.text)).descriptions;
}

async function main() {
  console.log("Lade Produkte ohne Beschreibung...");
  let products = await fetchAll("products", "id, sku, name, category_name", (q) =>
    q.or("description.is.null,description.eq."),
  );
  if (LIMIT) products = products.slice(0, LIMIT);
  console.log(`  ${products.length} Produkte.\n`);

  const batches = chunk(products, BATCH_SIZE);
  const updates = [];
  let done = 0;
  let failedBatches = 0;
  await pool(
    batches,
    async (batch) => {
      try {
        const descriptions = await generateBatch(batch);
        for (const d of descriptions) {
          const product = batch.find((p) => p.sku === d.sku);
          if (product) updates.push({ id: product.id, description: d.description });
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
  console.log(`\n${updates.length} generiert, ${failedBatches} Batches fehlgeschlagen (bleiben für den nächsten Lauf offen).\n`);

  console.log("Stichprobe (10):");
  for (const u of updates.slice(0, 10)) {
    const product = products.find((p) => p.id === u.id);
    console.log(`\n[${product.sku}] ${product.name}\n${u.description}`);
  }

  if (DRY_RUN) {
    console.log("\n\n--dry-run: keine Schreibvorgänge.");
    return;
  }

  console.log("\n\nSchreibe Beschreibungen...");
  let written = 0;
  for (const batch of chunk(updates, WRITE_BATCH_SIZE)) {
    const { error } = await admin.rpc("fn_bulk_set_product_description", {
      pairs: batch.map((u) => ({ product_id: u.id, description: u.description })),
    });
    if (error) console.log(`  Fehler: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  ${written}/${updates.length}`);
  }
  console.log(`\n\nFertig: ${updates.length} Produkte haben jetzt eine Beschreibung.`);
}

main();
