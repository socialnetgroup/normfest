import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !product) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{product.name}</h1>
          {product.category_name ? <Badge variant="secondary">{product.category_name}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {product.sku}
          {product.subcategory ? ` · ${product.subcategory}` : ""}
          {product.source_page ? ` · Katalogseite ${product.source_page}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Art.-Nr." value={product.sku} />
            <Field label="Kategorie" value={`${product.category_code ?? ""} ${product.category_name ?? ""}`} />
            <Field label="Unterkategorie" value={product.subcategory} />
            <Field label="Packung" value={product.pack_content} />
            <Field label="Menge pro Kartonage" value={product.pack_qty} />
          </dl>
        </CardContent>
      </Card>

      {product.description ? (
        <Card>
          <CardHeader>
            <CardTitle>Produktbeschreibung</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line">{product.description}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
