"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { createClient } from "@/lib/supabase/client";

type ProductInfo = {
  id: string;
  sku: string;
  name: string;
  category_name: string | null;
  source: string | null;
};

type Candidate = {
  id: string;
  similarity: number;
  product_a: ProductInfo;
  product_b: ProductInfo;
};

function ProductCard({ product }: { product: ProductInfo }) {
  return (
    <div className="flex-1 rounded-lg border p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="secondary">{product.source === "catalog_pdf" ? "PDF-Katalog" : "Webshop"}</Badge>
        <span className="text-xs text-muted-foreground">{product.sku}</span>
      </div>
      <p className="text-sm font-medium">{product.name}</p>
      {product.category_name ? <p className="text-xs text-muted-foreground">{product.category_name}</p> : null}
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function merge(keepSide: "a" | "b") {
    const keep = keepSide === "a" ? candidate.product_a : candidate.product_b;
    const remove = keepSide === "a" ? candidate.product_b : candidate.product_a;
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_merge_duplicate_products", {
      p_keep_id: keep.id,
      p_remove_id: remove.id,
    });
    setPending(false);
    if (error) {
      alert(`Fehler: ${error.message}`);
      return;
    }
    setDone(true);
    router.refresh();
  }

  async function reject() {
    setPending(true);
    const supabase = createClient();
    await supabase
      .from("product_duplicate_candidates")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", candidate.id);
    setPending(false);
    setDone(true);
    router.refresh();
  }

  if (done) return null;

  return (
    <li className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <Badge variant={candidate.similarity >= 0.9 ? "success" : "warning"}>
          Ähnlichkeit {Math.round(candidate.similarity * 100)}%
        </Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ProductCard product={candidate.product_a} />
        <ProductCard product={candidate.product_b} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmButton
          size="sm"
          variant="outline"
          disabled={pending}
          onConfirm={() => merge("a")}
          confirmLabel="Wirklich zusammenführen?"
        >
          Zusammenführen (PDF-Katalog behalten)
        </ConfirmButton>
        <ConfirmButton
          size="sm"
          variant="outline"
          disabled={pending}
          onConfirm={() => merge("b")}
          confirmLabel="Wirklich zusammenführen?"
        >
          Zusammenführen (Webshop behalten)
        </ConfirmButton>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reject}>
          Kein Duplikat
        </Button>
      </div>
    </li>
  );
}

export function KatalogDedupReview({ candidates }: { candidates: Candidate[] }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine offenen Duplikat-Kandidaten.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((c) => (
        <CandidateRow key={c.id} candidate={c} />
      ))}
    </ul>
  );
}
