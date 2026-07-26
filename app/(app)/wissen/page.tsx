import { BookOpen, Lightbulb, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";

const LEAD_IN = /^([A-ZÄÖÜ][A-ZÄÖÜ\s]{2,30}):\s*(.+)/;
const LIST_ITEM = /^[-•]\s+|^\d+[.)]\s+/;

/** Same paragraph/bullet/lead-in rendering as Skript's ChunkContent, so both
 * knowledge areas read consistently instead of one being a dense blob. */
function ChunkContent({ content }: { content: string }) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, i) => {
        const leadIn = line.match(LEAD_IN);
        const isListItem = LIST_ITEM.test(line);
        if (isListItem) {
          return (
            <p
              key={i}
              className="pl-4 text-sm leading-relaxed text-muted-foreground before:mr-2 before:-ml-4 before:text-primary before:content-['•']"
            >
              {line.replace(LIST_ITEM, "")}
            </p>
          );
        }
        if (leadIn) {
          return (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{leadIn[1]}:</span> {leadIn[2]}
            </p>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">
            {line}
          </p>
        );
      })}
    </div>
  );
}

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
      <div className="flex items-center gap-2.5">
        <Lightbulb className="size-6 text-primary" />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Wissen</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Produkt- und Firmenwissen durchsuchen.</p>
        </div>
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
              <div key={r.id} className="rounded-lg border-l-4 border-l-primary/40 bg-card p-4 ring-1 ring-foreground/10">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="font-heading text-base font-bold tracking-tight">{r.heading}</h3>
                  <Badge variant="secondary">{(r.kb_documents as unknown as { title: string }).title}</Badge>
                </div>
                <ChunkContent content={r.content} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Treffer für &ldquo;{query}&rdquo;.</p>
        )
      ) : null}

      {browseDocs?.data ? (
        <>
          {browseDocs.data.length > 1 ? (
            <nav className="flex flex-col gap-1 rounded-lg bg-muted/30 p-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1.5">
              {browseDocs.data.map((doc) => (
                <a key={doc.id} href={`#doc-${doc.id}`} className="text-primary hover:underline">
                  {doc.title}
                </a>
              ))}
            </nav>
          ) : null}
          <div className="flex flex-col gap-6">
            {browseDocs.data.map((doc) => {
              const chunks = [...doc.kb_chunks].sort((a, b) => a.chunk_index - b.chunk_index);
              return (
                <Card key={doc.id} id={`doc-${doc.id}`} className="scroll-mt-20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="size-4 text-primary" />
                      {doc.title}
                      <Badge variant="secondary">{chunks.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-6">
                      {chunks.map((c) => (
                        <section key={c.id} className="border-l-4 border-l-primary/30 pl-4">
                          <h3 className="mb-2 font-heading text-base font-bold tracking-tight">{c.heading}</h3>
                          <ChunkContent content={c.content} />
                        </section>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
