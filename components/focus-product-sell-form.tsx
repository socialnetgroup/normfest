"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type CompanyOption = { id: string; name: string; kundennummer: string; ort: string | null };

export function FocusProductSellForm({ productId, agentId }: { productId: string; agentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [qty, setQty] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
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
    setOptions(data ?? []);
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setOptions([]);
    setSelected(null);
    setQty("");
    setValue("");
    setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("sales_feedback").insert({
      agent_id: agentId,
      company_id: selected.id,
      product_id: productId,
      outcome: "sold",
      qty: qty ? Number(qty) : null,
      value_net: value ? Number(value) : null,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    reset();
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)}>
        Verkauft eintragen
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={selected ? `${selected.name} (${selected.kundennummer})` : query}
          onChange={(e) => search(e.target.value)}
          placeholder="Firma suchen..."
          autoFocus
          className="h-8 pl-8 text-xs"
        />
      </div>
      {options.length > 0 && !selected ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-background">
          {options.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setSelected(c);
                  setOptions([]);
                }}
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

      {selected ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Menge"
            className="h-8 w-20 text-xs"
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Wert (€)"
            className="h-8 w-24 text-xs"
          />
          <Button type="submit" size="xs" disabled={status === "saving"}>
            {status === "saving" ? "Speichern..." : "Speichern"}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={reset}>
            Abbrechen
          </Button>
        </div>
      ) : null}
      {status === "error" && errorMessage ? (
        <span className="text-xs text-destructive" role="alert">
          {errorMessage}
        </span>
      ) : null}
    </form>
  );
}
