"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type CompanyOption = { id: string; name: string; kundennummer: string; ort: string | null };
type SelectedCompany = CompanyOption & { note: string };

export function FocusListCreateForm({ createdBy }: { createdBy: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<SelectedCompany[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("companies")
      .select("id, name, kundennummer, ort")
      .or(`name.ilike.%${q}%,kundennummer.ilike.%${q}%`)
      .order("name")
      .limit(8);
    setOptions((data ?? []).filter((c) => !selected.some((s) => s.id === c.id)));
  }

  function addCompany(c: CompanyOption) {
    setSelected((prev) => [...prev, { ...c, note: "" }]);
    setOptions([]);
    setQuery("");
  }

  function removeCompany(id: string) {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  }

  function setCompanyNote(id: string, value: string) {
    setSelected((prev) => prev.map((c) => (c.id === id ? { ...c, note: value } : c)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selected.length === 0) return;

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();

    const { error: deactivateError } = await supabase
      .from("focus_lists")
      .update({ active: false })
      .eq("active", true);
    if (deactivateError) {
      setStatus("error");
      setErrorMessage(deactivateError.message);
      return;
    }

    const { data: newList, error: insertError } = await supabase
      .from("focus_lists")
      .insert({ name, note: note || null, active: true, created_by: createdBy })
      .select("id")
      .single();
    if (insertError || !newList) {
      setStatus("error");
      setErrorMessage(insertError?.message ?? "Liste konnte nicht erstellt werden.");
      return;
    }

    const { error: itemsError } = await supabase.from("focus_list_items").insert(
      selected.map((c) => ({
        focus_list_id: newList.id,
        company_id: c.id,
        note: c.note || null,
      })),
    );
    if (itemsError) {
      setStatus("error");
      setErrorMessage(itemsError.message);
      return;
    }

    router.push("/fokus");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="list-name">Name</Label>
        <Input
          id="list-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. KW 30 — Bremsflüssigkeit"
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="list-note">Notiz (optional)</Label>
        <textarea
          id="list-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Thema/Begründung der Liste..."
          rows={2}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Firmen</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Firma suchen — Name oder Kundennummer..."
            className="pl-8"
          />
        </div>
        {options.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {options.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => addCompany(c)}
                >
                  <span className="font-medium">{c.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {c.kundennummer} · {c.ort}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {selected.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">{c.kundennummer}</div>
              </div>
              <Input
                value={c.note}
                onChange={(e) => setCompanyNote(c.id, e.target.value)}
                placeholder="Notiz zu dieser Firma (optional)"
                className="h-8 flex-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeCompany(c.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Entfernen"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Noch keine Firmen ausgewählt.</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving" || !name.trim() || selected.length === 0}>
          {status === "saving" ? "Speichern..." : `Liste erstellen (${selected.length})`}
        </Button>
        {status === "error" && errorMessage ? (
          <span className="text-sm text-destructive" role="alert">
            {errorMessage}
          </span>
        ) : null}
      </div>
    </form>
  );
}
