// Catalog PDF ingest (CLAUDE.md §11.1). Deterministic pass: reflow-mode
// pdftotext + form-feed page tracking + table-of-contents page ranges give
// 100%-reliable category assignment without any model call. LLM pass
// (Claude Haiku — cheapest capable tier, §3.2.9): structures each ~10-page
// batch into {sku, name, subcategory, pack_content, pack_qty, description}
// per product — a pure-regex attempt was tried first and abandoned: the
// catalog's grid layout (multiple product cards side by side) defeats
// plain-text segmentation for name/description boundaries once a page has
// more than one product on it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PDF_PATH = "input/gesamtkatalog_2025_26.pdf";
const PAGES_PER_BATCH = 10;
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 5;

const C1_CONTROL_RE = new RegExp("[\\u0080-\\u009F]", "g");

function pdftotext(args) {
  return execFileSync("pdftotext", args, { maxBuffer: 1024 * 1024 * 50 })
    .toString("utf8")
    .replace(C1_CONTROL_RE, "  ");
}

function parseTOC() {
  const tocSection = pdftotext(["-enc", "UTF-8", "-layout", "-f", "1", "-l", "3", PDF_PATH, "-"]);
  const tocRegex = /(0[1-9]|1[0-7])\s*\|\s*(.+?)\s+(\d+)\s*-\s*(\d+)/g;
  const categories = [];
  let m;
  let lastEnd = 0;
  while ((m = tocRegex.exec(tocSection))) {
    const startPage = Number(m[3]);
    if (startPage <= lastEnd) continue;
    categories.push({ code: m[1], name: m[2].trim(), startPage, endPage: Number(m[4]) });
    lastEnd = Number(m[4]);
  }
  return categories;
}

function categoryForPage(categories, page) {
  for (const cat of categories) {
    if (page >= cat.startPage && page <= cat.endPage) return cat;
  }
  return null;
}

const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  subcategory: z.string().nullable(),
  pack_content: z.string().nullable(),
  pack_qty: z.number().int().nullable(),
  description: z.string().nullable(),
  source_page: z.number().int(),
});
const BatchResultSchema = z.object({ products: z.array(ProductSchema) });

const anthropic = new Anthropic();

async function extractBatch(batchText, pageStart, pageEnd) {
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    messages: [
      {
        role: "user",
        content:
          `Das ist Rohtext (Seiten ${pageStart}-${pageEnd}) aus dem Normfest-Produktkatalog, ` +
          `per pdftotext extrahiert. Der Text kann unordentlich sein (Spaltenumbrüche, verschobene Zeilen).\n\n` +
          `Extrahiere JEDES einzelne Produkt. Jedes Produkt hat eine "Art.-Nr." (SKU). Manche Produkte haben ` +
          `mehrere Art.-Nr. (Varianten mit unterschiedlicher Packungsgröße) — für jede Art.-Nr. einen eigenen Eintrag, ` +
          `mit demselben Namen/Beschreibung, aber eigenem pack_content/pack_qty.\n\n` +
          `Felder pro Produkt:\n` +
          `- sku: die Art.-Nr. exakt wie im Text\n` +
          `- name: Produktname (oft 1-2 Zeilen vor "Art.-Nr.")\n` +
          `- subcategory: die Unterkategorie-Überschrift auf der Seite, falls erkennbar (sonst null)\n` +
          `- pack_content: Inhalt/Packungsgröße, z.B. "400 ml" (sonst null)\n` +
          `- pack_qty: Menge pro Kartonage als Zahl (sonst null)\n` +
          `- description: die Produktbeschreibung als lesbarer Text mit "- " vor jedem Punkt (sonst null)\n` +
          `- source_page: die tatsächliche Seitenzahl dieses Produkts (steht im Text als eigenständige Zahl zwischen den Seiten)\n\n` +
          `Text:\n\n${batchText}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            products: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                  name: { type: "string" },
                  subcategory: { type: ["string", "null"] },
                  pack_content: { type: ["string", "null"] },
                  pack_qty: { type: ["integer", "null"] },
                  description: { type: ["string", "null"] },
                  source_page: { type: "integer" },
                },
                required: ["sku", "name", "subcategory", "pack_content", "pack_qty", "description", "source_page"],
                additionalProperties: false,
              },
            },
          },
          required: ["products"],
          additionalProperties: false,
        },
      },
    },
  });

  const response = await stream.finalMessage();
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text block in response");
  const parsed = JSON.parse(textBlock.text);
  return BatchResultSchema.parse(parsed);
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

function dedupeBySku(products) {
  const bySku = new Map();
  for (const p of products) bySku.set(p.sku, p); // last occurrence wins (§11.1)
  return [...bySku.values()];
}

async function uploadOnly() {
  const raw = JSON.parse(readFileSync("scripts/_catalog-extracted.json", "utf8"));
  const products = dedupeBySku(raw);
  console.log(`${raw.length} rows, ${products.length} after sku dedupe`);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const batchSize = 500;
  let written = 0;
  for (let i = 0; i < products.length; i += batchSize) {
    const chunk = products.slice(i, i + batchSize);
    const { error } = await admin.from("products").upsert(chunk, { onConflict: "sku" });
    if (error) {
      console.error(`Upload batch ${i} failed:`, error);
      process.exit(1);
    }
    written += chunk.length;
    console.log(`Uploaded ${written}/${products.length}`);
  }
  console.log("Done.");
}

async function main() {
  if (process.argv.includes("--upload-only")) {
    await uploadOnly();
    return;
  }

  const categories = parseTOC();
  const lastPage = categories[categories.length - 1].endPage;
  console.log(`Categories: ${categories.length}, last content page: ${lastPage}`);

  const batches = [];
  for (let start = categories[0].startPage; start <= lastPage; start += PAGES_PER_BATCH) {
    batches.push({ start, end: Math.min(start + PAGES_PER_BATCH - 1, lastPage) });
  }
  console.log(`Batches: ${batches.length}`);

  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : batches.length;
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const activeBatches = onlyArg
    ? batches.filter((b) => onlyArg.split("=")[1].split(",").map(Number).includes(b.start))
    : batches.slice(0, limit);

  let done = 0;
  const allProducts = [];
  await pool(
    activeBatches,
    async (batch) => {
      const raw = pdftotext(["-enc", "UTF-8", "-f", String(batch.start), "-l", String(batch.end), PDF_PATH, "-"]);
      if (dryRun) {
        done++;
        console.log(`[dry-run] batch ${batch.start}-${batch.end}: ${raw.length} chars`);
        return;
      }
      try {
        const result = await extractBatch(raw, batch.start, batch.end);
        for (const p of result.products) {
          const cat = categoryForPage(categories, p.source_page);
          allProducts.push({
            sku: p.sku,
            name: p.name,
            category_code: cat?.code ?? null,
            category_name: cat?.name ?? null,
            subcategory: p.subcategory,
            pack_content: p.pack_content,
            pack_qty: p.pack_qty,
            description: p.description,
            source_page: p.source_page,
          });
        }
        done++;
        console.log(`[${done}/${activeBatches.length}] batch ${batch.start}-${batch.end}: ${result.products.length} products`);
      } catch (err) {
        done++;
        console.error(`[${done}/${activeBatches.length}] batch ${batch.start}-${batch.end} FAILED:`, err.message);
      }
    },
    CONCURRENCY,
  );

  if (dryRun) return;

  let merged = allProducts;
  if (onlyArg && existsSync("scripts/_catalog-extracted.json")) {
    const prior = JSON.parse(readFileSync("scripts/_catalog-extracted.json", "utf8"));
    const newSkus = new Set(allProducts.map((p) => p.sku));
    merged = [...prior.filter((p) => !newSkus.has(p.sku)), ...allProducts];
  }

  console.log(`\nTotal products extracted: ${merged.length}`);
  writeFileSync("scripts/_catalog-extracted.json", JSON.stringify(merged, null, 2));
  console.log("Wrote scripts/_catalog-extracted.json");

  const uploadFlag = process.argv.includes("--upload");
  if (!uploadFlag) {
    console.log("Run again with --upload to write these into Supabase.");
    return;
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const batchSize = 500;
  let written = 0;
  for (let i = 0; i < merged.length; i += batchSize) {
    const chunk = merged.slice(i, i + batchSize);
    const { error } = await admin.from("products").upsert(chunk, { onConflict: "sku" });
    if (error) {
      console.error(`Upload batch ${i} failed:`, error);
      process.exit(1);
    }
    written += chunk.length;
    console.log(`Uploaded ${written}/${merged.length}`);
  }
  console.log("Done.");
}

main();
