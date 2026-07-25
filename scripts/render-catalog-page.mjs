// Renders a single page of the catalog PDF to a PNG file - a small helper
// used by scripts/crop-catalog-images.mjs to get real photo crops for the
// last 84 products that have no photo at all (neither exact/fuzzy webshop
// match nor a same-category "similar product" fallback). No poppler/Python
// available in this environment, so pdfjs-dist + @napi-rs/canvas render the
// page directly in Node.
//
// Usage: node scripts/render-catalog-page.mjs <pageNumber> <outPath> [scale]
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";

const PDF_PATH = "input/gesamtkatalog_2025_26.pdf";

export async function renderPage(pageNumber, scale = 2.5) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer("image/png");
}

async function main() {
  const [, , pageArg, outPath, scaleArg] = process.argv;
  const pageNumber = Number(pageArg);
  const scale = scaleArg ? Number(scaleArg) : 2.5;
  const png = await renderPage(pageNumber, scale);
  writeFileSync(outPath, png);
  console.log(`Seite ${pageNumber} -> ${outPath} (${png.length} bytes)`);
}

if (process.argv[1] && process.argv[1].endsWith("render-catalog-page.mjs")) {
  main();
}
