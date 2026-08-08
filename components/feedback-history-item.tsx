"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

// Taxonomy redesigned 2026-08-08 - kept in sync manually with
// feedback-form.tsx (small, static lists). "interested" stays in
// OUTCOME_LABELS only so any pre-existing historical row still renders a
// real label, but is never offered as an editable choice.
const OUTCOMES = [
  { value: "sold", label: "Verkauft" },
  { value: "rejected", label: "Abgelehnt (Kein Bedarf)" },
  { value: "not_relevant", label: "Nicht angetroffen" },
  { value: "keine_zeit", label: "Keine Zeit" },
  { value: "nicht_besucht", label: "Nicht besucht" },
] as const;

const OUTCOME_LABELS: Record<string, string> = {
  sold: "Verkauft",
  interested: "Interessiert",
  rejected: "Abgelehnt (Kein Bedarf)",
  not_relevant: "Nicht angetroffen",
  keine_zeit: "Keine Zeit",
  nicht_besucht: "Nicht besucht",
};

const REJECTED_REASONS = [
  "Schon einen Lieferanten",
  "Kein Interesse",
  "Zu teuer",
  "Genug Vorrat",
  "Schicken Sie mir was per Mail",
  "Ich melde mich",
];

const NOT_RELEVANT_REASONS = ["Keine Verbindung", "Durchgeklingelt", "Anrufbeantworter"];

const OUTCOME_REASONS: Partial<Record<string, string[]>> = {
  rejected: REJECTED_REASONS,
  not_relevant: NOT_RELEVANT_REASONS,
};

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

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
  companyId,
  companyName,
  wiedervorlageDate,
  wiedervorlageDone,
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
  /** Only passed on cross-company lists (e.g. /feedback) - the company
   * profile's own Feedback-Verlauf already has the company as context and
   * omits these. */
  companyId?: string;
  companyName?: string;
  wiedervorlageDate?: string | null;
  wiedervorlageDone?: boolean;
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
  const [formWiedervorlage, setFormWiedervorlage] = useState(wiedervorlageDate ?? "");
  const [wiedervorlagePending, setWiedervorlagePending] = useState(false);

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
    if (formOutcome === "nicht_besucht" && !formComment.trim()) {
      setErrorMessage('Kommentar ist bei "Nicht besucht" Pflicht.');
      return;
    }
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
      p_wiedervorlage_date: formWiedervorlage || undefined,
      p_wiedervorlage_done: wiedervorlageDone ?? false,
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

  async function markWiedervorlageDone() {
    setWiedervorlagePending(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_set_wiedervorlage_done", { p_id: id, p_done: true });
    setWiedervorlagePending(false);
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

        {formOutcome && OUTCOME_REASONS[formOutcome] ? (
          <div className="flex flex-col gap-1.5">
            <Label>Grund</Label>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOME_REASONS[formOutcome]!.map((o) => (
                <button type="button" key={o} onClick={() => setFormObjection(o)}>
                  <Badge variant={formObjection === o ? "default" : "secondary"}>{o}</Badge>
                </button>
              ))}
            </div>
            <Input
              type="text"
              value={formObjection}
              onChange={(e) => setFormObjection(e.target.value)}
              placeholder="oder eigener Grund..."
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor={`comment-${id}`}>
            Kommentar {formOutcome === "nicht_besucht" ? "(Pflicht - warum nicht kontaktiert?)" : "(optional)"}
          </Label>
          <Input
            id={`comment-${id}`}
            value={formComment}
            onChange={(e) => setFormComment(e.target.value)}
            placeholder={formOutcome === "nicht_besucht" ? "z.B. Kunde im Urlaub, keine Zeit heute..." : "z.B. Rückruf nächste Woche..."}
            required={formOutcome === "nicht_besucht"}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`wiedervorlage-${id}`}>Wiedervorlage (optional)</Label>
          <Input
            id={`wiedervorlage-${id}`}
            type="date"
            value={formWiedervorlage}
            onChange={(e) => setFormWiedervorlage(e.target.value)}
            className="w-40"
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
        {companyName ? (
          <p className="mb-0.5">
            {companyId ? (
              <Link href={`/firmen/${companyId}`} className="font-medium text-primary hover:underline">
                {companyName}
              </Link>
            ) : (
              <span className="font-medium">{companyName}</span>
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              outcome === "sold"
                ? "success"
                : outcome === "rejected"
                  ? "destructive"
                  : outcome === "nicht_besucht"
                    ? "warning"
                    : "secondary"
            }
          >
            {OUTCOME_LABELS[outcome] ?? outcome}
          </Badge>
          {productName ? <span className="font-medium">{productName}</span> : null}
          {qty ? <span className="text-muted-foreground">×{qty}</span> : null}
          {valueNet ? <span className="text-muted-foreground">{eur.format(valueNet)}</span> : null}
        </div>
        {objection ? <p className="mt-1 text-muted-foreground">Grund: {objection}</p> : null}
        {comment ? <p className="mt-1 text-muted-foreground">{comment}</p> : null}
        {wiedervorlageDate && !wiedervorlageDone ? (
          <div className="mt-1.5 flex items-center gap-2">
            <Badge variant={wiedervorlageDate <= new Date().toISOString().slice(0, 10) ? "warning" : "secondary"}>
              Wiedervorlage: {dateFmt.format(new Date(wiedervorlageDate))}
            </Badge>
            {canEdit ? (
              <button
                type="button"
                onClick={markWiedervorlageDone}
                disabled={wiedervorlagePending}
                className="text-xs text-muted-foreground hover:underline"
              >
                {wiedervorlagePending ? "..." : "Erledigt"}
              </button>
            ) : null}
          </div>
        ) : null}
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
          <ConfirmButton
            size="icon-xs"
            variant="ghost"
            onConfirm={remove}
            disabled={pending}
            aria-label="Feedback löschen (zweimal klicken zum Bestätigen)"
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </ConfirmButton>
        </div>
      ) : null}
    </li>
  );
}
