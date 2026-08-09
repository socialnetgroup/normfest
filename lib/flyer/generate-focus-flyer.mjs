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
//
// Redesigned 2026-08-09 (4th pass), Anis's punch-list on the 3rd-pass output:
// logo aspect ratio was actually broken (drawImage width/height didn't share
// the source ratio) - fixed and enlarged; the cover's dark text panel got a
// subtle texture (radial glow + fine hairlines) instead of a flat fill; the
// closing CTA banner was redrawn full-bleed with more room instead of
// looking glued to the product grid; real product descriptions
// (products.description, rendered as short bullets) are now shown when a
// category's products mostly have one; and the grid is no longer one fixed
// 3-column layout everywhere - a category with descriptions gets a wider
// 2-column "detailed" card, one without gets the denser 3-column "compact"
// card, and each row's height is measured from its own real content
// (dynamic, not a fixed constant) so a page naturally fits more or fewer
// products depending on how much real text each one has.
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

function parsePriceDe(priceStr) {
  return Number.parseFloat(priceStr.replace(/\./g, "").replace(",", "."));
}

// Real product descriptions are stored as "- bullet - bullet - bullet" text
// (scripts/generate-product-descriptions.mjs). Split back into individual
// bullets rather than wrapping the whole thing as one paragraph, so the
// flyer card reads the same way the source content was written.
function parseBullets(desc) {
  if (!desc) return [];
  return desc
    .split(/\s*-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
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

// Fits a comma-joined item list into maxLines, never cutting an item
// mid-word - real bug found 2026-08-09 rendering scent-family SKU/scent
// lists (a plain wrapText() truncation left a dangling "..., 2000-309-410,"
// with no indication more items existed). Drops trailing items and appends
// "+N weitere" until the whole thing fits, so it's always either the
// complete real list or an honestly-labeled partial one.
function fitItemList(ctx, items, prefix, maxWidth, maxLines) {
  for (let n = items.length; n >= 0; n--) {
    const suffix = n < items.length ? ` +${items.length - n} weitere` : "";
    const lines = wrapText(ctx, prefix + items.slice(0, n).join(", ") + suffix, maxWidth);
    if (lines.length <= maxLines) return lines;
  }
  return [prefix + "..."];
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

const BANNER_H = 64;

// Closing CTA banner - redrawn (2026-08-09, 4th pass) full-bleed edge to
// edge instead of a MARGIN-indented box, so it reads as part of the page
// structure (same treatment as the category header bars) rather than a
// leftover strip glued between the product grid and the footer. Anis: "the
// alles online bestellen banner at the end looks out of place, reanrange
// it, resize it, make it fit good."
function drawOnlineOrderBanner(ctx, y) {
  ctx.fillStyle = DARK_BAR;
  ctx.fillRect(0, y, PAGE_W, BANNER_H);
  ctx.fillStyle = BLUE_BADGE;
  ctx.fillRect(0, y, 5, BANNER_H); // left accent bar, echoes the category badge color

  const iconX = MARGIN + 22;
  const iconY = y + BANNER_H / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(iconX - 11, iconY - 10);
  ctx.lineTo(iconX - 6, iconY - 10);
  ctx.lineTo(iconX - 1, iconY + 5);
  ctx.lineTo(iconX + 14, iconY + 5);
  ctx.lineTo(iconX + 17, iconY - 7);
  ctx.lineTo(iconX - 5, iconY - 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(iconX - 1, iconY + 9, 2, 0, Math.PI * 2);
  ctx.arc(iconX + 12, iconY + 9, 2, 0, Math.PI * 2);
  ctx.fill();

  const textX = MARGIN + 46;
  ctx.textAlign = "left";
  ctx.fillStyle = "#9db3e0";
  ctx.font = "9px Poppins SemiBold";
  ctx.fillText("ALLES ONLINE BESTELLEN", textX, iconY - 4);
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Poppins Bold";
  ctx.fillText(NORMFEST_ADDRESS.web, textX, iconY + 16);
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

  // Subtle texture on the dark text panel (2026-08-09, 4th pass), Anis:
  // "the plain blue sidebar looks kinda booring and unfinished, do
  // something like a texture translucent, just to give it some other
  // feel." A soft off-center glow plus very faint diagonal hairlines -
  // enough to read as a deliberate surface, not competing with the text
  // on top of it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, photoX, PAGE_H);
  ctx.clip();
  const glow = ctx.createRadialGradient(photoX * 0.25, PAGE_H * 0.22, 0, photoX * 0.25, PAGE_H * 0.22, photoX * 1.3);
  glow.addColorStop(0, "rgba(31,95,217,0.18)");
  glow.addColorStop(1, "rgba(31,95,217,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, photoX, PAGE_H);
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let lx = -PAGE_H; lx < photoX + PAGE_H; lx += 20) {
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx + PAGE_H, PAGE_H);
    ctx.stroke();
  }
  ctx.restore();

  const bottomFade = ctx.createLinearGradient(0, PAGE_H - 220, 0, PAGE_H);
  bottomFade.addColorStop(0, "rgba(10,13,20,0)");
  bottomFade.addColorStop(1, "rgba(10,13,20,0.85)");
  ctx.fillStyle = bottomFade;
  ctx.fillRect(0, PAGE_H - 220, PAGE_W, 220);

  const textPanelW = photoX - MARGIN - 20;

  // Real Normfest logo (never AI-drawn) on a white card. 2026-08-09 (4th
  // pass) real bug fix: drawImage's width/height were computed from
  // different base dimensions (cardH*aspect for width, but cardH-8 for
  // height), so the logo was rendered visibly stretched - fixed by deriving
  // both from the same inner box so the source aspect ratio is exact. Also
  // enlarged per Anis's "needs to be bigger."
  try {
    const logo = await loadImage(readFileSync(LOGO_PATH));
    const pad = 10;
    const innerH = 58;
    const innerW = innerH * (logo.width / logo.height);
    const cardW = innerW + pad * 2;
    const cardH = innerH + pad * 2;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(MARGIN, 20, cardW, cardH, 8);
    ctx.fill();
    ctx.drawImage(logo, MARGIN + pad, 20 + pad, innerW, innerH);
  } catch {
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px Poppins SemiBold";
    ctx.fillText("NORMFEST®", MARGIN, 48);
  }

  ctx.textAlign = "left";
  ctx.font = "42px Poppins Bold";
  const titleLines = wrapText(ctx, list.name.toUpperCase(), textPanelW);
  ctx.fillStyle = "#ffffff";
  let ty = 250;
  for (const line of titleLines.slice(0, 3)) {
    ctx.fillText(line, MARGIN, ty);
    ty += 46;
  }

  // Tagline moved up under the heading + given real prominence (2026-08-09,
  // Anis: "move it up under the heading and give it kinda more highlight" -
  // was a single small muted line pinned to the page bottom). Now a real
  // acrostic: FAIR / ONLINE / KUNDENORIENTIERT / UNSCHLAGBAR / SYMPATHISCH -
  // first letters spell F-O-K-U-S (Anis's own catch), each highlighted in
  // bold bright white against the rest of the word so the acrostic actually
  // reads, not just a coincidence buried in small gray text.
  ty += 18;
  ty = drawFokusTagline(ctx, MARGIN, ty, textPanelW);

  // Validity badge - real bug fixed (2026-08-09), Anis: "Gültig vom 01.08
  // is out of boundaries" - the previous fixed 14px font, sized up to match
  // the rest of the bigger cover text, was simply too wide for the real
  // label ("Gültig vom 01.08. bis 31.08.2026") to fit inside textPanelW at
  // all: the box width was capped via Math.min(), but the TEXT itself was
  // never capped/shrunk, so it kept rendering at its full un-clipped width
  // and visibly spilled past the badge (and past the whole text panel).
  // Fixed properly instead of just picking a smaller fixed size: the font
  // now shrinks (14px down to 9px) until the real label actually fits
  // within the available width, so this can't recur for a differently-
  // worded validity string in a future list either.
  if (list.validityLabel) {
    const badgeY = ty + 18;
    const badgePadX = 16;
    const maxTextWidth = textPanelW - badgePadX * 2;
    let badgeFont = 14;
    ctx.font = `${badgeFont}px Poppins SemiBold`;
    while (badgeFont > 9 && ctx.measureText(list.validityLabel).width > maxTextWidth) {
      badgeFont -= 0.5;
      ctx.font = `${badgeFont}px Poppins SemiBold`;
    }
    const w = Math.min(ctx.measureText(list.validityLabel).width + badgePadX * 2, textPanelW);
    ctx.fillStyle = BLUE_BADGE;
    ctx.beginPath();
    ctx.roundRect(MARGIN, badgeY, w, 34, 17);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(list.validityLabel, MARGIN + badgePadX, badgeY + 22);
    ty = badgeY + 34;
  }

  // Stat row - icon + separated pill cards, stacked vertically (2026-08-09,
  // Anis: "the tiles are too small here too... you have more room, place
  // them one underneath the other" - side-by-side halved the available
  // width for no reason; stacking lets each pill use the full text-panel
  // width and be genuinely bigger). Counts stay real/dynamic
  // (list.productCount/categoryCount computed from the list's actual rows
  // at generation time, see generateFocusListFlyer) - only the presentation
  // changed here. Gap bumped 26→36 (2026-08-09, Anis: "shift the 64 and 8
  // a bit down") for more breathing room under the validity badge.
  const statY = ty + 36;
  const pillH = 48;
  const pillGap = 10;
  drawStatPill(ctx, MARGIN, statY, textPanelW, pillH, drawTagIcon, String(list.productCount), "AKTIONSPRODUKTE");
  drawStatPill(
    ctx,
    MARGIN,
    statY + pillH + pillGap,
    textPanelW,
    pillH,
    drawGridIcon,
    String(list.categoryCount),
    list.categoryCount === 1 ? "KATEGORIE" : "KATEGORIEN",
  );
}

const FOKUS_WORDS = [
  { letter: "F", rest: "AIR" },
  { letter: "O", rest: "NLINE" },
  { letter: "K", rest: "UNDENORIENTIERT" },
  { letter: "U", rest: "NSCHLAGBAR" },
  { letter: "S", rest: "YMPATHISCH" },
];

function drawFokusTagline(ctx, x, y, maxWidth) {
  const lineH = 16;
  const blockH = FOKUS_WORDS.length * lineH;
  ctx.fillStyle = BLUE_BADGE;
  ctx.fillRect(x, y - 12, 3, blockH);
  const textX = x + 12;
  let ly = y;
  for (const { letter, rest } of FOKUS_WORDS) {
    ctx.textAlign = "left";
    ctx.font = "13px Poppins Bold";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(letter, textX, ly);
    const letterW = ctx.measureText(letter).width;
    ctx.font = "10.5px Poppins SemiBold";
    ctx.fillStyle = "#a9bce0";
    const [restLine] = wrapText(ctx, rest, Math.max(maxWidth - letterW - 12, 40));
    ctx.fillText(restLine, textX + letterW + 2, ly);
    ly += lineH;
  }
  return y + blockH;
}

function drawTagIcon(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-8, -2);
  ctx.lineTo(-1, -9);
  ctx.lineTo(8, -9);
  ctx.lineTo(8, 0);
  ctx.lineTo(0, 8);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(3, -5, 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawGridIcon(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ffffff";
  const s = 6;
  const gap = 2.5;
  ctx.beginPath();
  ctx.roundRect(-s - gap / 2, -s - gap / 2, s, s, 1.5);
  ctx.roundRect(gap / 2, -s - gap / 2, s, s, 1.5);
  ctx.roundRect(-s - gap / 2, gap / 2, s, s, 1.5);
  ctx.roundRect(gap / 2, gap / 2, s, s, 1.5);
  ctx.fill();
  ctx.restore();
}

function drawStatPill(ctx, x, y, w, h, iconFn, value, label) {
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  iconFn(ctx, x + 24, y + h / 2);

  const textX = x + 44;
  ctx.textAlign = "left";
  ctx.font = "23px Poppins Bold";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(value, textX, y + h / 2 - 2);
  ctx.font = "9px Poppins SemiBold";
  ctx.fillStyle = "#cfd8e8";
  ctx.fillText(label, textX, y + h / 2 + 15);
}

const COMPACT_COLS = 3;
const DETAIL_COLS = 2;
const COMPACT_IMG_BOX = 56;
const DETAIL_IMG_BOX = 84;
const CELL_GAP = 6;
const TOP_HEADER_H = 58;
const CONTENT_TOP_AFTER_HEADER = TOP_HEADER_H + 18;
const CONTENT_BOTTOM = PAGE_H - 60;
const DIVIDER_H = 32;
const BANNER_RESERVE = BANNER_H + 30; // room reserved on the last category's last row

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

// Threshold-based background removal for the grouped "staged photo"
// compositing only (2026-08-09, Anis: "background is pure white, should be
// super easy and precise... move it closer so it looks more staged").
// Deterministic pixel classification, not AI - no real product pixel is
// ever altered, only near-white background pixels become transparent, with
// a soft feather band so the cutout edge doesn't look jagged. Single-
// product tiles keep the plain white-background photo untouched (expected
// there, matches a normal catalog tile); this only feeds drawImageGroup's
// fanned/overlapping compositing for variant families. Known limitation,
// accepted: a product with white/near-white elements on it (a white cap, a
// bright highlight) can get an unwanted hole - real photos aren't
// guaranteed to be perfectly flat pure-white backgrounds.
const WHITE_CUTOFF = 10; // distance-from-pure-white below this -> fully transparent
const WHITE_FEATHER = 42; // distance-from-pure-white up to this -> feathered alpha ramp

function removeWhiteBackground(img) {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.max(255 - d[i], 255 - d[i + 1], 255 - d[i + 2]); // 0 = pure white
    if (dist <= WHITE_CUTOFF) {
      d[i + 3] = 0;
    } else if (dist < WHITE_FEATHER) {
      d[i + 3] = Math.round(d[i + 3] * ((dist - WHITE_CUTOFF) / (WHITE_FEATHER - WHITE_CUTOFF)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function getGroupCutoutImage(imagePath, storage, imageCache, cutoutCache) {
  if (cutoutCache.has(imagePath)) return cutoutCache.get(imagePath);
  const base = await getFlyerImage(imagePath, storage, imageCache);
  if (!base) {
    cutoutCache.set(imagePath, null);
    return null;
  }
  const cutout = removeWhiteBackground(base);
  cutoutCache.set(imagePath, cutout);
  return cutout;
}

// Groups consecutive focus-list rows within a category that share the exact
// same real catalog photo (2026-08-09, Anis: "when there is kinda same
// product with variations like the Schleifpapier, don't do 10 times same
// picture, do it over the description x1 product"). Confirmed against real
// data before building this: e.g. "Klett-Scheiben Normfest" has 7 rows (one
// per Art.-Nr. variant) all pointing at the identical image_path, same for
// several glove/Kupplungskopf families - same image_path is a real, exact
// signal (not a fuzzy name guess) that these are the same physical product
// in different sizes/variants, not different products. Grouped rows become
// ONE card (one photo) with each variant listed as its own compact price
// line, instead of N nearly-identical cards repeating the same photo.
function groupByImage(categoryRows) {
  const cells = [];
  const byImage = new Map();
  for (const row of categoryRows) {
    const key = row.products.image_path;
    if (!key) {
      cells.push([row]);
      continue;
    }
    const existing = byImage.get(key);
    if (existing) {
      existing.push(row);
    } else {
      const cell = [row];
      byImage.set(key, cell);
      cells.push(cell);
    }
  }
  return cells;
}

// Groups remaining single-product cells into a "variant family" when a note
// explicitly marks them as a scent/flavor choice (2026-08-09, Anis: "5 same
// products (for example air freshener)... could be done with one sentence
// available in scent 1, 2, 3..."). These products have DIFFERENT photos
// (each scent has its own can color), so groupByImage above can't catch
// them - name-similarity alone was tested against the real catalog and
// found genuinely unsafe here (a completely different grease product line,
// "Hochdruck-Haftschmierfett Black/Protect/Ultra", scores a HIGHER word-
// overlap than some real scent-variant pairs, since both are "shared base
// phrase + one differentiator word"). Requires TWO independent real signals
// to agree instead: the same 8-char Art.-Nr. family prefix (Normfest's own
// numbering scheme, not a guess) AND an explicit "(Duft N: Scent)" marker
// in the note (the source data's own statement "this is a scent choice",
// not inferred). Verified against the real active list: this combination
// correctly groups the 7 real "...Geruchsvernichter und Lufterfrischer
// Aerofit..." rows and correctly leaves the grease line ungrouped (none of
// those notes carry a "Duft" marker).
function extractScentLabel(note) {
  const m = note?.match(/\(Duft[^:]*:\s*([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

function groupByScentVariant(cells) {
  const result = [];
  const bySkuPrefix = new Map();
  for (const cell of cells) {
    if (cell.length !== 1) {
      result.push(cell);
      continue;
    }
    const row = cell[0];
    const sku = row.products.sku;
    if (!extractScentLabel(row.note) || !sku || sku.length < 8) {
      result.push(cell);
      continue;
    }
    const prefix = sku.slice(0, 8);
    const existing = bySkuPrefix.get(prefix);
    if (existing) {
      existing.push(row);
    } else {
      const newCell = [row];
      bySkuPrefix.set(prefix, newCell);
      result.push(newCell);
    }
  }
  return result;
}

// Real, shared "base name" for a variant family - every word from the first
// member's name that also appears (case/ligature-normalized) in every other
// member's name, in the first member's own word order. For the real
// Aerofit family this correctly yields "Geruchsvernichter und
// Lufterfrischer Aerofit" - a real substring of every member's actual name,
// never an invented summary.
function sharedBaseName(names) {
  function normWord(w) {
    return w
      .toLowerCase()
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/[^a-z0-9äöüß]/g, "");
  }
  const otherWordSets = names.slice(1).map((n) => new Set(n.split(/\s+/).map(normWord)));
  const firstWords = names[0].split(/\s+/);
  const shared = firstWords.filter((w) => {
    const nw = normWord(w);
    return nw.length > 1 && otherWordSets.every((s) => s.has(nw));
  });
  return shared.length > 0 ? shared.join(" ") : names[0];
}

// Fans up to 5 real photos out within a box - used for every variant family
// (whether the photos are literally identical, e.g. glove sizes, or
// genuinely different, e.g. scent colors) so a grouped card reads as a
// staged product group instead of one flat photo. Anis: "3D style, 5 same
// products... to stand out" / "break the same boring look from begin to
// end." 100% real, unaltered product PIXELS - only their on-page
// arrangement is synthetic (rotation/offset/shadow), plus (2026-08-09) a
// deterministic white-background cutout (see removeWhiteBackground) so the
// images can sit closer together without visible white-box seams - offset
// tightened from 0.4x to 0.27x now that overlap no longer collides two
// opaque rectangles, per Anis: "move it closer so it looks more staged."
function drawImageGroup(ctx, images, boxX, boxY, boxW, boxH) {
  const list = images.filter(Boolean).slice(0, 5);
  if (list.length === 0) return;
  if (list.length === 1) {
    const img = list[0];
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
    return;
  }
  const n = list.length;
  const baseSize = Math.min(boxW / (n * 0.46), boxH * 0.92);
  const centerIdx = (n - 1) / 2;
  const order = [...Array(n).keys()].sort((a, b) => Math.abs(b - centerIdx) - Math.abs(a - centerIdx));
  for (const i of order) {
    const img = list[i];
    const offset = i - centerIdx;
    const scale = 1 - Math.abs(offset) * 0.08;
    const size = baseSize * scale;
    const imgScale = Math.min(size / img.width, size / img.height);
    const dw = img.width * imgScale;
    const dh = img.height * imgScale;
    const cx = boxX + boxW / 2 + offset * baseSize * 0.27;
    const cy = boxY + boxH / 2 + Math.abs(offset) * baseSize * 0.04;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(offset * 0.1);
    ctx.shadowColor = "rgba(20,24,32,0.28)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}

const MAX_VARIANT_LINES = 6;

// Product card (2026-08-09, 4th/5th pass) - image LEFT / text stacked
// RIGHT. One function draws AND measures: called with measureOnly=true it
// runs the exact same font-setting/wrapText/increment logic used for real
// drawing but skips every paint call, so the returned content height can
// never drift from what actually gets drawn. `cellRows` is one product
// (length 1), a same-photo variant family (length > 1, see groupByImage),
// or a scent/flavor family with different photos (length > 1, see
// groupByScentVariant) - both family kinds get a fanned multi-photo group
// image (drawImageGroup) instead of one flat photo.
async function drawProductCard(
  ctx,
  x,
  y,
  cellW,
  cardH,
  cellRows,
  imgBox,
  hasDesc,
  imageCache,
  cutoutCache,
  storage,
  measureOnly,
) {
  const primary = cellRows[0].products;
  if (!primary) return 0;
  const isVariantFamily = cellRows.length > 1;
  const imagePaths = cellRows.map((r) => r.products.image_path).filter(Boolean);
  const isScentFamily = isVariantFamily && new Set(imagePaths).size > 1;

  if (!measureOnly) {
    ctx.fillStyle = CARD_BG;
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cardH, 4);
    ctx.fill();
    ctx.stroke();
  }

  const imgW = isVariantFamily ? imgBox * 1.6 : imgBox;
  const imgX = x + 8;
  const imgY = y + (cardH - imgBox) / 2;
  if (!measureOnly) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(imgX, imgY, imgW, imgBox);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(imgX, imgY, imgW, imgBox);
    ctx.restore();
    const images = [];
    for (const p of imagePaths.slice(0, 5)) {
      images.push(
        isVariantFamily
          ? await getGroupCutoutImage(p, storage, imageCache, cutoutCache)
          : await getFlyerImage(p, storage, imageCache),
      );
    }
    drawImageGroup(ctx, images, imgX, imgY, imgW, imgBox);
  }

  const textX = imgX + imgW + 8;
  const textW = x + cellW - textX - 6;
  let cy = y + 13;

  ctx.textAlign = "left";
  ctx.font = "8.5px Poppins Bold";
  const displayName = isScentFamily ? sharedBaseName(cellRows.map((r) => r.products.name)) : primary.name;
  const nameLines = wrapText(ctx, displayName, textW).slice(0, hasDesc ? 3 : 2);
  if (!measureOnly) ctx.fillStyle = "#171b22";
  for (const line of nameLines) {
    if (!measureOnly) ctx.fillText(line, textX, cy);
    cy += 10;
  }

  if (isScentFamily) {
    // One sentence listing the real scent choices instead of repeating a
    // near-identical card per scent (2026-08-09, Anis: "mainly just
    // difference in smell, this could be done with one sentence available
    // in scent 1, 2, 3, 4, 5"), plus a compact price range and the real
    // Art.-Nr. list underneath so it stays orderable.
    const prices = cellRows.map((r) => extractPrice(r.note)).filter(Boolean);
    const minPrice = prices.length ? prices.reduce((a, b) => (parsePriceDe(a) <= parsePriceDe(b) ? a : b)) : null;
    const uniformPrice = prices.length > 0 && prices.every((p) => p === prices[0]);
    cy += 4;
    if (minPrice) {
      ctx.font = "15px Poppins Bold";
      if (!measureOnly) {
        ctx.fillStyle = RED;
        ctx.fillText(`${uniformPrice ? "" : "ab "}${minPrice} €`, textX, cy + 10);
      }
      cy += 15;
    }

    const scents = cellRows.map((r) => extractScentLabel(r.note)).filter(Boolean);
    ctx.font = "6.5px Poppins";
    const scentLines = fitItemList(ctx, scents, "Erhältlich in: ", textW, 2);
    if (!measureOnly) ctx.fillStyle = "#3c4452";
    for (const line of scentLines) {
      cy += 9;
      if (!measureOnly) ctx.fillText(line, textX, cy);
    }

    const skus = cellRows.map((r) => r.products.sku);
    ctx.font = "6px Poppins";
    const skuLines = fitItemList(ctx, skus, "Art.-Nr. ", textW, 1);
    for (const line of skuLines) {
      cy += 8;
      if (!measureOnly) {
        ctx.fillStyle = "#9aa3b0";
        ctx.fillText(line, textX, cy);
      }
    }
  } else if (isVariantFamily) {
    // Compact per-variant price lines instead of one Art.-Nr./price/note
    // block - each real SKU still gets its own line so it stays orderable.
    const shown = cellRows.slice(0, MAX_VARIANT_LINES);
    cy += 5;
    ctx.font = "6.5px Poppins Bold";
    for (const row of shown) {
      const price = extractPrice(row.note);
      const label = price ? `${price} €` : "";
      const rest = row.note ? row.note.replace(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€\s*/, "") : "";
      cy += 9;
      if (!measureOnly) {
        ctx.fillStyle = RED;
        ctx.fillText(label, textX, cy);
        const labelW = label ? ctx.measureText(label).width + 5 : 0;
        ctx.font = "6.5px Poppins";
        ctx.fillStyle = "#6b7684";
        const [line] = wrapText(ctx, `${row.products.sku} · ${rest}`, textW - labelW);
        if (line) ctx.fillText(line, textX + labelW, cy);
        ctx.font = "6.5px Poppins Bold";
      }
    }
    if (cellRows.length > MAX_VARIANT_LINES) {
      cy += 9;
      if (!measureOnly) {
        ctx.font = "6.5px Poppins";
        ctx.fillStyle = "#9aa3b0";
        ctx.fillText(`+ ${cellRows.length - MAX_VARIANT_LINES} weitere Varianten`, textX, cy);
      }
    }
  } else {
    const row = cellRows[0];
    ctx.font = "6.5px Poppins";
    if (!measureOnly) {
      ctx.fillStyle = "#7a8494";
      ctx.fillText(`Art.-Nr. ${primary.sku}`, textX, cy + 4);
    }
    cy += 15;

    const price = extractPrice(row.note);
    if (price) {
      ctx.font = hasDesc ? "17px Poppins Bold" : "15px Poppins Bold";
      if (!measureOnly) {
        ctx.fillStyle = RED;
        ctx.fillText(price + " €", textX, cy + 10);
      }
      cy += 17;
    }

    if (row.note) {
      ctx.font = "6.5px Poppins";
      const noteLines = wrapText(ctx, row.note, textW).slice(0, 2);
      if (!measureOnly) ctx.fillStyle = "#6b7684";
      for (const line of noteLines) {
        cy += 8;
        if (!measureOnly) ctx.fillText(line, textX, cy);
      }
    }
  }

  // Real product description (2026-08-09, 4th pass), Anis: "in the original
  // flyer are produkt descriptions as well, add those." Only shown when the
  // category earns the wider "detailed" card (see hasDesc in the caller) -
  // rendered as short real bullets (source text is already bullet-formatted
  // by scripts/generate-product-descriptions.mjs), not a dense paragraph.
  // For a variant family, all rows share the same real product under
  // different SKUs, so the first row's description applies to all of them.
  if (hasDesc && primary.description) {
    const bullets = parseBullets(primary.description).slice(0, 3);
    ctx.font = "6.5px Poppins";
    if (!measureOnly) ctx.fillStyle = "#3c4452";
    let drawn = 0;
    for (const b of bullets) {
      if (drawn >= 3) break;
      const [firstLine] = wrapText(ctx, b, textW - 7);
      if (!firstLine) continue;
      cy += 9;
      if (!measureOnly) {
        ctx.fillText("•", textX, cy);
        ctx.fillText(firstLine, textX + 7, cy);
      }
      drawn++;
    }
  }

  return cy - y + 10;
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
    .select("id, note, products(name, sku, category_name, image_path, description)")
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
  const cutoutCache = new Map();

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
      drawOnlineOrderBanner(ctx, PAGE_H - 66 - BANNER_H);
    }
    drawFooter(ctx);
    doc.endPage();
  }

  for (let ci = 0; ci < categories.length; ci++) {
    const category = categories[ci];
    const number = String(ci + 1).padStart(2, "0");
    const categoryRows = byCategory.get(category);
    const isLastCategory = ci === categories.length - 1;

    // Same-photo variants (e.g. size/pack-size families like Klett-Scheiben
    // or glove sizes) collapse into one cell each - see groupByImage above.
    // Remaining singles get a second pass for scent/flavor families whose
    // photos genuinely differ (see groupByScentVariant above).
    const cells = groupByScentVariant(groupByImage(categoryRows));

    // Grid shape (2026-08-09, 4th pass), Anis: "the grid will have to be
    // different, change it up a bit, merge it logicaly, on some page 10, on
    // the other 4 products can happen." Not an arbitrary toggle - a
    // category where most real products have a description earns the
    // wider 2-column "detailed" card (fewer, richer cards per page); one
    // without descriptions stays on the denser 3-column "compact" card
    // (more cards per page) - the variation comes from what real content
    // each category actually has, not a coin flip.
    const withDesc = cells.filter((cell) => cell[0].products.description).length;
    const hasDesc = withDesc / cells.length >= 0.5;
    const cols = hasDesc ? DETAIL_COLS : COMPACT_COLS;
    const imgBox = hasDesc ? DETAIL_IMG_BOX : COMPACT_IMG_BOX;
    // A family cell renders bigger than a normal single-product cell, but
    // (2026-08-09, Anis: "the group photo might have caused other products
    // to move place so its kinda not well gridded... just keep the grid...
    // merge some 2 tiles/products in 1 tile for those group photos") it now
    // merges 2 grid COLUMNS into one wider cell instead of jumping to full
    // page width - the surrounding single-product cells keep their normal
    // column positions/widths, so the grid stays visually aligned instead
    // of reflowing around a full-bleed intruder row.
    const familyImgBox = Math.round(imgBox * 1.4);
    const familySpan = Math.min(2, cols);
    // Conservative pre-check only (decides whether the category header needs
    // a fresh page) - accounts for the first row possibly starting with a
    // family cell, which is taller than a normal grid row.
    const firstRowMinH = (cells[0]?.length > 1 ? familyImgBox : imgBox) + 16;

    if (ctx === null) {
      startPage(category, number, false);
    } else if (cursorY + firstRowMinH > CONTENT_BOTTOM) {
      finishPage(false);
      startPage(category, number, false);
    } else {
      drawInlineCategoryDivider(ctx, cursorY, category, number);
      cursorY += DIVIDER_H;
    }

    // Column-span row packing: a single-product cell always takes 1 column,
    // a family cell takes up to 2 - cells pack left-to-right into a row
    // until the next cell wouldn't fit, then wrap. When every cell in a
    // category is a single product this reduces to exactly the old N-per-row
    // grid (span always 1), so plain categories are visually unchanged.
    let i = 0;
    while (i < cells.length) {
      const rowItems = [];
      const rowSpans = [];
      let colsUsed = 0;
      while (i < cells.length) {
        const span = cells[i].length > 1 ? familySpan : 1;
        if (colsUsed + span > cols) break;
        rowItems.push(cells[i]);
        rowSpans.push(span);
        colsUsed += span;
        i += 1;
      }
      const rowImgBoxes = rowSpans.map((span) => (span > 1 ? familyImgBox : imgBox));
      // Stretch every card in the row proportionally to its span so the row
      // always fills the full available width (2026-08-09, Anis: "its ok
      // for family to fill row, but the single products have to adapt. not
      // 1 product in line" - a lone single stranded before a family that
      // didn't fit was rendering at its normal narrow width with a visible
      // empty gap next to it). When the row is already fully packed
      // (colsUsed === cols, the common case) this unit width equals the
      // normal cellW and nothing changes; it only grows when a row has
      // leftover columns, spreading that leftover across the row's own
      // cards instead of leaving it as dead space.
      const totalSpanUsed = rowSpans.reduce((a, b) => a + b, 0);
      const unitW = (PAGE_W - MARGIN * 2 - (rowItems.length - 1) * CELL_GAP) / totalSpanUsed;
      const rowWidths = rowSpans.map((span) => span * unitW);

      // Measure this row's real content first (no painting) so every card
      // in the row shares one honest height instead of a fixed constant.
      let rowH = Math.max(...rowImgBoxes) + 16;
      for (let k = 0; k < rowItems.length; k++) {
        const h = await drawProductCard(
          ctx,
          0,
          0,
          rowWidths[k],
          0,
          rowItems[k],
          rowImgBoxes[k],
          hasDesc,
          imageCache,
          cutoutCache,
          supabase.storage,
          true,
        );
        rowH = Math.max(rowH, h);
      }
      rowH += CELL_GAP;

      const isLastRow = isLastCategory && i >= cells.length;
      const rowLimit = CONTENT_BOTTOM - (isLastRow ? BANNER_RESERVE : 0);
      if (cursorY + rowH > rowLimit) {
        finishPage(false);
        startPage(category, number, true);
      }

      let x = MARGIN;
      for (let k = 0; k < rowItems.length; k++) {
        await drawProductCard(
          ctx,
          x,
          cursorY,
          rowWidths[k],
          rowH,
          rowItems[k],
          rowImgBoxes[k],
          hasDesc,
          imageCache,
          cutoutCache,
          supabase.storage,
          false,
        );
        x += rowWidths[k] + CELL_GAP;
      }
      cursorY += rowH;
    }
  }

  if (ctx) finishPage(true);

  return doc.close();
}
