import { notFound } from "next/navigation";
import { Copy } from "lucide-react";

import { KatalogDedupReview } from "@/components/katalog-dedup-review";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function KatalogDedupPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("product_duplicate_candidates")
    .select(
      "id, similarity, product_a:products!product_duplicate_candidates_product_a_id_fkey(id, sku, name, category_name, source), product_b:products!product_duplicate_candidates_product_b_id_fkey(id, sku, name, category_name, source)",
    )
    .eq("status", "pending")
    .order("similarity", { ascending: false });

  type ProductInfo = { id: string; sku: string; name: string; category_name: string | null; source: string | null };
  type Row = { id: string; similarity: number; product_a: ProductInfo | null; product_b: ProductInfo | null };

  const candidates = ((rows as Row[] | null) ?? []).filter(
    (r): r is Row & { product_a: ProductInfo; product_b: ProductInfo } => !!r.product_a && !!r.product_b,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Katalog-Dedup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vermutete Duplikate zwischen PDF-Katalog und Webshop-Import (§13 M4). Namens-basiert erkannt, nichts
          wird automatisch zusammengeführt oder gelöscht - jede Zeile braucht deine Bestätigung.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="size-4 text-primary" />
            Offene Kandidaten ({candidates.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <KatalogDedupReview candidates={candidates} />
        </CardContent>
      </Card>
    </div>
  );
}
