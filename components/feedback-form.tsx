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

// Anis (2026-08-08): "Dodaj kao mini objasnjenje, sta znaci taj feedback" -
// a one-line reminder of each outcome's real meaning, shown right under the
// outcome buttons. "sold" needs no explanation (self-evident).
const OUTCOME_DESCRIPTIONS: Partial<Record<Outcome, string>> = {
  rejected: "Mit dem Ansprechpartner telefoniert, aber aus irgendeinem Grund kam kein Verkauf zustande.",
  not_relevant: "Niemand hat sich gemeldet - es kam keine Verbindung zustande.",
  keine_zeit: "Ein Gespräch kam zustande, aber nicht mit dem eigentlichen Ansprechpartner.",
  nicht_besucht: "Die Firma wurde heute gar nicht kontaktiert - bitte im Kommentar erklären, warum.",
};

type ProductOption = { id: string; name: string; sku: string };

type Position = {
  key: string;
  productQuery: string;
  productOptions: ProductOption[];
  selectedProduct: ProductOption | null;
  qty: string;
  value: string;
};

function emptyPosition(): Position {
  return {
    key: crypto.randomUUID(),
    productQuery: "",
    productOptions: [],
    selectedProduct: null,
    qty: "",
    value: "",
  };
}

export function FeedbackForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Multiple positions only make sense for "sold" (mehrere verkaufte
  // Produkte in einem Anruf, CLAUDE.md 2026-08-12 - Anis: "if they do 3
  // diferent positions sales products for 1 firme"). Every other outcome
  // only ever uses positions[0]'s product field (optional, as before) - the
  // add/remove UI and qty/value inputs stay hidden for those.
  const [positions, setPositions] = useState<Position[]>([emptyPosition()]);
  const [objection, setObjection] = useState("");
  const [comment, setComment] = useState("");
  const [wiedervorlageDate, setWiedervorlageDate] = useState("");
  const [wiedervorlageTime, setWiedervorlageTime] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updatePosition(key: string, patch: Partial<Position>) {
    setPositions((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  async function searchProducts(key: string, q: string) {
    updatePosition(key, { productQuery: q, selectedProduct: null });
    if (q.trim().length < 2) {
      updatePosition(key, { productOptions: [] });
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("products")
      .select("id, name, sku")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8);
    updatePosition(key, { productOptions: data ?? [] });
  }

  function addPosition() {
    setPositions((prev) => [...prev, emptyPosition()]);
  }

  function removePosition(key: string) {
    setPositions((prev) => (prev.length > 1 ? prev.filter((p) => p.key !== key) : prev));
  }

  function reset() {
    setOutcome(null);
    setPositions([emptyPosition()]);
    setObjection("");
    setComment("");
    setWiedervorlageDate("");
    setWiedervorlageTime("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    if (outcome === "nicht_besucht" && !comment.trim()) {
      setStatus("error");
      setErrorMessage('Kommentar ist bei "Nicht besucht" Pflicht.');
      return;
    }

    // "sold": submit one row per position that actually has data (product,
    // qty, or value), so 3 real products sold in one call become 3 real
    // sales_feedback rows - each contributes independently to
    // agent_daily_performance via fn_log_sales_feedback's existing per-row
    // sync logic, matching what logging them 3 separate times would do.
    // Non-"sold" outcomes only ever use the first position's product field
    // (unchanged single-row behavior).
    const rowsToSubmit =
      outcome === "sold"
        ? (() => {
            const withData = positions.filter((p) => p.selectedProduct || p.qty || p.value);
            return withData.length > 0 ? withData : [positions[0]];
          })()
        : [positions[0]];

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();

    for (const pos of rowsToSubmit) {
      const { error } = await supabase.rpc("fn_log_sales_feedback", {
        p_company_id: companyId,
        p_outcome: outcome,
        p_product_id: pos.selectedProduct?.id ?? undefined,
        p_qty: pos.qty ? Number(pos.qty) : undefined,
        p_value_net: pos.value ? Number(pos.value) : undefined,
        p_objection: objection || undefined,
        p_comment: comment || undefined,
        p_wiedervorlage_date: wiedervorlageDate || undefined,
        p_wiedervorlage_time: wiedervorlageDate && wiedervorlageTime ? wiedervorlageTime : undefined,
      });

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }
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
          {OUTCOME_DESCRIPTIONS[outcome] ? (
            <p className="text-sm text-muted-foreground">{OUTCOME_DESCRIPTIONS[outcome]}</p>
          ) : null}

          <div className="flex flex-col gap-3">
            {(outcome === "sold" ? positions : positions.slice(0, 1)).map((pos, i) => (
              <div
                key={pos.key}
                className={outcome === "sold" && positions.length > 1 ? "flex flex-col gap-2 rounded-lg border p-3" : "flex flex-col gap-2"}
              >
                {outcome === "sold" && positions.length > 1 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Position {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removePosition(pos.key)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : null}

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`product-search-${pos.key}`}>Produkt (optional)</Label>
                  <Input
                    id={`product-search-${pos.key}`}
                    type="text"
                    value={pos.selectedProduct ? `${pos.selectedProduct.name} (${pos.selectedProduct.sku})` : pos.productQuery}
                    onChange={(e) => searchProducts(pos.key, e.target.value)}
                    placeholder="Produktname oder Art.-Nr. suchen..."
                  />
                  {pos.productOptions.length > 0 && !pos.selectedProduct ? (
                    <ul className="mt-1 flex flex-col divide-y rounded-lg border">
                      {pos.productOptions.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => updatePosition(pos.key, { selectedProduct: p, productOptions: [] })}
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
                      <Label htmlFor={`qty-${pos.key}`}>Menge</Label>
                      <Input
                        id={`qty-${pos.key}`}
                        type="number"
                        min="1"
                        value={pos.qty}
                        onChange={(e) => updatePosition(pos.key, { qty: e.target.value })}
                        className="w-24"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`value-${pos.key}`}>Wert (€)</Label>
                      <Input
                        id={`value-${pos.key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={pos.value}
                        onChange={(e) => updatePosition(pos.key, { value: e.target.value })}
                        className="w-32"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            {outcome === "sold" ? (
              <Button type="button" variant="outline" size="sm" onClick={addPosition} className="self-start">
                + Weitere Position
              </Button>
            ) : null}
          </div>

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

          <div className="flex flex-wrap gap-3">
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
            {wiedervorlageDate ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="wiedervorlage-time">Uhrzeit (optional)</Label>
                <Input
                  id="wiedervorlage-time"
                  type="time"
                  value={wiedervorlageTime}
                  onChange={(e) => setWiedervorlageTime(e.target.value)}
                  className="w-28"
                />
              </div>
            ) : null}
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
