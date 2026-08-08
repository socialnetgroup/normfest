import { BookOpen, MessageCircleQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

// Skript fully translated to German 2026-08-08 (Anis: "izbaciti sav
// bosanski jezik, ostvariti samo njemacki svugdje" - CLAUDE.md §14 item 36)
// via scripts/translate-skript-to-german.mjs. These structural markers are
// matched against the translated German headings/content, not the original
// Bosnian source.
const SUB_HEADING_STRUKTURA = /^Struktur\s+\d+:/i;
const SUB_HEADING_ALLCAPS = /^[A-ZÄÖÜČĆĐŠŽ][A-ZÄÖÜČĆĐŠŽ0-9\s-]{3,44}!?$/;
const SUB_HEADING_EXPLICIT = new Set(["Goldene Regel des Zeitplans", "Regel für Kaltakquise"]);
const LANG_PREFIX = /^(DE|BS)\b\s*(.*)$/;
const QUOTE_LINE = /^"(.+)"$/;
const LIST_ITEM = /^[-•]\s+|^\d+[.)]\s+/;
const LABEL_ONLY = /^([A-ZÄÖÜČĆĐŠŽ][^\n:]{1,40}):$/;
const LEAD_IN = /^([A-ZÄÖÜČĆĐŠŽ][^\n:]{0,40}):\s*(.+)/;

/** Header-row -> repeating-row tables that were flattened to plain text during
 * KB extraction. Matched by exact heading; header line sequence is searched
 * for anywhere in the chunk (there's usually an intro sentence before it). */
const TABLE_SPECS: Record<
  string,
  { headers: string[]; rowCount?: number; rowValidator?: (row: string[]) => boolean }
> = {
  "1. Dein Arbeitstag - Tagesablauf": {
    headers: ["Zeit", "Aktivität"],
    rowValidator: (row) => /^\d{2}:\d{2}/.test(row[0]),
  },
  "5. Abschlusstechniken": {
    headers: ["Technik", "Beispiel"],
    rowCount: 5,
  },
  "6. Verkaufsvokabular - Wortersatz": {
    headers: ["VERMEIDEN", "VERWENDEN", "Beispiel"],
    rowCount: 17,
  },
  "7. Anrufkodierung - nach JEDEM Anruf verpflichtend": {
    headers: ["Code", "Bedeutung", "Was tust du?"],
  },
};

function findSequence(lines: string[], seq: string[]): number {
  for (let i = 0; i <= lines.length - seq.length; i++) {
    if (seq.every((s, j) => lines[i + j] === s)) return i;
  }
  return -1;
}

function extractTableRows(
  body: string[],
  colCount: number,
  opts: { rowCount?: number; rowValidator?: (row: string[]) => boolean },
): { rows: string[][]; rest: string[] } {
  const rows: string[][] = [];
  let idx = 0;
  while (idx + colCount <= body.length) {
    if (opts.rowCount !== undefined && rows.length >= opts.rowCount) break;
    const group = body.slice(idx, idx + colCount);
    if (opts.rowValidator && !opts.rowValidator(group)) break;
    rows.push(group);
    idx += colCount;
  }
  return { rows, rest: body.slice(idx) };
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/60">
            {headers.map((h, i) => (
              <th
                key={i}
                className="border-b border-foreground/10 px-3 py-2 text-left text-xs font-bold tracking-wide text-muted-foreground uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-muted/20" : undefined}>
              {row.map((cell, ci) => (
                <td key={ci} className="border-b border-foreground/5 px-3 py-2 align-top leading-relaxed">
                  {cell.replace(QUOTE_LINE, "$1")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders a flat list of lines with structure detection: sub-heading
 * dividers, DE/BS example-script labels, quoted script lines as blockquotes,
 * bullet lists, and "Label: rest" lead-ins get the label bolded. */
function renderLines(lines: string[], keyPrefix: string) {
  return lines.map((line, i) => {
    const key = `${keyPrefix}-${i}`;
    const isSubHeading =
      SUB_HEADING_STRUKTURA.test(line) || SUB_HEADING_ALLCAPS.test(line) || SUB_HEADING_EXPLICIT.has(line);
    if (isSubHeading) {
      return (
        <p
          key={key}
          className="mt-2.5 border-t border-border pt-2.5 text-sm font-bold text-foreground first:mt-0 first:border-t-0 first:pt-0"
        >
          {line}
        </p>
      );
    }
    const langMatch = line.match(LANG_PREFIX);
    if (langMatch) {
      const [, lang, rest] = langMatch;
      return (
        <div key={key} className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">
            {lang}
          </span>
          {rest ? <span className="text-xs font-semibold text-muted-foreground">{rest}</span> : null}
        </div>
      );
    }
    if (QUOTE_LINE.test(line)) {
      return (
        <blockquote
          key={key}
          className="rounded-md border-l-2 border-l-primary bg-muted/40 px-3 py-2 text-sm italic text-foreground"
        >
          {line.replace(QUOTE_LINE, "$1")}
        </blockquote>
      );
    }
    if (LIST_ITEM.test(line)) {
      return (
        <p
          key={key}
          className="pl-4 text-sm leading-relaxed text-muted-foreground before:mr-2 before:-ml-4 before:text-primary before:content-['•']"
        >
          {line.replace(LIST_ITEM, "")}
        </p>
      );
    }
    if (LABEL_ONLY.test(line)) {
      return (
        <p key={key} className="mt-1 text-sm font-semibold text-foreground">
          {line}
        </p>
      );
    }
    const leadIn = line.match(LEAD_IN);
    if (leadIn) {
      return (
        <p key={key} className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{leadIn[1]}:</span> {leadIn[2]}
        </p>
      );
    }
    return (
      <p key={key} className="text-sm leading-relaxed text-muted-foreground">
        {line}
      </p>
    );
  });
}

function ChunkContent({ heading, content }: { heading: string; content: string }) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const spec = TABLE_SPECS[heading];
  if (spec) {
    const start = findSequence(lines, spec.headers);
    if (start !== -1) {
      const intro = lines.slice(0, start);
      const body = lines.slice(start + spec.headers.length);
      const { rows, rest } = extractTableRows(body, spec.headers.length, spec);
      if (rows.length > 0) {
        return (
          <div className="flex flex-col gap-3">
            {renderLines(intro, "intro")}
            <TableBlock headers={spec.headers} rows={rows} />
            {renderLines(rest, "rest")}
          </div>
        );
      }
    }
  }

  return <div className="flex flex-col gap-2">{renderLines(lines, "l")}</div>;
}

/** "9. Quick Reference" is a paired title/content cheat-sheet layout, not a
 * table or flowing text - rendered as its own dedicated block. */
function QuickReferenceContent({ content }: { content: string }) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const [intro, title1, title2, content1, content2, title3, title4, content3, content4, zapamtiTitle, ...zapamtiRest] =
    lines;

  const splitNumbered = (s: string) =>
    s
      .split(/\s*(?=\d+\.\s)/)
      .map((s2) => s2.trim())
      .filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-success/10 p-3 ring-1 ring-success/20">
          <p className="mb-1.5 text-xs font-bold tracking-wide text-success uppercase">{title1}</p>
          <ul className="flex flex-col gap-1">
            {splitNumbered(content1).map((item, i) => (
              <li key={i} className="text-sm text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-destructive/10 p-3 ring-1 ring-destructive/20">
          <p className="mb-1.5 text-xs font-bold tracking-wide text-destructive uppercase">{title2}</p>
          <ul className="flex flex-col gap-1">
            {splitNumbered(content2).map((item, i) => (
              <li key={i} className="text-sm text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 ring-1 ring-foreground/10">
          <p className="mb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">{title3}</p>
          <p className="text-sm leading-relaxed text-foreground">{content3}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 ring-1 ring-foreground/10">
          <p className="mb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">{title4}</p>
          <p className="text-sm leading-relaxed text-foreground">{content4}</p>
        </div>
      </div>
      <div className="rounded-lg border-l-4 border-l-primary bg-primary/5 p-3">
        <p className="mb-1.5 text-xs font-bold tracking-wide text-primary uppercase">{zapamtiTitle}</p>
        <ul className="flex flex-col gap-1">
          {zapamtiRest.map((line, i) => (
            <li key={i} className="text-sm font-medium text-foreground">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default async function SkriptPage() {
  const supabase = await createClient();

  const [{ data: doc }, { data: objections }] = await Promise.all([
    supabase.from("kb_documents").select("id, title").eq("collection", "skript").is("deleted_at", null).maybeSingle(),
    supabase
      .from("objection_cards")
      .select("id, objection, response_de, category")
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  const { data: allChunks } = doc
    ? await supabase
        .from("kb_chunks")
        .select("id, heading, content")
        .eq("document_id", doc.id)
        .order("chunk_index")
    : { data: null };

  // "4. Kundeneinwände und wie man antwortet" duplicates the Einwandbehandlung
  // card above (same objections, same responses) - dropped from the full
  // guide per Anis (2026-08-01) to stop showing it twice; its opening line
  // moved into the Einwandbehandlung card itself, see below.
  const chunks = allChunks?.filter((c) => c.heading !== "4. Kundeneinwände und wie man antwortet") ?? null;

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
            <p className="text-sm text-muted-foreground">Häufige Einwände mit sofort einsetzbaren Antworten.</p>
          </CardHeader>
          <CardContent>
            <blockquote className="mb-4 rounded-md border-l-2 border-l-primary bg-muted/40 px-3 py-2 text-sm italic text-foreground">
              Denk daran: &quot;Nein&quot; ist der Anfang der Verhandlung, nicht das Ende. 80% der Kunden sagen im
              Schnitt 4-mal &quot;NEIN&quot;, bevor sie &quot;JA&quot; sagen. 92% der Agenten geben nach dem ersten
              &quot;Nein&quot; auf.
            </blockquote>
            <ul className="flex flex-col gap-3">
              {objections.map((o) => (
                <li key={o.id} className="rounded-lg border-l-4 border-l-warning bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">{o.objection}</Badge>
                  </div>
                  <p className="mt-2.5 rounded-md bg-card p-2.5 text-sm ring-1 ring-foreground/10">
                    {o.response_de}
                  </p>
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
                  {c.heading === "9. Quick Reference" ? (
                    <QuickReferenceContent content={c.content} />
                  ) : (
                    <ChunkContent heading={c.heading ?? ""} content={c.content} />
                  )}
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
