// Fokus flyer generator (2026-08-09), Anis: "Can you look at this august
// kracher or other normfest style flyers... use that as a reference template
// and make it that style? since prices are on, thats why i asked to put
// prices in the list of products and generate from it." Renders a real,
// styled multi-page PDF directly from a focus list's real products/prices -
// no LLM call, no external image search, purely deterministic layout over
// already-stored data (focus_list_products.note carries the real price
// string, products.image_path the real catalog photo).
//
// Redesigned 2026-08-09 (2nd pass), Anis: "Look at file ChatGPT Image Aug 9,
// 2026, 12_51_01 PM in the input folder and copy it 1:1 in flyer format...
// just make the prices red" - a reference mockup he generated (a 3x3 grid of
// 9 flyer pages, built from our real product/price data) is copied here as
// closely as this codebase's own real data allows: dark near-black category
// bars with a blue numbered badge, product cards laid out image-LEFT/
// text-RIGHT (not the previous image-top/text-below stacked card), and a
// closing "ALLES ONLINE BESTELLEN" banner before the footer on the last
// page. Prices are bold red here per Anis's one explicit deviation from the
// reference (which shows plain black prices).
//
// Redesigned 2026-08-09 (3rd pass), Anis: "the quality I expect... lets use
// AI image generation etc where its needed... take the best of 2 worlds."
// The cover hero and each category header's accent photo are now real
// gpt-image-1.5 generations (lib/ai/flyer-images.mjs), regenerated fresh on
// every "Flyer generieren" click so each flyer looks different / can pick up
// seasonal mood - Anis's explicit ask, no caching. Everything that carries
// real facts (product names/SKUs/prices/category text/the Normfest logo)
// stays 100% deterministic canvas rendering - image models are known to
// garble rendered text, and this app's "never fabricate" discipline (§3.2.6)
// already rules out letting an AI model render a real price. If an OpenAI
// call fails (missing key, rate limit, network), each image degrades
// gracefully to its prior static/solid-color treatment rather than failing
// the whole flyer.
import { GlobalFonts, PDFDocument, createCanvas, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { generateCategoryAccentImages, generateHeroImage } from "../ai/flyer-images.mjs";

const FONT_DIR = join(process.cwd(), "assets/fonts");
let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(join(FONT_DIR, "Poppins-Regular.ttf"), "Poppins");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Poppins-SemiBold.ttf"), "Poppins SemiBold");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Poppins-Bold.ttf"), "Poppins Bold");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Poppins-BoldItalic.ttf"), "Poppins Bold Italic");
  fontsRegistered = true;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 32;
const NAVY = "#0b3d78";
const DARK_BAR = "#12151d"; // near-black category bars, matches the reference mockup
const BLUE_BADGE = "#1f5fd9"; // reference's blue numbered category badge
const RED = "#d21f3c"; // prices: Anis's one explicit deviation from the reference (black there)
const CARD_BG = "#f5f6f9";
const CARD_BORDER = "#e2e5eb";

const NORMFEST_ADDRESS = {
  line1: "Normfest GmbH",
  line2: "Siemensstraße 23",
  line3: "42551 Velbert",
  email: "info@normfest.de",
  web: "www.normfest-shop.com",
  phone: "+49 20 51 / 275-0",
};

const COVER_BG_PATH = join(process.cwd(), "assets/flyer/cover-bg.png"); // fallback if AI hero generation fails
const LOGO_PATH = join(process.cwd(), "assets/flyer/normfest-logo.png"); // real asset - never AI-drawn

function extractPrice(note) {
  if (!note) return null;
  const m = note.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/);
  return m ? m[1] : null;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawFooter(ctx) {
  const y = PAGE_H - 40;
  ctx.strokeStyle = "#d0d7e2";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y - 12);
  ctx.lineTo(PAGE_W - MARGIN, y - 12);
  ctx.stroke();

  ctx.fillStyle = "#6b7684";
  ctx.font = "8px Poppins";
  ctx.textAlign = "center";
  ctx.fillText("Nur solange der Vorrat reicht. Preis zzgl. der gesetzlichen MwSt.", PAGE_W / 2, y);

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, PAGE_H - 22, PAGE_W, 22);
  ctx.fillStyle = "#ffffff";
  ctx.font = "8.5px Poppins SemiBold";
  ctx.textAlign = "left";
  ctx.fillText(NORMFEST_ADDRESS.web, MARGIN, PAGE_H - 8);
  ctx.textAlign = "center";
  ctx.font = "8px Poppins";
  ctx.fillText(
    `${NORMFEST_ADDRESS.line1} · ${NORMFEST_ADDRESS.line2} · ${NORMFEST_ADDRESS.line3} · ${NORMFEST_ADDRESS.email}`,
    PAGE_W / 2,
    PAGE_H - 8,
  );
  ctx.textAlign = "right";
  ctx.fillText(NORMFEST_ADDRESS.phone, PAGE_W - MARGIN, PAGE_H - 8);
  ctx.textAlign = "left";
}

// Closing CTA banner (2026-08-09, from the reference mockup's last page) -
// a dark full-width bar with a cart icon + "ALLES ONLINE BESTELLEN" +
// the real shop URL, sitting between the last product grid and the footer.
function drawOnlineOrderBanner(ctx, y) {
  const h = 54;
  ctx.fillStyle = DARK_BAR;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, h);

  // Simple cart-icon glyph (basket + two wheels), vector-drawn.
  const iconX = MARGIN + 22;
  const iconY = y + h / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(iconX - 10, iconY - 9);
  ctx.lineTo(iconX - 6, iconY - 9);
  ctx.lineTo(iconX - 2, iconY + 4);
  ctx.lineTo(iconX + 12, iconY + 4);
  ctx.lineTo(iconX + 15, iconY - 6);
  ctx.lineTo(iconX - 5, iconY - 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(iconX - 1, iconY + 8, 1.8, 0, Math.PI * 2);
  ctx.arc(iconX + 10, iconY + 8, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "10px Poppins Bold";
  ctx.fillText("ALLES ONLINE BESTELLEN:", MARGIN + 42, y + 22);
  ctx.font = "13px Poppins Bold";
  ctx.fillText(NORMFEST_ADDRESS.web, MARGIN + 42, y + 38);
}

// Cover - hero photo is a fresh gpt-image-1.5 generation (heroImageBuffer,
// regenerated every call - Anis: "so every flyer looks different") with the
// static cropped reference photo as a fallback if that call failed; real
// product/list data plus the real Normfest logo (never AI-drawn) on top.
async function drawCoverPage(ctx, list, heroImageBuffer) {
  let bg = null;
  if (heroImageBuffer) {
    try {
      bg = await loadImage(heroImageBuffer);
    } catch (err) {
      console.error("[flyer] failed to decode AI hero image, falling back:", err.message ?? err);
      bg = null;
    }
  }
  if (!bg) {
    try {
      bg = await loadImage(readFileSync(COVER_BG_PATH));
    } catch {
      bg = null;
    }
  }

  // Solid dark panel as the base (the crop's own aspect ratio doesn't
  // stretch cleanly to full-bleed A4 without distorting the workshop
  // photo), photo placed as a right-hand strip so the left ~58% stays a
  // clean, flat surface for our own vector text.
  ctx.fillStyle = DARK_BAR;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const photoX = PAGE_W * 0.42;
  const photoW = PAGE_W - photoX;
  if (bg) {
    const scale = Math.max(photoW / bg.width, PAGE_H / bg.height);
    const dw = bg.width * scale;
    const dh = bg.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(photoX, 0, photoW, PAGE_H);
    ctx.clip();
    ctx.drawImage(bg, photoX + (photoW - dw) / 2, (PAGE_H - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    const grad = ctx.createLinearGradient(photoX, 0, PAGE_W, PAGE_H);
    grad.addColorStop(0, "#0b3d78");
    grad.addColorStop(1, "#123f8c");
    ctx.fillStyle = grad;
    ctx.fillRect(photoX, 0, photoW, PAGE_H);
  }

  // Soft dark fade where the photo meets the text panel, plus a bottom
  // fade so white text stays legible throughout.
  const seam = ctx.createLinearGradient(photoX - 60, 0, photoX + 40, 0);
  seam.addColorStop(0, "rgba(18,21,29,1)");
  seam.addColorStop(1, "rgba(18,21,29,0)");
  ctx.fillStyle = seam;
  ctx.fillRect(photoX - 60, 0, 100, PAGE_H);

  const bottomFade = ctx.createLinearGradient(0, PAGE_H - 220, 0, PAGE_H);
  bottomFade.addColorStop(0, "rgba(10,13,20,0)");
  bottomFade.addColorStop(1, "rgba(10,13,20,0.85)");
  ctx.fillStyle = bottomFade;
  ctx.fillRect(0, PAGE_H - 220, PAGE_W, 220);

  const textPanelW = photoX - MARGIN - 20;

  // Real Normfest logo (never AI-drawn) on a small white card - replaces
  // the earlier plain "NORMFEST®" text wordmark.
  try {
    const logo = await loadImage(readFileSync(LOGO_PATH));
    const cardH = 34;
    const cardW = cardH * (logo.width / logo.height) + 16;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(MARGIN, 20, cardW, cardH, 6);
    ctx.fill();
    ctx.drawImage(logo, MARGIN + 8, 20 + 4, cardW - 16, cardH - 8);
  } catch {
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px Poppins SemiBold";
    ctx.fillText("NORMFEST®", MARGIN, 48);
  }

  ctx.textAlign = "left";
  ctx.font = "34px Poppins Bold";
  const titleLines = wrapText(ctx, list.name.toUpperCase(), textPanelW);
  ctx.fillStyle = "#ffffff";
  let ty = 300;
  for (const line of titleLines.slice(0, 3)) {
    ctx.fillText(line, MARGIN, ty);
    ty += 38;
  }

  if (list.validityLabel) {
    const badgeY = ty + 20;
    ctx.font = "11px Poppins SemiBold";
    const w = Math.min(ctx.measureText(list.validityLabel).width + 32, textPanelW);
    ctx.fillStyle = BLUE_BADGE;
    ctx.beginPath();
    ctx.roundRect(MARGIN, badgeY, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(list.validityLabel, MARGIN + 16, badgeY + 19);
    ty = badgeY + 28;
  }

  // Stat row (product count / category count), reference-style label pair.
  const statY = ty + 40;
  ctx.font = "19px Poppins Bold";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(list.productCount), MARGIN, statY);
  ctx.font = "8px Poppins SemiBold";
  ctx.fillStyle = "#cfd8e8";
  ctx.fillText("AKTIONSPRODUKTE", MARGIN, statY + 12);

  const catX = MARGIN + Math.min(textPanelW * 0.55, 130);
  ctx.font = "19px Poppins Bold";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(list.categoryCount), catX, statY);
  ctx.font = "8px Poppins SemiBold";
  ctx.fillStyle = "#cfd8e8";
  ctx.fillText(list.categoryCount === 1 ? "KATEGORIE" : "KATEGORIEN", catX, statY + 12);

  ctx.font = "8px Poppins SemiBold";
  ctx.fillStyle = "#cfd8e8";
  const tagline = wrapText(ctx, "FAIR · ONLINE · KUNDENORIENTIERT · UNSCHLAGBAR", textPanelW);
  let tly = PAGE_H - 46;
  for (const line of tagline) {
    ctx.fillText(line, MARGIN, tly);
    tly += 12;
  }
}

const COLS = 3;
const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
const CELL_GAP = 6;
const ROW_H = 100;
const TOP_HEADER_H = 58;
const CONTENT_TOP_AFTER_HEADER = TOP_HEADER_H + 18;
const CONTENT_BOTTOM = PAGE_H - 60;
const DIVIDER_H = 32;

function drawTopCategoryHeader(ctx, name, number, continued, accentImage) {
  ctx.fillStyle = DARK_BAR;
  ctx.fillRect(0, 0, PAGE_W, TOP_HEADER_H);

  // AI-generated category accent photo, blended into the right two-thirds
  // of the bar with a fade into DARK_BAR on the left so the badge/name text
  // stays fully legible - same "photo bleeding into a dark bar" idea as the
  // original reference mockup, but with a real (non-cropped) photo per
  // category instead of one shared texture.
  if (accentImage) {
    const stripX = PAGE_W * 0.32;
    const stripW = PAGE_W - stripX;
    ctx.save();
    ctx.beginPath();
    ctx.rect(stripX, 0, stripW, TOP_HEADER_H);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    const scale = Math.max(stripW / accentImage.width, TOP_HEADER_H / accentImage.height);
    const dw = accentImage.width * scale;
    const dh = accentImage.height * scale;
    ctx.drawImage(accentImage, stripX + (stripW - dw) / 2, (TOP_HEADER_H - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
    ctx.restore();

    const fade = ctx.createLinearGradient(stripX - 20, 0, stripX + 90, 0);
    fade.addColorStop(0, DARK_BAR);
    fade.addColorStop(1, "rgba(18,21,29,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(stripX - 20, 0, 110, TOP_HEADER_H);
  }

  ctx.fillStyle = BLUE_BADGE;
  ctx.beginPath();
  ctx.roundRect(MARGIN, 12, 34, 34, 6);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Poppins Bold";
  ctx.textAlign = "center";
  ctx.fillText(number, MARGIN + 17, 34);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = "18px Poppins Bold";
  ctx.fillText(name.toUpperCase(), MARGIN + 46, 34);

  if (continued) {
    ctx.font = "8px Poppins SemiBold";
    ctx.fillStyle = "#9db3e0";
    ctx.fillText("(FORTSETZUNG)", MARGIN + 46, 46);
  }
}

// Mid-page transition between categories (room permitting) - a slimmer
// inline divider rather than a full-bleed bar, since we're not at the top
// of the page.
function drawInlineCategoryDivider(ctx, y, name, number) {
  ctx.fillStyle = BLUE_BADGE;
  ctx.beginPath();
  ctx.roundRect(MARGIN, y, 20, 20, 4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "9px Poppins Bold";
  ctx.textAlign = "center";
  ctx.fillText(number, MARGIN + 10, y + 14);
  ctx.textAlign = "left";

  ctx.fillStyle = "#171b22";
  ctx.font = "13px Poppins Bold";
  ctx.fillText(name.toUpperCase(), MARGIN + 28, y + 15);
}

// PDFDocument embeds whatever pixel data drawImage receives at face value -
// scaling via drawImage's dw/dh does NOT shrink the embedded raster, so a
// full ~1MB catalog photo drawn at 100pt still embeds at full resolution.
// A first pass without this produced a 38MB, 22s PDF for 64 products - way
// too large to email. Fix: pre-downscale each image to real target pixels
// (via an offscreen canvas) once per unique image, cached across the whole
// flyer (many focus-list rows share the same representative photo).
//
// Real second bug (2026-08-09), Anis: "the pictures are blurry bad quality"
// - re-encoding the downscaled image as JPEG looked crisp in isolation
// (verified directly) but came out visibly blocky once embedded in the PDF
// - @napi-rs/canvas's PDF backend appears to re-compress/re-rasterize a
// JPEG source at a much lower internal quality when embedding it. Switching
// the downscale output to PNG (lossless) fixed it completely.
const TARGET_IMG_PX = 380;

async function getFlyerImage(imagePath, storage, imageCache) {
  if (imageCache.has(imagePath)) return imageCache.get(imagePath);
  try {
    const { data, error } = await storage.from("product-images").download(imagePath);
    if (error) {
      imageCache.set(imagePath, null);
      return null;
    }
    const fullImg = await loadImage(Buffer.from(await data.arrayBuffer()));
    const scale = Math.min(TARGET_IMG_PX / fullImg.width, TARGET_IMG_PX / fullImg.height, 1);
    const w = Math.max(1, Math.round(fullImg.width * scale));
    const h = Math.max(1, Math.round(fullImg.height * scale));
    const small = createCanvas(w, h);
    const sctx = small.getContext("2d");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, w, h);
    sctx.drawImage(fullImg, 0, 0, w, h);
    const smallImg = await loadImage(small.toBuffer("image/png"));
    imageCache.set(imagePath, smallImg);
    return smallImg;
  } catch {
    imageCache.set(imagePath, null);
    return null;
  }
}

// Product card (2026-08-09 redesign) - image LEFT / text stacked RIGHT,
// matching the reference mockup exactly (not the previous image-top,
// text-below vertical layout). Light card background + thin border, name
// bold black, Art.-Nr. small gray, price bold RED (Anis's explicit
// deviation - the reference itself uses plain black), unit note small gray.
async function drawProductCell(ctx, x, y, row, imageCache, storage) {
  const p = row.products;
  if (!p) return;

  const cardW = CELL_W - CELL_GAP;
  const cardH = ROW_H - CELL_GAP;

  ctx.fillStyle = CARD_BG;
  ctx.strokeStyle = CARD_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, 4);
  ctx.fill();
  ctx.stroke();

  const imgBox = 56;
  const imgX = x + 8;
  const imgY = y + (cardH - imgBox) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(imgX, imgY, imgBox, imgBox);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(imgX, imgY, imgBox, imgBox);
  ctx.restore();
  if (p.image_path) {
    const img = await getFlyerImage(p.image_path, storage, imageCache);
    if (img) {
      const scale = Math.min(imgBox / img.width, imgBox / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, imgX + (imgBox - dw) / 2, imgY + (imgBox - dh) / 2, dw, dh);
    }
  }

  const textX = imgX + imgBox + 8;
  const textW = x + cardW - textX - 6;
  let cy = y + 13;

  ctx.textAlign = "left";
  ctx.fillStyle = "#171b22";
  ctx.font = "8.5px Poppins Bold";
  const nameLines = wrapText(ctx, p.name, textW).slice(0, 2);
  for (const line of nameLines) {
    ctx.fillText(line, textX, cy);
    cy += 10;
  }

  ctx.fillStyle = "#7a8494";
  ctx.font = "6.5px Poppins";
  ctx.fillText(`Art.-Nr. ${p.sku}`, textX, cy + 4);
  cy += 15;

  const price = extractPrice(row.note);
  if (price) {
    ctx.fillStyle = RED;
    ctx.font = "15px Poppins Bold";
    ctx.fillText(price + " €", textX, cy + 10);
    cy += 15;
  }

  if (row.note) {
    ctx.fillStyle = "#6b7684";
    ctx.font = "6.5px Poppins";
    const noteLines = wrapText(ctx, row.note, textW).slice(0, 2);
    for (const line of noteLines) {
      cy += 8;
      ctx.fillText(line, textX, cy);
    }
  }
}

/**
 * Generates a styled multi-page PDF flyer for a focus list from its real
 * products/prices/photos. Returns a Buffer.
 */
export async function generateFocusListFlyer(supabase, focusListId) {
  ensureFonts();

  const { data: list, error: listErr } = await supabase
    .from("focus_lists")
    .select("id, name, note, created_at")
    .eq("id", focusListId)
    .single();
  if (listErr || !list) throw new Error(listErr?.message ?? "Fokusliste nicht gefunden");

  const { data: items, error: itemsErr } = await supabase
    .from("focus_list_products")
    .select("id, note, products(name, sku, category_name, image_path)")
    .eq("focus_list_id", focusListId)
    .order("id");
  if (itemsErr) throw new Error(itemsErr.message);

  const rows = (items ?? []).filter((r) => r.products);
  if (rows.length === 0) throw new Error("Diese Fokusliste enthält keine Produkte.");

  const byCategory = new Map();
  for (const row of rows) {
    const cat = row.products.category_name ?? "Ohne Kategorie";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(row);
  }
  const categories = [...byCategory.keys()].sort();

  const validityMatch = list.note?.match(/Gültig vom.*?\d{4}/);

  // AI art generation (hero + one accent photo per category) kicked off in
  // parallel, up front, so the ~20-40s of real OpenAI latency overlaps with
  // nothing else rather than serializing behind the PDF drawing work.
  // Regenerated fresh every call, per Anis's explicit ask ("so every flyer
  // looks different") - no caching, nothing persisted but the final PDF.
  const [heroImageBuffer, accentBuffers] = await Promise.all([
    generateHeroImage(list.name),
    generateCategoryAccentImages(categories),
  ]);
  const accentImages = new Map();
  for (const [name, buf] of accentBuffers) {
    if (!buf) continue;
    try {
      accentImages.set(name, await loadImage(buf));
    } catch {
      // skip - category header just renders without a photo texture
    }
  }

  const doc = new PDFDocument({
    title: `Fokus – ${list.name}`,
    author: "Normfest",
    creator: "Normfest Sales Assistant",
  });

  const imageCache = new Map();

  const coverCtx = doc.beginPage(PAGE_W, PAGE_H);
  await drawCoverPage(
    coverCtx,
    {
      name: list.name,
      validityLabel: validityMatch ? validityMatch[0] : null,
      productCount: rows.length,
      categoryCount: categories.length,
    },
    heroImageBuffer,
  );
  doc.endPage();

  // Continuous-flow layout: categories pack onto the same page when there's
  // room (a full-bleed header only at the top of a page, a slim inline
  // divider mid-page) instead of always forcing a new page per category.
  let ctx = null;
  let cursorY = 0;

  function startPage(categoryLabel, number, continued) {
    ctx = doc.beginPage(PAGE_W, PAGE_H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    drawTopCategoryHeader(ctx, categoryLabel, number, continued, accentImages.get(categoryLabel));
    cursorY = CONTENT_TOP_AFTER_HEADER;
  }
  function finishPage(isLast) {
    if (isLast) {
      drawOnlineOrderBanner(ctx, PAGE_H - 128);
    }
    drawFooter(ctx);
    doc.endPage();
  }

  for (let ci = 0; ci < categories.length; ci++) {
    const category = categories[ci];
    const number = String(ci + 1).padStart(2, "0");
    const categoryRows = byCategory.get(category);
    const isLastCategory = ci === categories.length - 1;

    if (ctx === null) {
      startPage(category, number, false);
    } else if (cursorY + ROW_H > CONTENT_BOTTOM) {
      finishPage(false);
      startPage(category, number, false);
    } else {
      drawInlineCategoryDivider(ctx, cursorY, category, number);
      cursorY += DIVIDER_H;
    }

    let col = 0;
    for (let i = 0; i < categoryRows.length; i++) {
      const needsBannerRoom = isLastCategory && i === categoryRows.length - 1;
      const rowLimit = CONTENT_BOTTOM - (needsBannerRoom ? 70 : 0);
      if (col === 0 && cursorY + ROW_H > rowLimit) {
        finishPage(false);
        startPage(category, number, true);
      }
      const x = MARGIN + col * CELL_W;
      const y = cursorY;
      await drawProductCell(ctx, x, y, categoryRows[i], imageCache, supabase.storage);
      col++;
      if (col === COLS) {
        col = 0;
        cursorY += ROW_H;
      }
    }
    if (col !== 0) cursorY += ROW_H;
  }

  if (ctx) finishPage(true);

  return doc.close();
}
