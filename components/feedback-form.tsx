"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const OUTCOMES = [
  { value: "sold", label: "Verkauft" },
  { value: "interested", label: "Interessiert" },
  { value: "rejected", label: "Abgelehnt" },
  { value: "not_relevant", label: "Nicht relevant" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

// From the agent sales script's objection table (§2 Agent-Priručnik).
const COMMON_OBJECTIONS = [
  "Schon einen Lieferanten",
  "Kein Interesse",
  "Keine Zeit",
  "Zu teuer",
  "Genug Vorrat",
  "Schicken Sie mir was per Mail",
  "Ich melde mich",
  "Haben sowas probiert",
];

type ProductOption = { id: string; name: string; sku: string };

export function FeedbackForm({ companyId, agentId }: { companyId: string; agentId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [qty, setQty] = useState("");
  const [value, setValue] = useState("");
  const [objection, setObjection] = useState("");
  const [comment, setComment] = useState("");
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("sales_feedback").insert({
      agent_id: agentId,
      company_id: companyId,
      product_id: selectedProduct?.id ?? null,
      outcome,
      qty: qty ? Number(qty) : null,
      value_net: value ? Number(value) : null,
      objection: objection || null,
      comment: comment || null,
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

          {outcome === "rejected" ? (
            <div className="flex flex-col gap-1.5">
              <Label>Einwand</Label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_OBJECTIONS.map((o) => (
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
                placeholder="oder eigener Einwand..."
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="comment">Kommentar (optional)</Label>
            <Input
              id="comment"
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="z.B. Rückruf nächste Woche..."
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
