// One-time (+ manual top-up) import of real Rechnungen forwarded to
// wissen@social-net.ba (CLAUDE.md §14, 2026-08-14). Reads already-downloaded
// PDFs from a directory, parses each via the LLM (lib/invoices/parse-invoice.mjs),
// resolves company (Kunden-Nr) + products (SKU), and upserts into
// orders/order_items - idempotent on invoice_number, so re-running is safe.
//
// Usage: node scripts/import-invoices.mjs <pdf-directory> [--dry-run] [--limit N]
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { getAnthropicClient } from "../lib/ai/provider.mjs";
import { parseInvoiceImages, validateInvoiceTotals } from "../lib/invoices/parse-invoice.mjs";
import { renderInvoicePages } from "../lib/invoices/render-invoice.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();

// $2/$10 per M tokens - Sonnet 5 intro pricing (analyze tier), used for
// vision extraction per lib/invoices/parse-invoice.mjs's header comment.
const SONNET_INPUT_PER_M = 2;
const SONNET_OUTPUT_PER_M = 10;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) {
    console.error("Usage: node scripts/import-invoices.mjs <pdf-directory> [--dry-run] [--limit N]");
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).slice(0, limit);
  console.log(`${files.length} PDF(s) in ${dir}${dryRun ? " (DRY RUN - no writes)" : ""}\n`);

  const stats = { imported: 0, updated: 0, needsReview: 0, errors: 0, inputTokens: 0, outputTokens: 0 };

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const pageImages = await renderInvoicePages(filePath);
      const { parsed, usage } = await parseInvoiceImages(anthropic, pageImages);
      stats.inputTokens += usage.input_tokens;
      stats.outputTokens += usage.output_tokens;

      const issues = validateInvoiceTotals(parsed);

      const { data: company } = await admin
        .from("companies")
        .select("id, name")
        .eq("kundennummer", parsed.kundennummer)
        .maybeSingle();
      if (!company) issues.push(`Kunden-Nr. ${parsed.kundennummer} nicht in companies gefunden`);

      const needsReview = issues.length > 0;
      if (needsReview) stats.needsReview++;

      console.log(
        `[${file}] Rechnung ${parsed.invoice_number}, Kunde ${parsed.kundennummer} (${company?.name ?? "?"}), ` +
          `${parsed.line_items?.length ?? 0} Position(en), Brutto ${parsed.gross_total}€` +
          (needsReview ? ` -- PRÜFEN: ${issues.join("; ")}` : ""),
      );

      if (dryRun) continue;

      const { data: existingOrder } = await admin
        .from("orders")
        .select("id")
        .eq("invoice_number", parsed.invoice_number)
        .maybeSingle();

      const orderRow = {
        company_id: company?.id ?? null,
        invoice_number: parsed.invoice_number,
        invoice_date: parsed.invoice_date,
        kundennummer_raw: parsed.kundennummer,
        ansprechpartner_raw: parsed.ansprechpartner ?? null,
        net_total: parsed.net_total ?? null,
        shipping: parsed.shipping ?? null,
        vat_total: parsed.vat_total ?? null,
        gross_total: parsed.gross_total ?? null,
        source: "email_import",
        needs_review: needsReview,
        review_note: needsReview ? issues.join("; ") : null,
      };

      let orderId;
      if (existingOrder) {
        await admin.from("orders").update(orderRow).eq("id", existingOrder.id);
        await admin.from("order_items").delete().eq("order_id", existingOrder.id);
        orderId = existingOrder.id;
        stats.updated++;
      } else {
        const { data: inserted, error } = await admin.from("orders").insert(orderRow).select("id").single();
        if (error) throw error;
        orderId = inserted.id;
        stats.imported++;
      }

      // Real invoice SKUs often carry a trailing pack-size suffix ("9833-397-60/100"
      // = sold in packs of 100) that our catalog's own sku column doesn't include
      // (real base SKU is "9833-397-60") - confirmed against the first 46-invoice
      // batch: 45 of 46 initially-unmatched items resolved once this suffix was
      // stripped. sku_raw always keeps the verbatim invoice value for traceability;
      // only the product-match lookup uses the stripped form.
      const stripPackSuffix = (sku) => sku.replace(/\/\d+$/, "");
      const skus = (parsed.line_items ?? []).map((li) => li.sku).filter(Boolean).map(stripPackSuffix);
      const { data: matchedProducts } = skus.length
        ? await admin.from("products").select("id, sku").in("sku", skus)
        : { data: [] };
      const productBySku = new Map((matchedProducts ?? []).map((p) => [p.sku, p.id]));

      const itemRows = (parsed.line_items ?? []).map((li) => ({
        order_id: orderId,
        product_id: li.sku ? (productBySku.get(stripPackSuffix(li.sku)) ?? null) : null,
        sku_raw: li.sku ?? null,
        description_raw: li.description,
        qty: li.qty,
        unit_price: li.unit_price,
        net_amount: li.net_amount,
        vat_rate: li.vat_rate,
      }));
      if (itemRows.length > 0) {
        await admin.from("order_items").insert(itemRows);
      }
    } catch (err) {
      console.error(`[${file}] FEHLER -`, err.message);
      stats.errors++;
    }
  }

  const cost = (stats.inputTokens * SONNET_INPUT_PER_M) / 1e6 + (stats.outputTokens * SONNET_OUTPUT_PER_M) / 1e6;
  console.log("\n=== Zusammenfassung ===");
  console.log(stats);
  console.log(`Echte Kosten (Sonnet 5 vision, analyze tier): $${cost.toFixed(4)}`);
}

main();
