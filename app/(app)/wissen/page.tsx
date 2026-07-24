import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";

export default async function WissenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createClient();

  const { count: documentCount } = await supabase
    .from("kb_documents")
    .select("id", { count: "exact", head: true })
    .eq("collection", "wissen")
    .is("deleted_at", null);

  const results =
    query.length >= 2
      ? await supabase
          .from("kb_chunks")
          .select("id, heading, content, kb_documents!inner(title, collection)")
          .eq("kb_documents.collection", "wissen")
          .textSearch("search_vector", query, { type: "websearch", config: "simple" })
          .limit(20)
      : null;

  const browseDocs =
    query.length === 0 && documentCount && documentCount > 0
      ? await supabase
          .from("kb_documents")
          .select("id, title, kb_chunks(id, chunk_index, heading, content)")
          .eq("collection", "wissen")
          .is("deleted_at", null)
          .order("created_at")
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Wissen</h1>
        <p className="mt-1 text-sm text-muted-foreground">Produkt- und Firmenwissen durchsuchen.</p>
      </div>

      <form action="/wissen" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Suchbegriff eingeben..."
            autoFocus
            className="h-10 pl-8 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="h-10">
          Suchen
        </Button>
      </form>

      {documentCount === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Noch kein Wissen-Material importiert.
          </CardContent>
        </Card>
      ) : null}

      {query.length > 0 && query.length < 2 ? (
        <p className="text-sm text-muted-foreground">Bitte mindestens 2 Zeichen eingeben.</p>
      ) : null}

      {results?.data ? (
        results.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            {results.data.map((r) => (
              <Card key={r.id}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{r.heading}</CardTitle>
                    <Badge variant="secondary">
                      {(r.kb_documents as unknown as { title: string }).title}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{r.content}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Treffer für &ldquo;{query}&rdquo;.</p>
        )
      ) : null}

      {browseDocs?.data ? (
        <div className="flex flex-col gap-6">
          {browseDocs.data.map((doc) => {
            const chunks = [...doc.kb_chunks].sort((a, b) => a.chunk_index - b.chunk_index);
            return (
              <Card key={doc.id}>
                <CardHeader>
                  <CardTitle className="text-base">{doc.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col divide-y">
                    {chunks.map((c) => (
                      <section key={c.id} className="py-3 first:pt-0">
                        <h3 className="mb-1 font-heading text-sm font-semibold">{c.heading}</h3>
                        <p className="whitespace-pre-line text-sm text-muted-foreground">{c.content}</p>
                      </section>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
