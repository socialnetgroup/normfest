"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

const OUTCOME_LABELS: Record<string, string> = {
  sold: "Verkauft",
  interested: "Interessiert",
  rejected: "Abgelehnt",
  not_relevant: "Nicht relevant",
};

// From the agent sales script's objection table (§2 Agent-Priručnik) -
// same list as feedback-form.tsx, kept in sync manually (small, static list).
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

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type ProductOption = { id: string; name: string; sku: string };

export function FeedbackHistoryItem({
  id,
  outcome,
  qty,
  valueNet,
  objection,
  comment,
  createdAt,
  productId,
  productName,
  agentName,
  adminAgentLink,
  canEdit,
}: {
  id: string;
  outcome: string;
  qty: number | null;
  valueNet: number | null;
  objection: string | null;
  comment: string | null;
  createdAt: string;
  productId: string | null;
  productName: string | null;
  agentName: string;
  adminAgentLink: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formOutcome, setFormOutcome] = useState(outcome);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(
    productId && productName ? { id: productId, name: productName, sku: "" } : null,
  );
  const [formQty, setFormQty] = useState(qty ? String(qty) : "");
  const [formValue, setFormValue] = useState(valueNet ? String(valueNet) : "");
  const [formObjection, setFormObjection] = useState(objection ?? "");
  const [formComment, setFormComment] = useState(comment ?? "");

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

  async function save() {
    setPending(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_update_sales_feedback", {
      p_id: id,
      p_outcome: formOutcome,
      p_product_id: selectedProduct?.id ?? undefined,
      p_qty: formQty ? Number(formQty) : undefined,
      p_value_net: formValue ? Number(formValue) : undefined,
      p_objection: formObjection || undefined,
      p_comment: formComment || undefined,
    });
    setPending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Diesen Feedback-Eintrag wirklich löschen?")) return;
    setPending(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_delete_sales_feedback", { p_id: id });
    setPending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-3 border-t py-3 text-base first:border-t-0">
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <Button
              key={o.value}
              type="button"
              size="sm"
              variant={formOutcome === o.value ? "default" : "outline"}
              onClick={() => setFormOutcome(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`product-${id}`}>Produkt (optional)</Label>
          <Input
            id={`product-${id}`}
            value={selectedProduct ? `${selectedProduct.name}${selectedProduct.sku ? ` (${selectedProduct.sku})` : ""}` : productQuery}
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
                    {p.name} <span className="text-muted-foreground">({p.sku})</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {formOutcome === "sold" ? (
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`qty-${id}`}>Menge</Label>
              <Input
                id={`qty-${id}`}
                type="number"
                min="1"
                value={formQty}
                onChange={(e) => setFormQty(e.target.value)}
                className="w-24"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`value-${id}`}>Wert (€)</Label>
              <Input
                id={`value-${id}`}
                type="number"
                min="0"
                step="0.01"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
        ) : null}

        {formOutcome === "rejected" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Einwand</Label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_OBJECTIONS.map((o) => (
                <button type="button" key={o} onClick={() => setFormObjection(o)}>
                  <Badge variant={formObjection === o ? "default" : "secondary"}>{o}</Badge>
                </button>
              ))}
            </div>
            <Input
              type="text"
              value={formObjection}
              onChange={(e) => setFormObjection(e.target.value)}
              placeholder="oder eigener Einwand..."
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor={`comment-${id}`}>Kommentar (optional)</Label>
          <Input
            id={`comment-${id}`}
            value={formComment}
            onChange={(e) => setFormComment(e.target.value)}
            placeholder="z.B. Rückruf nächste Woche..."
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? "Speichern..." : "Speichern"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Abbrechen
          </Button>
          {errorMessage ? (
            <span className="text-sm text-destructive" role="alert">
              {errorMessage}
            </span>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-2 py-2.5 text-base">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={outcome === "sold" ? "success" : outcome === "rejected" ? "destructive" : "secondary"}>
            {OUTCOME_LABELS[outcome] ?? outcome}
          </Badge>
          {productName ? <span className="font-medium">{productName}</span> : null}
          {qty ? <span className="text-muted-foreground">×{qty}</span> : null}
          {valueNet ? <span className="text-muted-foreground">{eur.format(valueNet)}</span> : null}
        </div>
        {objection ? <p className="mt-1 text-muted-foreground">Einwand: {objection}</p> : null}
        {comment ? <p className="mt-1 text-muted-foreground">{comment}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {adminAgentLink ? (
            <Link href={adminAgentLink} className="hover:underline">
              {agentName}
            </Link>
          ) : (
            agentName
          )}{" "}
          · {dateTimeFmt.format(new Date(createdAt))}
        </p>
        {errorMessage ? <p className="mt-1 text-xs text-destructive">{errorMessage}</p> : null}
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label="Feedback bearbeiten"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={remove}
            disabled={pending}
            aria-label="Feedback löschen"
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
