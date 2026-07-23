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

type ProductOption = { id: string; name: string; sku: string };
type SelectedProduct = ProductOption & { note: string };

export function FocusListCreateForm({ createdBy }: { createdBy: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);

  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<SelectedCompany[]>([]);

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function searchProducts(q: string) {
    setProductQuery(q);
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
    setProductOptions((data ?? []).filter((p) => !selectedProducts.some((s) => s.id === p.id)));
  }

  function addProduct(p: ProductOption) {
    setSelectedProducts((prev) => [...prev, { ...p, note: "" }]);
    setProductOptions([]);
    setProductQuery("");
  }

  function removeProduct(id: string) {
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function setProductNote(id: string, value: string) {
    setSelectedProducts((prev) => prev.map((p) => (p.id === id ? { ...p, note: value } : p)));
  }

  async function searchCompanies(q: string) {
    setCompanyQuery(q);
    if (q.trim().length < 2) {
      setCompanyOptions([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("companies")
      .select("id, name, kundennummer, ort")
      .or(`name.ilike.%${q}%,kundennummer.ilike.%${q}%`)
      .order("name")
      .limit(8);
    setCompanyOptions((data ?? []).filter((c) => !selectedCompanies.some((s) => s.id === c.id)));
  }

  function addCompany(c: CompanyOption) {
    setSelectedCompanies((prev) => [...prev, { ...c, note: "" }]);
    setCompanyOptions([]);
    setCompanyQuery("");
  }

  function removeCompany(id: string) {
    setSelectedCompanies((prev) => prev.filter((c) => c.id !== id));
  }

  function setCompanyNote(id: string, value: string) {
    setSelectedCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, note: value } : c)));
  }

  const canSubmit = name.trim().length > 0 && (selectedProducts.length > 0 || selectedCompanies.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

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

    if (selectedProducts.length > 0) {
      const { error: productsError } = await supabase.from("focus_list_products").insert(
        selectedProducts.map((p) => ({
          focus_list_id: newList.id,
          product_id: p.id,
          note: p.note || null,
        })),
      );
      if (productsError) {
        setStatus("error");
        setErrorMessage(productsError.message);
        return;
      }
    }

    if (selectedCompanies.length > 0) {
      const { error: itemsError } = await supabase.from("focus_list_items").insert(
        selectedCompanies.map((c) => ({
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
        <Label>Produkte (Hauptsache dieser Liste)</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={productQuery}
            onChange={(e) => searchProducts(e.target.value)}
            placeholder="Produkt suchen — Name oder Art.-Nr..."
            className="pl-8"
          />
        </div>
        {productOptions.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {productOptions.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => addProduct(p)}
                >
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-muted-foreground">({p.sku})</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {selectedProducts.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {selectedProducts.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.sku}</div>
              </div>
              <Input
                value={p.note}
                onChange={(e) => setProductNote(p.id, e.target.value)}
                placeholder="Notiz zu diesem Produkt (optional)"
                className="h-8 flex-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeProduct(p.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Entfernen"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Noch keine Produkte ausgewählt.</p>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-4">
        <Label>Firmen (optional)</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={companyQuery}
            onChange={(e) => searchCompanies(e.target.value)}
            placeholder="Firma suchen — Name oder Kundennummer..."
            className="pl-8"
          />
        </div>
        {companyOptions.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {companyOptions.map((c) => (
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

      {selectedCompanies.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {selectedCompanies.map((c) => (
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
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving" || !canSubmit}>
          {status === "saving"
            ? "Speichern..."
            : `Liste erstellen (${selectedProducts.length} Produkte, ${selectedCompanies.length} Firmen)`}
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
