// Tiles every PNG in scripts/_crop-preview into labeled contact sheets so
// crop quality can be spot-checked visually a few sheets at a time instead
// of one Read call per file.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readdirSync, writeFileSync } from "node:fs";

const DIR = "scripts/_crop-preview";
const OUT_PREFIX = "scripts/_crop-preview/_sheet";
const TILE = 180;
const COLS = 6;
const PER_SHEET = 30;

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".png") && !f.startsWith("_sheet"));
  files.sort();
  for (let sheetIdx = 0; sheetIdx * PER_SHEET < files.length; sheetIdx++) {
    const batch = files.slice(sheetIdx * PER_SHEET, (sheetIdx + 1) * PER_SHEET);
    const rows = Math.ceil(batch.length / COLS);
    const canvas = createCanvas(COLS * TILE, rows * (TILE + 20));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < batch.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * TILE;
      const y = row * (TILE + 20);
      const img = await loadImage(`${DIR}/${batch[i]}`);
      const scale = Math.min((TILE - 8) / img.width, (TILE - 8) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.strokeStyle = "#ccc";
      ctx.strokeRect(x, y, TILE, TILE);
      ctx.drawImage(img, x + (TILE - w) / 2, y + (TILE - h) / 2, w, h);
      ctx.fillStyle = "black";
      ctx.font = "11px sans-serif";
      ctx.fillText(batch[i].replace(".png", ""), x + 3, y + TILE + 14);
    }
    writeFileSync(`${OUT_PREFIX}${sheetIdx + 1}.png`, canvas.toBuffer("image/png"));
    console.log(`${OUT_PREFIX}${sheetIdx + 1}.png (${batch.length} Bilder)`);
  }
}

main();
