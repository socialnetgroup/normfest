import Image from "next/image";
import Link from "next/link";
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
      <dd className="text-sm font-medium">{value ?? "-"}</dd>
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

  const { data: relations } = await supabase
    .from("product_relations")
    .select("weight, related_product_id, products!product_relations_related_product_id_fkey(id, sku, name, image_path, image_is_representative, category_name)")
    .eq("product_id", id)
    .order("weight", { ascending: false })
    .limit(12);

  const imageUrl = product.image_path
    ? supabase.storage.from("product-images").getPublicUrl(product.image_path).data.publicUrl
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-start">
        {imageUrl ? (
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="flex size-32 items-center justify-center overflow-hidden rounded-lg border bg-white">
              <Image
                src={imageUrl}
                alt={product.name}
                width={128}
                height={128}
                className="size-full object-contain p-2"
                unoptimized
              />
            </div>
            {product.image_is_representative ? (
              <Badge variant="secondary" className="justify-center text-[10px]" title="Kein eigenes Foto vorhanden - Beispielbild eines ähnlichen Produkts.">
                Beispielbild
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
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

      {relations && relations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Könnte auch interessieren</CardTitle>
            <p className="text-sm text-muted-foreground">
              Laut normfest-shop.com &ldquo;Könnte Sie auch interessieren&rdquo;.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {relations.map((r) => {
                const related = r.products as {
                  id: string;
                  sku: string;
                  name: string;
                  image_path: string | null;
                  image_is_representative: boolean;
                  category_name: string | null;
                } | null;
                if (!related) return null;
                const relatedImageUrl = related.image_path
                  ? supabase.storage.from("product-images").getPublicUrl(related.image_path).data.publicUrl
                  : null;
                return (
                  <Link
                    key={related.id}
                    href={`/katalog/${related.id}`}
                    className="flex flex-col gap-2 rounded-lg border p-2.5 transition-colors hover:bg-accent"
                  >
                    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-white">
                      {relatedImageUrl ? (
                        <Image
                          src={relatedImageUrl}
                          alt={related.name}
                          width={96}
                          height={96}
                          className="size-full object-contain p-1.5"
                          unoptimized
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Kein Bild</span>
                      )}
                      {related.image_is_representative ? (
                        <span
                          className="absolute right-1 bottom-1 rounded bg-secondary/90 px-1 py-0.5 text-[9px] leading-none text-secondary-foreground"
                          title="Beispielbild eines ähnlichen Produkts"
                        >
                          Beispiel
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{related.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{related.sku}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
