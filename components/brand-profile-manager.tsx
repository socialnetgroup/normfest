"use client";

import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Row = Database["public"]["Tables"]["brand_consumption_profiles"]["Row"];

function EditableRow({ row }: { row: Row }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(row.note);
  const [weight, setWeight] = useState(row.weight);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("brand_consumption_profiles").update({ note, weight }).eq("id", row.id);
    setPending(false);
    setEditing(false);
    router.refresh();
  }

  async function toggleVerified() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("brand_consumption_profiles").update({ verified: !row.verified }).eq("id", row.id);
    setPending(false);
    router.refresh();
  }

  async function remove() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("brand_consumption_profiles").delete().eq("id", row.id);
    setPending(false);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.brand}</span>
          <span className="text-muted-foreground">→</span>
          <Badge variant="secondary">{row.category}</Badge>
          <Badge variant={row.verified ? "success" : "warning"}>
            {row.verified ? "Bestätigt" : "Vorläufig"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={toggleVerified}
            disabled={pending}
            aria-label={row.verified ? "Als vorläufig markieren" : "Als bestätigt markieren"}
            title={row.verified ? "Als vorläufig markieren" : "Als bestätigt markieren"}
          >
            <ShieldCheck className={row.verified ? "size-3.5 text-success-foreground" : "size-3.5"} />
          </Button>
          <ConfirmButton
            size="icon-xs"
            variant="ghost"
            onConfirm={remove}
            disabled={pending}
            aria-label="Löschen (zweimal klicken zum Bestätigen)"
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </ConfirmButton>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Gewichtung (1-5)</label>
            <Input
              type="number"
              min={1}
              max={5}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="h-7 w-16"
            />
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              Speichern
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setNote(row.note);
                setWeight(row.weight);
              }}
              disabled={pending}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-left text-sm text-muted-foreground hover:text-foreground"
        >
          {row.note} <span className="text-xs">(Gewichtung {row.weight}/5 · bearbeiten)</span>
        </button>
      )}
      {row.source ? <p className="text-xs text-muted-foreground italic">Quelle: {row.source}</p> : null}
    </li>
  );
}

function AddForm({ categories }: { categories: string[] }) {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [note, setNote] = useState("");
  const [weight, setWeight] = useState(3);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!brand.trim() || !category || !note.trim()) return;
    setPending(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("brand_consumption_profiles").insert({
      brand: brand.trim(),
      category,
      note: note.trim(),
      weight,
      verified: true,
      source: "Manuell erfasst (Admin)",
    });
    setPending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setBrand("");
    setNote("");
    setWeight(3);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marke (z.B. Mercedes-Benz)" required />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Begründung, die dem Agenten angezeigt wird..."
        rows={2}
        required
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Gewichtung (1-5)</label>
        <Input type="number" min={1} max={5} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="h-8 w-16" />
        <Button type="submit" size="sm" className="gap-1.5" disabled={pending}>
          <Plus className="size-3.5" />
          {pending ? "Speichern..." : "Profil hinzufügen"}
        </Button>
        {errorMessage ? <span className="text-sm text-destructive">{errorMessage}</span> : null}
      </div>
    </form>
  );
}

export function BrandProfileManager({ rows, categories }: { rows: Row[]; categories: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <AddForm categories={categories} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Profile erfasst.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <EditableRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
