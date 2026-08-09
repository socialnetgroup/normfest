// AI hero/category art for the Fokus flyer (2026-08-09), Anis: "Lets use AI
// image generation etc where its needed to make it a real deal flyer... take
// the best of 2 worlds" - product cards/prices/SKUs stay 100% deterministic
// canvas rendering (§3.2.6 "never fabricate" discipline - image models are
// also known to garble rendered text), but the cover hero photo and each
// category header's accent photo are now real gpt-image-1.5 generations
// instead of a single cropped reference photo. Regenerated fresh on every
// "Flyer generieren" click per Anis's explicit ask ("so every flyer looks
// different... seasonal themes where applicable") - no caching, no new DB
// columns needed since nothing is persisted except the final PDF (same as
// before).
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { getOpenAIClient, IMAGE_MODEL, IMAGE_QUALITY } from "./provider.mjs";

const NO_TEXT_DIRECTIVE =
  "No text, no numbers, no letters, no logos, no watermarks, no readable writing anywhere in the image - purely photographic.";

// Brand-on-workwear allowance (2026-08-09), Anis: "If possible and showing
// on things like tshirts, caps, back, front, use the possibility to 'brand'
// it or simply write Normfest in white font on the dark shirt." Deliberately
// scoped narrow - only the real company name, only on workwear fabric, only
// in the hero (a person is present; the category accent shots are inanimate
// close-ups with no plausible place for a garment). Still a real risk: text
// rendering in image models is imperfect even for short real words, so this
// can occasionally come out slightly garbled on a given generation - the
// practical fix for that is the same as any other AI-art miss: regenerate.
const WORKWEAR_BRAND_DIRECTIVE =
  "Exception: if the mechanic's workwear (polo shirt back/chest, or a cap) is naturally visible in the shot, it may show a small, correctly-spelled 'NORMFEST' print or embroidery in clean white lettering - subtle, photorealistic, not the focal point.";

function seasonForMonth(month) {
  if ([12, 1, 2].includes(month)) return "winter, cool tones, hint of frost or snow light through a window";
  if ([3, 4, 5].includes(month)) return "spring, fresh bright daylight";
  if ([6, 7, 8].includes(month)) return "summer, warm golden light";
  return "autumn, warm amber tones";
}

// Scene variety (2026-08-09), Anis: "always kinda the same style. Add more
// varieties. For example car workshop, car on dizalica [lift], working on
// car etc, so it shifts a bit." Every generation was scoped to one fixed
// framing (close-up on wheel/brake) - picking randomly from several real
// workshop scenes each call gives genuinely different compositions from
// flyer to flyer while staying inside the same real, plausible workshop
// setting (never a fabricated/unrelated scene).
const HERO_SCENES = [
  "A mechanic in dark workwear services a premium car on a lift, close-up on the wheel/brake area",
  "A wide establishing shot of a mechanic in dark workwear working beneath a car raised on a hydraulic lift, inside a spacious, well-organized modern workshop",
  "A mechanic in dark workwear leaning over an open engine bay with the hood up, working with hand tools",
  "A mechanic in dark workwear standing at a clean, organized workbench full of tools, with a car visible on a lift in the background",
  "Two mechanics in dark workwear collaborating around a car raised on a lift in a modern, well-lit workshop bay",
];

function buildHeroPrompt(listName, month) {
  const scene = HERO_SCENES[Math.floor(Math.random() * HERO_SCENES.length)];
  return (
    `Professional high-end commercial photography of a modern European car repair workshop. ` +
    `${scene}, ${seasonForMonth(month)}, dramatic cinematic lighting, shallow depth of field, photorealistic, ` +
    `editorial automotive photography, moody and premium mood evoking the campaign "${listName}". ` +
    NO_TEXT_DIRECTIVE +
    " " +
    WORKWEAR_BRAND_DIRECTIVE
  );
}

function buildCategoryAccentPrompt(categoryName, month) {
  return (
    `Professional close-up commercial product photography related to the automotive workshop category ` +
    `"${categoryName}", relevant tools/parts/products artfully arranged, moody dramatic studio lighting, ` +
    `shallow depth of field, ${seasonForMonth(month)}, high-end photorealistic photography. ` +
    NO_TEXT_DIRECTIVE
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

// Real, found-by-inspection bug (2026-08-09): gpt-image-1.5's PNG output
// embeds a `caBX` C2PA content-provenance chunk (~25KB of manifest data)
// ahead of IDAT - a valid, spec-legal private ancillary chunk, but
// @napi-rs/canvas's loadImage() throws a misleading "Invalid SVG image"
// error trying to parse a PNG that carries it (confirmed via direct chunk
// inspection: stripping this one chunk, and only this chunk, made loadImage
// succeed). Strips every chunk except the handful needed to render pixels -
// safe, since C2PA metadata carries no visual information.
function stripUnsupportedPngChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return buf;
  const parts = [buf.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 8 + len + 4;
    if (chunkEnd > buf.length) break;
    if (PNG_KEEP_CHUNKS.has(type)) parts.push(buf.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }
  return Buffer.concat(parts);
}

// PDFDocument embeds whatever pixel data drawImage receives at face value -
// the same bug already fixed once for product photos (§13 M4 note in
// generate-focus-flyer.mjs). gpt-image-1.5's real output is ~2MB/image at
// 1024x1536 or 1536x1024; embedding a hero + up to ~8 category accents
// unscaled produced a 22.8MB PDF - way too large to email. Downscale to a
// real target long-side (PNG re-encode, not JPEG - the PDF backend's known
// JPEG double-compression bug applies here too) before returning.
async function downscaleToPng(buf, maxLongSide) {
  const img = await loadImage(buf);
  const scale = Math.min(maxLongSide / Math.max(img.width, img.height), 1);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toBuffer("image/png");
}

async function generateOne(prompt, size, maxLongSide) {
  const client = getOpenAIClient();
  const result = await client.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size,
    quality: IMAGE_QUALITY,
    n: 1,
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image data returned");
  const rawBuf = Buffer.from(b64, "base64");
  if (!rawBuf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`unexpected image data (not a PNG, ${rawBuf.length} bytes)`);
  }
  return await downscaleToPng(stripUnsupportedPngChunks(rawBuf), maxLongSide);
}

// Up to 2 retries (3 attempts total, was 1 retry/2 attempts - 2026-08-09,
// found via the fallback investigation below that a single retry wasn't
// enough headroom) - a brand-new OpenAI org can sit on a low Tier 1
// images-per-minute cap, and this flyer can request up to ~9 images (1 hero
// + up to ~8 category accents) in one go. Every exhausted retry here means
// the caller falls back to a static image instead of fresh AI art, so it's
// worth spending a bit more real time to avoid that.
const RETRY_DELAYS_MS = [3000, 8000];

async function generateWithRetry(prompt, size, maxLongSide) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await generateOne(prompt, size, maxLongSide);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        const status = err?.status ?? err?.response?.status;
        const delay = status === 429 ? RETRY_DELAYS_MS[attempt] * 1.5 : RETRY_DELAYS_MS[attempt];
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Generates the cover hero photo. Returns a PNG Buffer, or null if
 * generation failed (caller falls back to the static reference photo
 * rather than failing the whole flyer over one AI call).
 */
export async function generateHeroImage(listName) {
  const month = new Date().getMonth() + 1;
  try {
    return await generateWithRetry(buildHeroPrompt(listName, month), "1024x1536", 900);
  } catch (err) {
    console.error("[flyer-images] hero generation failed:", err.message ?? err);
    return null;
  }
}

/**
 * Generates one accent photo per category name, with modest concurrency
 * (rate-limit friendly) and per-image failure isolation - a category simply
 * renders without a photo texture if its generation fails, same "missing
 * asset degrades gracefully" pattern already used for product photos.
 * Returns a Map<categoryName, Buffer|null>.
 */
export async function generateCategoryAccentImages(categoryNames) {
  const month = new Date().getMonth() + 1;
  const results = await mapWithConcurrency(categoryNames, 3, async (name) => {
    try {
      return await generateWithRetry(buildCategoryAccentPrompt(name, month), "1536x1024", 500);
    } catch (err) {
      console.error(`[flyer-images] accent generation failed for "${name}":`, err.message ?? err);
      return null;
    }
  });
  return new Map(categoryNames.map((name, i) => [name, results[i]]));
}
