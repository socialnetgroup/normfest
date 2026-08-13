// Real Tier-2 invoice parsing (CLAUDE.md §4.4/§14, 2026-08-14). First
// attempt fed pdftotext -layout text to the LLM — tested against 46 real
// invoices, and while single-item invoices parsed perfectly, multi-item
// ones (26% of the real sample) silently corrupted: the LLM matched real
// SKUs to the wrong description (order-reference/boilerplate lines instead
// of the real product name) and fabricated placeholder prices (€0.01) for
// products it couldn't find a real row for — and a totals-reconciliation
// check didn't catch it, since the wrong numbers still summed close to the
// real total. Root cause: pdftotext -layout genuinely loses row alignment
// on this invoice format once there's more than one line item (Artikelnummer,
// Menge/Preis/Netto, and description text each reconstruct as separate,
// no-longer-aligned column blocks).
//
// Fixed the same way this project already fixed an identical problem for
// the catalog PDF (scripts/crop-catalog-images.mjs, §13 M4): render the
// actual page(s) as images and use vision, which sees the real column
// alignment instead of scrambled reconstructed text. Uses the `analyze`
// tier (Sonnet), same tier already proven reliable for vision + structured
// extraction in this codebase — the earlier text-only attempt used the
// cheaper `bulk` tier and that undershoot is very likely part of why it
// guessed instead of admitting uncertainty.
import { getModel } from "../ai/provider.mjs";

export const MAX_TOKENS = 4000;
const MODEL = getModel("analyze");

function buildSchema() {
  return {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      kundennummer: { type: "string" },
      invoice_date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD" },
      ansprechpartner: { type: ["string", "null"], description: "the printed 'Ansprechpartner Aussendienst' name, verbatim" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sku: { type: ["string", "null"], description: "Artikelnummer, verbatim, or null if this line genuinely has none" },
            description: {
              type: "string",
              description: "the real product name/description for THIS item - never an order-reference line ('...vom DD.MM.YYYY'), never 'Auftrag erteilt durch'/'Geliefert an' delivery-address boilerplate, never a Lieferscheinnummer/Zolltarifnummer line",
            },
            qty: { type: "number" },
            unit_price: { type: "number" },
            net_amount: { type: "number" },
            vat_rate: { type: "number", description: "as a percentage, e.g. 19 for 19%" },
          },
          required: ["sku", "description", "qty", "unit_price", "net_amount", "vat_rate"],
          additionalProperties: false,
        },
      },
      net_total: {
        type: "number",
        description:
          "the value on the line literally labeled 'Zwischensumme' (sum of line items BEFORE shipping) - do NOT use 'Gesamt Netto' here, that is a different, larger number (Zwischensumme + Versandpauschale) printed just below it",
      },
      shipping: { type: ["number", "null"], description: "Versandpauschale, null if absent" },
      vat_total: { type: "number", description: "the value on the '19% MwSt auf ...' line" },
      gross_total: { type: "number", description: "the value on the line literally labeled 'Rechnungsbetrag' (final total including VAT and shipping)" },
      uncertain: {
        type: "boolean",
        description: "true if you could not confidently match every line item's Menge/Preis/Netto to its real Artikelnummer and description - never guess a placeholder value, set this instead",
      },
    },
    required: ["invoice_number", "kundennummer", "invoice_date", "line_items", "net_total", "vat_total", "gross_total", "uncertain"],
    additionalProperties: false,
  };
}

const PROMPT = `Das sind die Seite(n) einer echten Normfest-Rechnung (deutsches Kfz-Großhandel-Rechnungsformat). Lies die Artikeltabelle (Artikelnummer, Artikelbezeichnung, Menge, Preis/Einheit, Netto, MwSt.) direkt aus dem Bild anhand der echten Spaltenausrichtung - verlass dich nicht auf reine Textreihenfolge, da PDF-Textextraktion die Zeilen bei mehreren Positionen durcheinanderbringt.

Wichtig: jede Position hat eine echte Artikelbezeichnung (Produktname, z.B. "BREMTEC BREMSENREINIGER 30L") - NIEMALS die Bestell-Referenzzeile ("... vom DD.MM.YYYY"), NIEMALS "Auftrag erteilt durch"/"Geliefert an"-Adresszeilen, NIEMALS Lieferscheinnummer/Zolltarifnummer-Zeilen als Artikelbezeichnung verwenden - das sind nur Zusatzinformationen zur jeweiligen Position, nicht der Produktname selbst.

Gib NUR echte Werte zurück, die du im Bild siehst - erfinde nichts. Wenn du bei einer Position Menge/Preis/Netto nicht sicher der richtigen Artikelnummer/Beschreibung zuordnen kannst, setze uncertain=true statt einen Platzhalterwert zu raten.`;

/**
 * Parses one invoice from its rendered page images (vision) via the LLM.
 * Returns the parsed object plus usage for cost tracking.
 */
export async function parseInvoiceImages(anthropic, pageImages) {
  const content = [];
  pageImages.forEach((png, i) => {
    content.push({ type: "text", text: `Seite ${i + 1} von ${pageImages.length}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
  });
  content.push({ type: "text", text: PROMPT });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: buildSchema() } },
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("no text block in response");
  const parsed = JSON.parse(block.text);
  return { parsed, usage: response.usage };
}

/**
 * Real correctness check, not just trust-the-LLM: line items must sum close
 * to net_total, and net_total (+ shipping) must sum close to gross_total
 * once VAT is added back. Small rounding tolerance (a few cents) - real
 * invoices round per-line before summing. Returns a list of human-readable
 * mismatch reasons; empty list means it reconciles.
 */
export function validateInvoiceTotals(parsed) {
  const issues = [];
  const TOLERANCE = 0.05;

  if (parsed.uncertain) {
    issues.push("Modell war sich bei mindestens einer Position nicht sicher");
  }

  const lineSum = (parsed.line_items ?? []).reduce((s, li) => s + (li.net_amount ?? 0), 0);
  if (parsed.net_total != null && Math.abs(lineSum - parsed.net_total) > TOLERANCE) {
    issues.push(`Summe der Positionen (${lineSum.toFixed(2)}) weicht von Zwischensumme (${parsed.net_total.toFixed(2)}) ab`);
  }

  if (parsed.net_total != null && parsed.vat_total != null && parsed.gross_total != null) {
    const shipping = parsed.shipping ?? 0;
    const expectedGross = parsed.net_total + shipping + parsed.vat_total;
    if (Math.abs(expectedGross - parsed.gross_total) > TOLERANCE) {
      issues.push(
        `Netto (${parsed.net_total.toFixed(2)}) + Versand (${shipping.toFixed(2)}) + MwSt (${parsed.vat_total.toFixed(2)}) = ${expectedGross.toFixed(2)}, nicht Rechnungsbetrag (${parsed.gross_total.toFixed(2)})`,
      );
    }
  }

  if (!parsed.line_items || parsed.line_items.length === 0) {
    issues.push("keine Positionen erkannt");
  }

  return issues;
}
