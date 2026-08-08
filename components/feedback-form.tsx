"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

// Taxonomy redesigned 2026-08-08 per Alan's real-usage pilot feedback,
// confirmed with Anis before touching the live outcome CHECK constraint
// (CLAUDE.md §14 item 27). "interested" was removed from selection here but
// stays a legal DB value so the one pre-existing historical row isn't
// orphaned - never shown as a choice going forward.
const OUTCOMES = [
  { value: "sold", label: "Verkauft" },
  { value: "rejected", label: "Kein Bedarf" },
  { value: "not_relevant", label: "Nicht angetroffen" },
  { value: "keine_zeit", label: "Keine Zeit" },
  { value: "nicht_besucht", label: "Nicht besucht" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

// "Abgelehnt" = reached the real contact person, no sale for some reason.
const REJECTED_REASONS = [
  "Schon einen Lieferanten",
  "Kein Interesse",
  "Zu teuer",
  "Genug Vorrat",
  "Schicken Sie mir was per Mail",
  "Ich melde mich",
];

// "Nicht angetroffen" = nobody picked up / no connection established.
const NOT_RELEVANT_REASONS = ["Keine Verbindung", "Durchgeklingelt", "Anrufbeantworter"];

const OUTCOME_REASONS: Partial<Record<Outcome, string[]>> = {
  rejected: REJECTED_REASONS,
  not_relevant: NOT_RELEVANT_REASONS,
};

type ProductOption = { id: string; name: string; sku: string };

export function FeedbackForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [qty, setQty] = useState("");
  const [value, setValue] = useState("");
  const [objection, setObjection] = useState("");
  const [comment, setComment] = useState("");
  const [wiedervorlageDate, setWiedervorlageDate] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function searchProducts(q: string) {
    setProductQuery(q);
    setSelectedProduct(null);
    if (q.trim().length < 2) {
      setProductOptions([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("products")
      .select("id, name, sku")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8);
    setProductOptions(data ?? []);
  }

  function reset() {
    setOutcome(null);
    setProductQuery("");
    setProductOptions([]);
    setSelectedProduct(null);
    setQty("");
    setValue("");
    setObjection("");
    setComment("");
    setWiedervorlageDate("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    if (outcome === "nicht_besucht" && !comment.trim()) {
      setStatus("error");
      setErrorMessage('Kommentar ist bei "Nicht besucht" Pflicht.');
      return;
    }

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_log_sales_feedback", {
      p_company_id: companyId,
      p_outcome: outcome,
      p_product_id: selectedProduct?.id ?? undefined,
      p_qty: qty ? Number(qty) : undefined,
      p_value_net: value ? Number(value) : undefined,
      p_objection: objection || undefined,
      p_comment: comment || undefined,
      p_wiedervorlage_date: wiedervorlageDate || undefined,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("done");
    reset();
    router.refresh();
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <Button
            key={o.value}
            type="button"
            variant={outcome === o.value ? "default" : "outline"}
            onClick={() => setOutcome(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {outcome ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-search">Produkt (optional)</Label>
            <Input
              id="product-search"
              type="text"
              value={selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : productQuery}
              onChange={(e) => searchProducts(e.target.value)}
              placeholder="Produktname oder Art.-Nr. suchen..."
            />
            {productOptions.length > 0 && !selectedProduct ? (
              <ul className="mt-1 flex flex-col divide-y rounded-lg border">
                {productOptions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setSelectedProduct(p);
                        setProductOptions([]);
                      }}
                    >
                      {p.name}{" "}
                      <span className="text-muted-foreground">({p.sku})</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {outcome === "sold" ? (
            <div className="flex gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="qty">Menge</Label>
                <Input
                  id="qty"
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-24"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="value">Wert (€)</Label>
                <Input
                  id="value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          ) : null}

          {outcome && OUTCOME_REASONS[outcome] ? (
            <div className="flex flex-col gap-1.5">
              <Label>Grund</Label>
              <div className="flex flex-wrap gap-1.5">
                {OUTCOME_REASONS[outcome]!.map((o) => (
                  <button
                    type="button"
                    key={o}
                    onClick={() => setObjection(o)}
                  >
                    <Badge variant={objection === o ? "default" : "secondary"}>{o}</Badge>
                  </button>
                ))}
              </div>
              <Input
                type="text"
                value={objection}
                onChange={(e) => setObjection(e.target.value)}
                placeholder="oder eigener Grund..."
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="comment">
              Kommentar {outcome === "nicht_besucht" ? "(Pflicht - warum nicht kontaktiert?)" : "(optional)"}
            </Label>
            <Input
              id="comment"
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={outcome === "nicht_besucht" ? "z.B. Kunde im Urlaub, keine Zeit heute..." : "z.B. Rückruf nächste Woche..."}
              required={outcome === "nicht_besucht"}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="wiedervorlage">Wiedervorlage (optional)</Label>
            <Input
              id="wiedervorlage"
              type="date"
              value={wiedervorlageDate}
              onChange={(e) => setWiedervorlageDate(e.target.value)}
              className="w-40"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={status === "saving"}>
              {status === "saving" ? "Speichern..." : "Speichern"}
            </Button>
            {status === "done" ? (
              <span className="text-sm text-primary" role="status">
                Gespeichert!
              </span>
            ) : null}
            {status === "error" && errorMessage ? (
              <span className="text-sm text-destructive" role="alert">
                {errorMessage}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
