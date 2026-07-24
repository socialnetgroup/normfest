import { BookOpen, MessageCircleQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const LEAD_IN = /^([A-ZÄÖÜ][A-ZÄÖÜ\s]{2,20}):\s*(.+)/;
const LIST_ITEM = /^[-•]\s+|^\d+[.)]\s+/;

/** Renders a chunk's plain-text content with real paragraph spacing instead of
 * one dense whitespace-pre-line blob, plus light structure detection: list-like
 * lines get a bullet, "WORD: rest" lead-ins get the lead-in bolded. */
function ChunkContent({ content }: { content: string }) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, i) => {
        const leadIn = line.match(LEAD_IN);
        const isListItem = LIST_ITEM.test(line);
        if (isListItem) {
          return (
            <p key={i} className="pl-4 text-sm leading-relaxed text-muted-foreground before:mr-2 before:-ml-4 before:text-primary before:content-['•']">
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

export default async function SkriptPage() {
  const supabase = await createClient();

  const [{ data: doc }, { data: objections }] = await Promise.all([
    supabase.from("kb_documents").select("id, title").eq("collection", "skript").is("deleted_at", null).maybeSingle(),
    supabase
      .from("objection_cards")
      .select("id, objection, response_bs, response_de, category")
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  const { data: chunks } = doc
    ? await supabase
        .from("kb_chunks")
        .select("id, heading, content")
        .eq("document_id", doc.id)
        .order("chunk_index")
    : { data: null };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Skript</h1>
        <p className="mt-1 text-sm text-muted-foreground">{doc?.title ?? "Agent Sales Guide"}</p>
      </div>

      {objections && objections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleQuestion className="size-4 text-primary" />
              Einwandbehandlung
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Häufige Einwände mit sofort einsetzbaren Antworten (BS + DE).
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {objections.map((o) => (
                <li key={o.id} className="rounded-lg border-l-4 border-l-warning bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">{o.objection}</Badge>
                  </div>
                  <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-card p-2.5 ring-1 ring-foreground/10">
                      <p className="mb-1 text-xs font-bold tracking-wide text-primary uppercase">BS</p>
                      <p className="text-sm">{o.response_bs}</p>
                    </div>
                    <div className="rounded-md bg-card p-2.5 ring-1 ring-foreground/10">
                      <p className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">DE</p>
                      <p className="text-sm">{o.response_de}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {chunks && chunks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              Vollständiger Guide
            </CardTitle>
          </CardHeader>
          <CardContent>
            <nav className="mb-6 flex flex-col gap-1 rounded-lg bg-muted/30 p-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1.5">
              {chunks.map((c) => (
                <a key={c.id} href={`#${c.id}`} className="text-primary hover:underline">
                  {c.heading}
                </a>
              ))}
            </nav>
            <div className="flex flex-col gap-8">
              {chunks.map((c) => (
                <section key={c.id} id={c.id} className="scroll-mt-20 border-l-4 border-l-primary/30 pl-4">
                  <h3 className="mb-3 font-heading text-lg font-bold tracking-tight">{c.heading}</h3>
                  <ChunkContent content={c.content} />
                </section>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Skript noch nicht importiert.</p>
      )}
    </div>
  );
}
