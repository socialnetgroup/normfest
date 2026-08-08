// Fokus flyer generator (2026-08-09), Anis: "Can you look at this august
// kracher or other normfest style flyers... use that as a reference template
// and make it that style? since prices are on, thats why i asked to put
// prices in the list of products and generate from it." Renders a real,
// styled multi-page PDF directly from a focus list's real products/prices -
// no LLM call, no external image search, purely deterministic layout over
// already-stored data (focus_list_products.note carries the real price
// string, products.image_path the real catalog photo). Modeled visually on
// the real "August Kracher 2026" flyer (input reviewed directly from the
// Storage-hosted PDF, not guessed) - cover page with validity dates, colored
// category header bars, product grid with a big slanted price + full price
// note as caption, footer disclaimer + real Normfest contact block - but
// redrawn with an original color/type system (Poppins, not their exact
// photographed hero background) rather than literally recreating their
// asset.
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
const NAVY = "#0b3d78";
const RED = "#d21f3c";
const LIGHT_BG = "#f4f7fb";
const CATEGORY_COLORS = ["#0b3d78", "#c9902a", "#1f7a5c", "#a02840", "#4a5fb0", "#2a7a9c"];

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

// Anis (2026-08-09): "1st page just like cover page, dont need that... add
// photos from page 1" - the cover was pure text on a gradient. Rather than
// source an external stock photo (real licensing diligence, uncertain fit),
// it now features real catalog product photos - already owned, no
// licensing question - in a "Im Fokus" showcase strip near the bottom, so
// the cover carries real content instead of being a throwaway title page.
async function drawCoverPage(ctx, list, featuredRows, storage, imageCache) {
  const grad = ctx.createLinearGradient(0, 0, PAGE_W, PAGE_H);
  grad.addColorStop(0, "#0b3d78");
  grad.addColorStop(1, "#123f8c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // Subtle diagonal accent stripes (original decorative motif, not a copy
  // of the reference photo).
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 40;
  for (let x = -PAGE_H; x < PAGE_W + PAGE_H; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, PAGE_H);
    ctx.lineTo(x + PAGE_H, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = "18px Poppins SemiBold";
  ctx.textAlign = "right";
  ctx.fillText("NORMFEST®", PAGE_W - MARGIN, 60);

  ctx.textAlign = "left";
  ctx.font = "italic 84px Poppins Bold Italic";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("FOKUS", MARGIN, 200);
  ctx.fillStyle = RED;
  ctx.fillRect(MARGIN, 216, 220, 4);

  ctx.font = "10px Poppins SemiBold";
  ctx.fillStyle = "#cfe0ff";
  ctx.fillText("F A I R  ·  O N L I N E  ·  K U N D E N O R I E N T I E R T  ·  U N S C H L A G B A R", MARGIN, 244);

  // Validity badge
  if (list.validityLabel) {
    const badgeY = 290;
    ctx.font = "13px Poppins SemiBold";
    const w = ctx.measureText(list.validityLabel).width + 40;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.roundRect(MARGIN, badgeY, w, 34, 6);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(list.validityLabel, MARGIN + 20, badgeY + 22);
  }

  ctx.font = "28px Poppins Bold";
  ctx.fillStyle = "#ffffff";
  const nameLines = wrapText(ctx, list.name, PAGE_W - MARGIN * 2);
  let ny = 380;
  for (const line of nameLines) {
    ctx.fillText(line, MARGIN, ny);
    ny += 34;
  }

  if (list.note) {
    ctx.font = "11px Poppins";
    ctx.fillStyle = "#dbe6fb";
    const noteLines = wrapText(ctx, list.note, PAGE_W - MARGIN * 2);
    for (const line of noteLines.slice(0, 4)) {
      ny += 18;
      ctx.fillText(line, MARGIN, ny);
    }
  }

  // "Im Fokus" showcase strip - up to 3 real products with real photos.
  if (featuredRows.length > 0) {
    const stripY = PAGE_H - 232;
    ctx.font = "10px Poppins SemiBold";
    ctx.fillStyle = "#cfe0ff";
    ctx.textAlign = "left";
    ctx.fillText("I M   F O K U S", MARGIN, stripY - 12);

    const gap = 14;
    const cardW = (PAGE_W - MARGIN * 2 - gap * 2) / 3;
    const cardH = 160;
    const imgSize = 76;

    for (let i = 0; i < Math.min(3, featuredRows.length); i++) {
      const row = featuredRows[i];
      const p = row.products;
      const cx = MARGIN + i * (cardW + gap);

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(cx, stripY, cardW, cardH, 8);
      ctx.fill();

      if (p.image_path) {
        const img = await getFlyerImage(p.image_path, storage, imageCache);
        if (img) {
          const scale = Math.min(imgSize / img.width, imgSize / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, cx + (cardW - dw) / 2, stripY + 10 + (imgSize - dh) / 2, dw, dh);
        }
      }

      ctx.textAlign = "center";
      ctx.fillStyle = NAVY;
      ctx.font = "8.5px Poppins Bold";
      const nameLines = wrapText(ctx, p.name, cardW - 14).slice(0, 2);
      let ny2 = stripY + imgSize + 24;
      for (const line of nameLines) {
        ctx.fillText(line, cx + cardW / 2, ny2);
        ny2 += 11;
      }

      const price = extractPrice(row.note);
      if (price) {
        ctx.fillStyle = RED;
        ctx.font = "italic 15px Poppins Bold Italic";
        ctx.fillText(price + " €", cx + cardW / 2, stripY + cardH - 14);
      }
      ctx.textAlign = "left";
    }
  }

  ctx.font = "10px Poppins";
  ctx.fillStyle = "#9fb6e0";
  ctx.textAlign = "center";
  ctx.fillText(
    `${list.productCount} Aktionsprodukte in ${list.categoryCount} ${list.categoryCount === 1 ? "Kategorie" : "Kategorien"}`,
    PAGE_W / 2,
    PAGE_H - 34,
  );
  ctx.textAlign = "left";
}

const COLS = 3;
const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
const ROW_H = 200;
const TOP_HEADER_H = 56;
const CONTENT_TOP_AFTER_HEADER = TOP_HEADER_H + 24;
const CONTENT_BOTTOM = PAGE_H - 60;
const DIVIDER_H = 30;

function drawTopCategoryHeader(ctx, name, color, continued) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, PAGE_W, TOP_HEADER_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "20px Poppins Bold";
  ctx.fillText(name.toUpperCase() + (continued ? " (Fortsetzung)" : ""), MARGIN, 36);
}

// Mid-page transition between categories (room permitting) - a slimmer
// inline divider rather than a full-bleed bar, since we're not at the top
// of the page.
function drawInlineCategoryDivider(ctx, y, name, color) {
  ctx.fillStyle = color;
  ctx.fillRect(MARGIN, y, 5, 18);
  ctx.fillStyle = NAVY;
  ctx.font = "13px Poppins Bold";
  ctx.fillText(name.toUpperCase(), MARGIN + 12, y + 14);
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

async function drawProductCell(ctx, x, y, row, imageCache, storage) {
  const p = row.products;
  if (!p) return;

  // Photo
  const imgSize = 100;
  const imgX = x + (CELL_W - imgSize) / 2;
  const imgY = y;
  if (p.image_path) {
    const img = await getFlyerImage(p.image_path, storage, imageCache);
    if (img) {
      const scale = Math.min(imgSize / img.width, imgSize / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, imgX + (imgSize - dw) / 2, imgY + (imgSize - dh) / 2, dw, dh);
    }
  }

  let cy = y + imgSize + 16;
  ctx.textAlign = "left";
  ctx.fillStyle = NAVY;
  ctx.font = "10.5px Poppins Bold";
  const nameLines = wrapText(ctx, p.name, CELL_W - 12).slice(0, 2);
  for (const line of nameLines) {
    ctx.fillText(line, x + 6, cy);
    cy += 13;
  }

  ctx.fillStyle = "#7a8494";
  ctx.font = "8px Poppins";
  ctx.fillText(`Art.-Nr. ${p.sku}`, x + 6, cy + 2);
  cy += 15;

  const price = extractPrice(row.note);
  if (price) {
    ctx.fillStyle = RED;
    ctx.font = "italic 22px Poppins Bold Italic";
    ctx.fillText(price + " €", x + 6, cy + 18);
    cy += 24;
  }

  if (row.note) {
    ctx.fillStyle = "#4a5364";
    ctx.font = "7.5px Poppins";
    const noteLines = wrapText(ctx, row.note, CELL_W - 12).slice(0, 2);
    for (const line of noteLines) {
      cy += 10;
      ctx.fillText(line, x + 6, cy);
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

  function startPage(categoryLabel, color, continued) {
    ctx = doc.beginPage(PAGE_W, PAGE_H);
    ctx.fillStyle = LIGHT_BG;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    drawTopCategoryHeader(ctx, categoryLabel, color, continued);
    cursorY = CONTENT_TOP_AFTER_HEADER;
  }
  function finishPage() {
    drawFooter(ctx);
    doc.endPage();
  }

  for (let ci = 0; ci < categories.length; ci++) {
    const category = categories[ci];
    const color = CATEGORY_COLORS[ci % CATEGORY_COLORS.length];
    const categoryRows = byCategory.get(category);

    if (ctx === null) {
      startPage(category, color, false);
    } else if (cursorY + ROW_H > CONTENT_BOTTOM) {
      finishPage();
      startPage(category, color, false);
    } else {
      drawInlineCategoryDivider(ctx, cursorY, category, color);
      cursorY += DIVIDER_H;
    }

    let col = 0;
    for (let i = 0; i < categoryRows.length; i++) {
      if (col === 0 && cursorY + ROW_H > CONTENT_BOTTOM) {
        finishPage();
        startPage(category, color, true);
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

  if (ctx) finishPage();

  return doc.close();
}
