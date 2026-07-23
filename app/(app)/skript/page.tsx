import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

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
            <CardTitle>Einwandbehandlung</CardTitle>
            <p className="text-sm text-muted-foreground">
              Häufige Einwände mit sofort einsetzbaren Antworten (BS + DE).
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {objections.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{o.objection}</Badge>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">BS</p>
                      <p className="text-sm">{o.response_bs}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">DE</p>
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
            <CardTitle>Vollständiger Guide</CardTitle>
          </CardHeader>
          <CardContent>
            <nav className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {chunks.map((c) => (
                <a key={c.id} href={`#${c.id}`} className="text-primary hover:underline">
                  {c.heading}
                </a>
              ))}
            </nav>
            <div className="flex flex-col divide-y">
              {chunks.map((c) => (
                <section key={c.id} id={c.id} className="scroll-mt-20 py-4">
                  <h3 className="mb-1.5 font-heading text-base font-semibold">{c.heading}</h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{c.content}</p>
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
