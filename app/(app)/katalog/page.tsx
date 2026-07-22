import { Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";

const RESULT_LIMIT = 30;

export default async function KatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kategorie?: string }>;
}) {
  const { q, kategorie } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createClient();

  const [categoriesResult, results] = await Promise.all([
    supabase.from("product_categories").select("category_code, category_name").order("category_code"),
    query.length >= 2 || kategorie
      ? (() => {
          let builder = supabase
            .from("products")
            .select("id, sku, name, category_name, subcategory, pack_content")
            .order("name")
            .limit(RESULT_LIMIT);
          if (query.length >= 2) {
            builder = builder.or(`name.ilike.%${query}%,sku.ilike.%${query}%`);
          }
          if (kategorie) {
            builder = builder.eq("category_code", kategorie);
          }
          return builder;
        })()
      : Promise.resolve(null),
  ]);

  const categories = new Map<string, string>();
  for (const row of categoriesResult.data ?? []) {
    if (row.category_code && row.category_name) categories.set(row.category_code, row.category_name);
  }
  const sortedCategories = [...categories.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Katalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suche nach Produktname oder Art.-Nr., oder wähle eine Kategorie.
        </p>
      </div>

      <form action="/katalog" className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="z.B. Bremsenreiniger, 2894-445-1..."
              autoFocus
              className="h-10 pl-8 text-base"
            />
          </div>
          <Button type="submit" size="lg" className="h-10">
            Suchen
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href="/katalog">
            <Badge variant={!kategorie ? "default" : "secondary"}>Alle</Badge>
          </Link>
          {sortedCategories.map(([code, name]) => (
            <Link key={code} href={`/katalog?kategorie=${code}`}>
              <Badge variant={kategorie === code ? "default" : "secondary"}>
                {code} {name}
              </Badge>
            </Link>
          ))}
        </div>
      </form>

      {query.length > 0 && query.length < 2 ? (
        <p className="text-sm text-muted-foreground">Bitte mindestens 2 Zeichen eingeben.</p>
      ) : null}

      {results?.error ? (
        <p className="text-sm text-destructive" role="alert">
          Fehler bei der Suche: {results.error.message}
        </p>
      ) : null}

      {results?.data ? (
        results.data.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-y">
              {results.data.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/katalog/${product.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{product.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {product.sku}
                        {product.subcategory ? ` · ${product.subcategory}` : ""}
                        {product.pack_content ? ` · ${product.pack_content}` : ""}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {product.category_name}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Produkte gefunden.</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Suche etwas oder wähle eine Kategorie, um Produkte zu sehen.
        </p>
      )}
    </div>
  );
}
