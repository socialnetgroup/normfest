// Closes the final product-photo gap (84 products with no photo at all,
// see scripts/fill-representative-images.mjs) by cropping each product's
// own real photo directly out of the catalog PDF (input/gesamtkatalog_2025_26.pdf).
// These own photos are strictly better than the "similar product" fallback
// used elsewhere, since they're the exact item.
//
// No poppler/Python available in this environment - pages are rendered via
// pdfjs-dist + @napi-rs/canvas (scripts/render-catalog-page.mjs). Each
// product's stored source_page is occasionally off by one (confirmed during
// the M3 QA pass, CLAUDE.md §14 item 8), so every group also renders the
// page before/after and lets the model search all three rather than
// trusting source_page blindly.
//
// A vision call (Sonnet-class per §3.2.9 - this needs real spatial
// reasoning, not bulk extraction) locates each target product's own photo
// as a normalized bounding box; matches are cropped with @napi-rs/canvas
// and uploaded to Storage as catalog/{sku}.png - the same filename
// convention used for real webshop photos, so fn_flag_representative_images()
// correctly leaves these un-flagged (own real photo, not representative).
//
// Usage: node scripts/crop-catalog-images.mjs [--dry-run]
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";
import { renderPage } from "./render-catalog-page.mjs";

process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const SCRATCH_DIR = "scripts/_crop-preview";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

const MatchSchema = z.object({
  sku: z.string(),
  found: z.boolean(),
  page_offset: z.number().int().nullable(),
  bbox: z.array(z.number()).length(4).nullable(),
});
const ResultSchema = z.object({ matches: z.array(MatchSchema) });

async function fetchTargets() {
  const { data, error } = await admin
    .from("products")
    .select("id, sku, name, source_page")
    .is("image_path", null)
    .order("source_page");
  if (error) throw error;
  // SKU 1957-001-0 "Inhaltsverzeichnis" is a table-of-contents cross-reference
  // entry, not a real physical product - it has no photo to crop.
  return data.filter((p) => p.sku !== "1957-001-0");
}

function groupByPage(products) {
  const groups = new Map();
  for (const p of products) {
    if (!groups.has(p.source_page)) groups.set(p.source_page, []);
    groups.get(p.source_page).push(p);
  }
  return groups;
}

async function renderPageCached(pageNumber, cache) {
  if (pageNumber < 1) return null;
  if (!cache.has(pageNumber)) {
    try {
      cache.set(pageNumber, await renderPage(pageNumber));
    } catch {
      cache.set(pageNumber, null);
    }
  }
  return cache.get(pageNumber);
}

async function findMatches(pageNumber, targets, pngByOffset, offsets) {
  const images = offsets
    .filter((offset) => pngByOffset.get(offset))
    .map((offset) => ({ offset, png: pngByOffset.get(offset) }));

  const content = [];
  for (const { offset, png } of images) {
    content.push({ type: "text", text: `Bild (page_offset ${offset}, tatsächliche Seite ${pageNumber + offset}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
  }
  content.push({
    type: "text",
    text:
      `Das sind ${images.length} Seiten aus dem Normfest-Produktkatalog. Finde für jede der folgenden ` +
      `Art.-Nr. (mit Produktname) das zugehörige eigene Produktfoto (NICHT Text, NICHT das Normfest-Logo, ` +
      `NICHT ein anderes Produkt auf derselben Seite) und gib die Bounding-Box als Bruchteil (0-1) der ` +
      `Bildbreite/-höhe zurück: genau 4 Zahlen [x_min, y_min, x_max, y_max]. Die gespeicherte Seitenzahl kann um eine Seite ` +
      `daneben liegen, deshalb bekommst du die Nachbarseiten auch - gib den korrekten page_offset an. ` +
      `Wenn ein Produkt auf keiner der Seiten ein eigenes Foto hat, setze found=false.\n\n` +
      `Produkte:\n${targets.map((t) => `- ${t.sku}: ${t.name}`).join("\n")}`,
  });

  const response = await anthropic.messages.create({
    model: getModel("analyze"),
    max_tokens: 8000,
    messages: [{ role: "user", content }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                  found: { type: "boolean" },
                  page_offset: { type: ["integer", "null"] },
                  bbox: {
                    type: ["array", "null"],
                    items: { type: "number" },
                  },
                },
                required: ["sku", "found", "page_offset", "bbox"],
                additionalProperties: false,
              },
            },
          },
          required: ["matches"],
          additionalProperties: false,
        },
      },
    },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);
  return ResultSchema.parse(parsed).matches;
}

async function cropToBuffer(pagePng, bbox) {
  const img = await loadImage(pagePng);
  let [x0, y0, x1, y1] = bbox;
  // Guard against a degenerate/out-of-range bbox (seen once as a crash) -
  // clamp to [0,1] and swap if the model returned min/max reversed.
  x0 = Math.min(Math.max(x0, 0), 1);
  y0 = Math.min(Math.max(y0, 0), 1);
  x1 = Math.min(Math.max(x1, 0), 1);
  y1 = Math.min(Math.max(y1, 0), 1);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const sx = Math.max(0, Math.round(x0 * img.width));
  const sy = Math.max(0, Math.round(y0 * img.height));
  const sw = Math.max(4, Math.round((x1 - x0) * img.width));
  const sh = Math.max(4, Math.round((y1 - y0) * img.height));
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toBuffer("image/png");
}

// A real product photo (even a small icon-like one) is comfortably above
// this many bytes; a degenerate/near-empty crop (bad bbox) came back at
// 98-380 bytes in testing - reject and retry rather than upload blank PNGs.
const MIN_CROP_BYTES = 1500;

// Confirmed bad crops from visual spot-check via a contact sheet
// (scripts/make-contact-sheet.mjs) - the model located the wrong region
// (a data table or stray text fragment instead of the product photo) but
// the crop was still above MIN_CROP_BYTES, so the size heuristic alone
// didn't catch these. Left with no image rather than a wrong one.
const MANUAL_REJECT_SKUS = new Set(["3555-999-1", "3558-952-4", "6429", "6590-103", "7101-010"]);

async function processGroup(sourcePage, group, offsets, pageCache) {
  console.log(`Seite ${sourcePage} (Offsets ${offsets.join(",")}): ${group.map((p) => p.sku).join(", ")}`);
  const pngByOffset = new Map();
  for (const offset of offsets) {
    const png = await renderPageCached(sourcePage + offset, pageCache);
    if (png) pngByOffset.set(offset, png);
  }
  let matches;
  try {
    matches = await findMatches(sourcePage, group, pngByOffset, offsets);
  } catch (e) {
    console.log(`  [Vision-Aufruf fehlgeschlagen] ${e.message}`);
    return { resolved: [], unresolved: group };
  }

  const resolved = [];
  const unresolved = [];
  for (const m of matches) {
    const product = group.find((p) => p.sku === m.sku);
    if (!product) continue;
    if (!m.found || !m.bbox || m.page_offset === null) {
      console.log(`  [nicht gefunden] ${m.sku}`);
      unresolved.push(product);
      continue;
    }
    const pagePng = pngByOffset.get(m.page_offset);
    if (!pagePng) {
      unresolved.push(product);
      continue;
    }
    let cropped;
    try {
      cropped = await cropToBuffer(pagePng, m.bbox);
    } catch (e) {
      console.log(`  [Crop-Fehler] ${m.sku}: ${e.message} (bbox=${JSON.stringify(m.bbox)})`);
      unresolved.push(product);
      continue;
    }
    if (cropped.length < MIN_CROP_BYTES) {
      console.log(`  [Crop zu klein, verworfen] ${m.sku} (${cropped.length} bytes, bbox=${JSON.stringify(m.bbox)})`);
      unresolved.push(product);
      continue;
    }
    if (MANUAL_REJECT_SKUS.has(m.sku)) {
      console.log(`  [manuell verworfen nach Sichtprüfung] ${m.sku}`);
      unresolved.push(product);
      continue;
    }
    console.log(`  [gefunden, offset ${m.page_offset}] ${m.sku} (${cropped.length} bytes)`);
    resolved.push({ product, imagePath: `catalog/${product.sku}.png`, cropped });
  }
  return { resolved, unresolved };
}

async function main() {
  const targets = await fetchTargets();
  console.log(`${targets.length} Produkte ohne Bild (ohne Inhaltsverzeichnis-Eintrag).`);
  const groups = groupByPage(targets);
  console.log(`${groups.size} Seiten-Gruppen.\n`);

  if (DRY_RUN) mkdirSync(SCRATCH_DIR, { recursive: true });

  const pageCache = new Map();
  const allResolved = [];
  let stillUnresolved = [];

  for (const [sourcePage, group] of groups) {
    const { resolved, unresolved } = await processGroup(sourcePage, group, [-1, 0, 1], pageCache);
    allResolved.push(...resolved);
    for (const p of unresolved) stillUnresolved.push({ ...p, _originalPage: sourcePage });
  }

  if (stillUnresolved.length > 0) {
    console.log(`\n${stillUnresolved.length} ungeklärt nach erstem Durchlauf - zweiter Versuch mit weiterem Seitenfenster (+/-2)...\n`);
    const retryGroups = groupByPage(stillUnresolved);
    const nextUnresolved = [];
    for (const [sourcePage, group] of retryGroups) {
      const { resolved, unresolved } = await processGroup(sourcePage, group, [-2, -1, 0, 1, 2], pageCache);
      allResolved.push(...resolved);
      nextUnresolved.push(...unresolved);
    }
    stillUnresolved = nextUnresolved;
  }

  const toWrite = [];
  for (const { product, imagePath, cropped } of allResolved) {
    if (DRY_RUN) {
      writeFileSync(`${SCRATCH_DIR}/${product.sku.replace(/[^a-z0-9-]/gi, "_")}.png`, cropped);
      toWrite.push({ product_id: product.id, image_path: imagePath });
      continue;
    }
    const { error } = await admin.storage.from("product-images").upload(imagePath, cropped, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) {
      console.log(`  Fehler beim Upload ${product.sku}: ${error.message}`);
      stillUnresolved.push(product);
      continue;
    }
    toWrite.push({ product_id: product.id, image_path: imagePath });
  }

  console.log(`\nGefunden: ${toWrite.length}`);
  console.log(`Nicht gefunden: ${stillUnresolved.length}`, stillUnresolved.map((p) => p.sku));

  if (DRY_RUN) {
    console.log("\n--dry-run: keine Uploads/Schreibvorgänge, Crops liegen in " + SCRATCH_DIR);
    return;
  }

  console.log("\nSchreibe image_path...");
  const { error } = await admin.rpc("fn_bulk_set_image_path", {
    pairs: toWrite.map((w) => ({ product_id: w.product_id, image_path: w.image_path })),
  });
  if (error) console.log(`Fehler: ${error.message}`);

  console.log("Aktualisiere image_is_representative (eigene Fotos werden korrekt nicht markiert)...");
  const { error: flagError } = await admin.rpc("fn_flag_representative_images");
  if (flagError) console.log(`Fehler: ${flagError.message}`);

  console.log(`\nFertig: ${toWrite.length} weitere Produkte haben jetzt ein echtes eigenes Foto.`);
}

main();
