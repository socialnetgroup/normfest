// Renders every page of an invoice PDF to PNG buffers, for vision-based
// parsing (CLAUDE.md §14, 2026-08-14). Same pdfjs-dist + @napi-rs/canvas
// approach as scripts/render-catalog-page.mjs, generalized to take an
// arbitrary file path (that script is hardcoded to the one catalog PDF) and
// to render every page rather than one - real invoices are commonly 2 pages
// (line items overflow onto a second page, totals live on the last one).
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

export async function renderInvoicePages(pdfPath, scale = 2.0) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toBuffer("image/png"));
  }
  return pages;
}
