// Fokus flyer generator (2026-08-09), Anis: "Can you look at this august
// kracher or other normfest style flyers... use that as a reference template
// and make it that style? since prices are on, thats why i asked to put
// prices in the list of products and generate from it." Renders a real,
// styled multi-page PDF directly from a focus list's real products/prices -
// no LLM call, no external image search, purely deterministic layout over
// already-stored data (focus_list_products.note carries the real price
// string, products.image_path the real catalog photo).
//
// Redesigned same day per Anis's detailed brief: "modern, premium... German
// workshop... Swiss/German editorial design... avoid cheap supermarket
// flyer... avoid rainbow palette... restrained... premium B2B e-commerce
// cards." Real content (product names, SKUs, prices, categories, validity)
// is 100% data-driven from the DB - nothing here invents or alters that;
// only the visual system changed. Searched Openverse for a real "modern
// European workshop, car on lift" photo per the brief's stock-image ask -
// results were clipart/stickers or unrelated old-car photos, nothing that
// read as "premium commercial photography," so the hero uses an original
// illustrated technical motif (grid lines + a simplified line-art car/lift
// icon + spotlight glow) instead of a mediocre stock photo. That's the one
// deliberate scope call against the brief; everything else follows it.
import { GlobalFonts, PDFDocument, createCanvas, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";

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

// ---- Design tokens (brief §4/§14/§15) ------------------------------------
// Restrained palette: charcoal/black + white + neutral gray + one accent.
// No per-category rainbow - a single consistent system throughout.
const TOKENS = {
  color: {
    charcoal: "#181b1f",
    charcoal2: "#22262c",
    ink: "#1c2530", // near-black text on light backgrounds
    white: "#ffffff",
    pageBg: "#f4f5f7",
    cardBg: "#ffffff",
    border: "#e4e6ea",
    muted: "#6b7280",
    mutedLight: "#9aa3ad",
    accent: "#d21f3c", // single brand accent - prices, badges, dividers, CTAs
    metallic: "#aab2bc",
  },
  font: {
    body: "Poppins",
    medium: "Poppins SemiBold",
    bold: "Poppins Bold",
    boldItalic: "Poppins Bold Italic",
  },
  radius: { card: 10, badge: 5 },
  shadow: { color: "rgba(20,22,26,0.14)", blur: 14, offsetY: 5 },
};

const NORMFEST_ADDRESS = {
  line1: "Normfest GmbH",
  line2: "Siemensstraße 23",
  line3: "42551 Velbert",
  email: "info@normfest.de",
  web: "www.normfest-shop.com",
  phone: "+49 20 51 / 275-0",
};

function extractPrice(note) {
  if (!note) return null;
  const m = note.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/);
  return m ? m[1] : null;
}

// "Only use claims factually supported by the source" (brief §12) - the
// single badge this data can honestly support is "SET" when the price note
// itself says "Setpreis". No invented "TOP-ANGEBOT"/percentage claims.
function detectBadge(note) {
  if (note && /Setpreis/i.test(note)) return "SET";
  return null;
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

function drawRoundedShadowRect(ctx, x, y, w, h, radius) {
  ctx.save();
  ctx.shadowColor = TOKENS.shadow.color;
  ctx.shadowBlur = TOKENS.shadow.blur;
  ctx.shadowOffsetY = TOKENS.shadow.offsetY;
  ctx.fillStyle = TOKENS.color.cardBg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

function drawBadge(ctx, x, y, label) {
  ctx.font = "7px Poppins Bold";
  const w = ctx.measureText(label).width + 14;
  ctx.fillStyle = TOKENS.color.accent;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 15, TOKENS.radius.badge);
  ctx.fill();
  ctx.fillStyle = TOKENS.color.white;
  ctx.textAlign = "left";
  ctx.fillText(label, x + 7, y + 10.5);
}

function drawFooter(ctx) {
  const y = PAGE_H - 40;
  ctx.strokeStyle = TOKENS.color.border;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y - 12);
  ctx.lineTo(PAGE_W - MARGIN, y - 12);
  ctx.stroke();

  ctx.fillStyle = TOKENS.color.muted;
  ctx.font = "8px Poppins";
  ctx.textAlign = "center";
  ctx.fillText("Nur solange der Vorrat reicht. Preis zzgl. der gesetzlichen MwSt.", PAGE_W / 2, y);

  ctx.fillStyle = TOKENS.color.charcoal;
  ctx.fillRect(0, PAGE_H - 22, PAGE_W, 22);
  ctx.fillStyle = TOKENS.color.white;
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

// Simplified line-art car-on-a-lift icon (brief §8: "industrial precision",
// §16: "workshop-inspired geometric elements... subtle"). Deliberately
// abstract/geometric rather than an attempt at a photorealistic silhouette -
// safer to render correctly and reads as a technical diagram, matching the
// "engineering" tone the brief asks for.
function drawWorkshopMotif(ctx, cx, cy, scale, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TOKENS.color.white;
  ctx.lineWidth = 1.6 / scale;
  ctx.lineJoin = "round";

  // Lift posts + arms
  ctx.strokeRect(-118, 30, 14, 110);
  ctx.strokeRect(104, 30, 14, 110);
  ctx.beginPath();
  ctx.moveTo(-104, 60);
  ctx.lineTo(-40, 60);
  ctx.moveTo(104, 60);
  ctx.lineTo(40, 60);
  ctx.stroke();

  // Car body
  ctx.beginPath();
  ctx.roundRect(-150, -8, 300, 42, 16);
  ctx.stroke();
  // Cabin (trapezoid)
  ctx.beginPath();
  ctx.moveTo(-78, -8);
  ctx.lineTo(-52, -54);
  ctx.lineTo(58, -54);
  ctx.lineTo(80, -8);
  ctx.closePath();
  ctx.stroke();
  // Window divider
  ctx.beginPath();
  ctx.moveTo(0, -54);
  ctx.lineTo(0, -8);
  ctx.stroke();

  // Wheels
  ctx.beginPath();
  ctx.arc(-92, 34, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(92, 34, 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawBlueprintGrid(ctx, x, y, w, h, spacing, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TOKENS.color.white;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let gx = x; gx <= x + w; gx += spacing) {
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
  }
  for (let gy = y; gy <= y + h; gy += spacing) {
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
  }
  ctx.stroke();
  ctx.restore();
}

// Cover / hero (brief §2-3): campaign name as the dominant headline, dark
// charcoal "premium workshop" backdrop instead of the earlier flat navy
// gradient, real "Im Fokus" product photos still featured (already-owned
// imagery, no licensing question).
async function drawCoverPage(ctx, list, featuredRows, storage, imageCache) {
  const grad = ctx.createLinearGradient(0, 0, 0, PAGE_H);
  grad.addColorStop(0, TOKENS.color.charcoal2);
  grad.addColorStop(1, TOKENS.color.charcoal);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  drawBlueprintGrid(ctx, 0, 0, PAGE_W, PAGE_H, 28, 0.035);

  // Soft spotlight glow behind the headline area.
  const glow = ctx.createRadialGradient(MARGIN + 60, 260, 10, MARGIN + 60, 260, 340);
  glow.addColorStop(0, "rgba(210,31,60,0.16)");
  glow.addColorStop(1, "rgba(210,31,60,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  drawWorkshopMotif(ctx, PAGE_W - 150, 300, 0.62, 0.16);

  ctx.fillStyle = TOKENS.color.white;
  ctx.font = "16px Poppins SemiBold";
  ctx.textAlign = "right";
  ctx.fillText("NORMFEST®", PAGE_W - MARGIN, 56);

  ctx.textAlign = "left";
  ctx.fillStyle = TOKENS.color.accent;
  ctx.font = "11px Poppins SemiBold";
  ctx.fillText("F A I R  ·  O N L I N E  ·  K U N D E N O R I E N T I E R T  ·  U N S C H L A G B A R", MARGIN, 110);

  // Campaign name is the dominant headline (brief §3) - real list.name,
  // never invented text.
  ctx.font = "58px Poppins Bold";
  ctx.fillStyle = TOKENS.color.white;
  const nameLines = wrapText(ctx, list.name.toUpperCase(), PAGE_W - MARGIN * 2 - 60);
  let ny = 190;
  for (const line of nameLines.slice(0, 3)) {
    ctx.fillText(line, MARGIN, ny);
    ny += 58;
  }
  ctx.fillStyle = TOKENS.color.accent;
  ctx.fillRect(MARGIN, ny - 40, 90, 5);
  ny += 20;

  if (list.validityLabel) {
    ctx.font = "15px Poppins SemiBold";
    ctx.fillStyle = "#d7dbe0";
    ctx.fillText(list.validityLabel.toUpperCase(), MARGIN, ny + 20);
    ny += 20;
  }

  // Stat row: real counts, uppercase, spaced - "immediately visible" info.
  ny += 56;
  ctx.font = "26px Poppins Bold";
  ctx.fillStyle = TOKENS.color.white;
  ctx.fillText(String(list.productCount), MARGIN, ny);
  const productNumW = ctx.measureText(String(list.productCount)).width;
  ctx.font = "10px Poppins SemiBold";
  ctx.fillStyle = TOKENS.color.mutedLight;
  ctx.fillText("AKTIONSPRODUKTE", MARGIN + productNumW + 10, ny);

  const col2x = MARGIN + 230;
  ctx.font = "26px Poppins Bold";
  ctx.fillStyle = TOKENS.color.white;
  ctx.fillText(String(list.categoryCount), col2x, ny);
  const catNumW = ctx.measureText(String(list.categoryCount)).width;
  ctx.font = "10px Poppins SemiBold";
  ctx.fillStyle = TOKENS.color.mutedLight;
  ctx.fillText(list.categoryCount === 1 ? "KATEGORIE" : "KATEGORIEN", col2x + catNumW + 10, ny);

  // "Im Fokus" showcase strip - up to 3 real products with real photos.
  if (featuredRows.length > 0) {
    const stripY = PAGE_H - 232;
    ctx.font = "10px Poppins SemiBold";
    ctx.fillStyle = TOKENS.color.mutedLight;
    ctx.textAlign = "left";
    ctx.fillText("I M   F O K U S", MARGIN, stripY - 12);

    const gap = 14;
    const cardW = (PAGE_W - MARGIN * 2 - gap * 2) / 3;
    const cardH = 160;
    const imgSize = 74;

    for (let i = 0; i < Math.min(3, featuredRows.length); i++) {
      const row = featuredRows[i];
      const p = row.products;
      const cx = MARGIN + i * (cardW + gap);

      drawRoundedShadowRect(ctx, cx, stripY, cardW, cardH, TOKENS.radius.card);

      const badge = detectBadge(row.note);
      if (badge) drawBadge(ctx, cx + 8, stripY + 8, badge);

      if (p.image_path) {
        const img = await getFlyerImage(p.image_path, storage, imageCache);
        if (img) {
          const scale = Math.min(imgSize / img.width, imgSize / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, cx + (cardW - dw) / 2, stripY + 12 + (imgSize - dh) / 2, dw, dh);
        }
      }

      ctx.textAlign = "center";
      ctx.fillStyle = TOKENS.color.ink;
      ctx.font = "8.5px Poppins SemiBold";
      const pNameLines = wrapText(ctx, p.name, cardW - 14).slice(0, 2);
      let ny2 = stripY + imgSize + 26;
      for (const line of pNameLines) {
        ctx.fillText(line, cx + cardW / 2, ny2);
        ny2 += 11;
      }

      const price = extractPrice(row.note);
      if (price) {
        ctx.fillStyle = TOKENS.color.accent;
        ctx.font = "17px Poppins Bold";
        ctx.fillText(price + " €", cx + cardW / 2, stripY + cardH - 14);
      }
      ctx.textAlign = "left";
    }
  }
}

const COLS = 3;
const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
const ROW_GAP = 12;
const CARD_H = 196;
const ROW_H = CARD_H + ROW_GAP;
const TOP_HEADER_H = 58;
const CONTENT_TOP_AFTER_HEADER = TOP_HEADER_H + 24;
const CONTENT_BOTTOM = PAGE_H - 60;
const DIVIDER_H = 32;

// Numbered charcoal category banner (brief §7) - one consistent dark
// treatment with a numbered tag and accent underline, not a per-category
// rainbow bar.
function drawTopCategoryHeader(ctx, name, number, continued) {
  ctx.fillStyle = TOKENS.color.charcoal;
  ctx.fillRect(0, 0, PAGE_W, TOP_HEADER_H);
  drawBlueprintGrid(ctx, 0, 0, PAGE_W, TOP_HEADER_H, 22, 0.05);

  ctx.fillStyle = TOKENS.color.accent;
  ctx.font = "12px Poppins Bold";
  ctx.textAlign = "left";
  ctx.fillText(number, MARGIN, 24);

  ctx.fillStyle = TOKENS.color.white;
  ctx.font = "19px Poppins Bold";
  ctx.fillText(name.toUpperCase() + (continued ? " (FORTSETZUNG)" : ""), MARGIN, 44);

  ctx.fillStyle = TOKENS.color.accent;
  ctx.fillRect(0, TOP_HEADER_H - 3, PAGE_W, 3);
}

// Mid-page transition between categories (room permitting) - a slimmer
// inline divider rather than a full-bleed bar, keeping the same numbered
// treatment as the top header.
function drawInlineCategoryDivider(ctx, y, name, number) {
  ctx.fillStyle = TOKENS.color.accent;
  ctx.fillRect(MARGIN, y, 4, 20);
  ctx.fillStyle = TOKENS.color.mutedLight;
  ctx.font = "9px Poppins Bold";
  ctx.textAlign = "left";
  ctx.fillText(number, MARGIN + 12, y + 9);
  ctx.fillStyle = TOKENS.color.ink;
  ctx.font = "13px Poppins Bold";
  ctx.fillText(name.toUpperCase(), MARGIN + 12, y + 20);
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
// the downscale output to PNG (lossless) fixed it completely - confirmed by
// rendering the same product photo both ways and comparing crops. Real
// cost: file size for the full 64-product flyer went from 0.98MB (JPEG,
// blurry) to 4.2MB (PNG, sharp) - still comfortably small for an email
// attachment, so quality won over the smaller-but-broken JPEG path.
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

// Premium product card (brief §5): white card, subtle shadow, generous
// whitespace, dominant upright bold price (not the old italic "discount
// flyer" slant), small secondary Art.-Nr., optional factual "SET" badge.
async function drawProductCard(ctx, x, y, row, imageCache, storage) {
  const p = row.products;
  if (!p) return;

  drawRoundedShadowRect(ctx, x, y, CELL_W - ROW_GAP, CARD_H, TOKENS.radius.card);
  const cardW = CELL_W - ROW_GAP;

  const badge = detectBadge(row.note);
  if (badge) drawBadge(ctx, x + 8, y + 8, badge);

  const imgSize = 92;
  const imgY = y + 14;
  if (p.image_path) {
    const img = await getFlyerImage(p.image_path, storage, imageCache);
    if (img) {
      const scale = Math.min(imgSize / img.width, imgSize / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (cardW - dw) / 2, imgY + (imgSize - dh) / 2, dw, dh);
    }
  }

  let cy = imgY + imgSize + 16;
  ctx.textAlign = "left";
  ctx.fillStyle = TOKENS.color.ink;
  ctx.font = "10px Poppins SemiBold";
  const nameLines = wrapText(ctx, p.name, cardW - 20).slice(0, 2);
  for (const line of nameLines) {
    ctx.fillText(line, x + 10, cy);
    cy += 12;
  }

  ctx.fillStyle = TOKENS.color.mutedLight;
  ctx.font = "7.5px Poppins";
  ctx.fillText(`Art.-Nr. ${p.sku}`, x + 10, cy + 3);

  // Divider + dominant price, anchored to the card bottom so every price in
  // a row sits at the same baseline regardless of name-wrap length (brief
  // §15: "all prices in a column should align visually").
  const priceY = y + CARD_H - 34;
  ctx.strokeStyle = TOKENS.color.border;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x + 10, priceY - 12);
  ctx.lineTo(x + cardW - 10, priceY - 12);
  ctx.stroke();

  const price = extractPrice(row.note);
  if (price) {
    ctx.fillStyle = TOKENS.color.accent;
    ctx.font = "21px Poppins Bold";
    ctx.fillText(price + " €", x + 10, priceY + 10);
  }

  if (row.note) {
    ctx.fillStyle = TOKENS.color.muted;
    ctx.font = "7px Poppins";
    const noteLines = wrapText(ctx, row.note, cardW - 20).slice(0, 2);
    let noteY = priceY + 22;
    for (const line of noteLines) {
      ctx.fillText(line, x + 10, noteY);
      noteY += 9;
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

  const doc = new PDFDocument({
    title: `Fokus – ${list.name}`,
    author: "Normfest",
    creator: "Normfest Sales Assistant",
  });

  const imageCache = new Map();

  const featuredRows = rows.filter((r) => r.products.image_path && extractPrice(r.note)).slice(0, 3);

  const coverCtx = doc.beginPage(PAGE_W, PAGE_H);
  await drawCoverPage(
    coverCtx,
    {
      name: list.name,
      note: list.note,
      validityLabel: validityMatch ? validityMatch[0] : null,
      productCount: rows.length,
      categoryCount: categories.length,
    },
    featuredRows,
    supabase.storage,
    imageCache,
  );
  doc.endPage();

  // Continuous-flow layout: categories pack onto the same page when there's
  // room (a full-bleed header only at the top of a page, a slim inline
  // divider mid-page) instead of always forcing a new page per category -
  // an earlier version force-broke per category and produced 15 pages for
  // 64 products (vs. the real reference flyer's 9 pages for a similar
  // count), leaving large near-empty pages for any category with <6 items.
  let ctx = null;
  let cursorY = 0;

  function startPage(categoryLabel, number, continued) {
    ctx = doc.beginPage(PAGE_W, PAGE_H);
    ctx.fillStyle = TOKENS.color.pageBg;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    drawTopCategoryHeader(ctx, categoryLabel, number, continued);
    cursorY = CONTENT_TOP_AFTER_HEADER;
  }
  function finishPage() {
    drawFooter(ctx);
    doc.endPage();
  }

  for (let ci = 0; ci < categories.length; ci++) {
    const category = categories[ci];
    const number = String(ci + 1).padStart(2, "0");
    const categoryRows = byCategory.get(category);

    if (ctx === null) {
      startPage(category, number, false);
    } else if (cursorY + ROW_H > CONTENT_BOTTOM) {
      finishPage();
      startPage(category, number, false);
    } else {
      drawInlineCategoryDivider(ctx, cursorY, category, number);
      cursorY += DIVIDER_H;
    }

    let col = 0;
    for (let i = 0; i < categoryRows.length; i++) {
      if (col === 0 && cursorY + ROW_H > CONTENT_BOTTOM) {
        finishPage();
        startPage(category, number, true);
      }
      const x = MARGIN + col * CELL_W;
      const y = cursorY;
      await drawProductCard(ctx, x, y, categoryRows[i], imageCache, supabase.storage);
      col++;
      if (col === COLS) {
        col = 0;
        cursorY += ROW_H;
      }
    }
    if (col !== 0) cursorY += ROW_H;
  }

  if (ctx) finishPage();

  return doc.close();
}
