"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { FeedbackHistoryItem } from "@/components/feedback-history-item";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type FeedbackRow = React.ComponentProps<typeof FeedbackHistoryItem>;

// Anis (2026-08-14): "Komprimirati verkauf kad upisujemo Artikal po
// artikal pojavi se npr 3 verkaufa al je jedan u sustini sa 3 pozicije" -
// the DB still holds one real row per position (unchanged, per Anis's own
// explicit call to keep writing "jedno po jedno"), this is purely a
// display grouping via the shared batch_id (lib/feedback-grouping.ts).
// Collapsed by default; expanding renders the exact same, unmodified
// FeedbackHistoryItem per row - so every existing edit/delete/Wiedervorlage
// affordance keeps working precisely as it does for an ungrouped entry.
export function FeedbackSoldGroup({ rows }: { rows: FeedbackRow[] }) {
  const [open, setOpen] = useState(false);
  const first = rows[0];
  const total = rows.reduce((sum, r) => sum + (r.valueNet ?? 0), 0);

  return (
    <li className="flex flex-col gap-2 border-t py-2.5 text-base first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {first.companyName ? (
            <p className="mb-0.5">
              {first.companyId ? (
                <Link href={`/firmen/${first.companyId}`} className="font-medium text-primary hover:underline">
                  {first.companyName}
                </Link>
              ) : (
                <span className="font-medium">{first.companyName}</span>
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Verkauft</Badge>
            <span className="font-medium">
              {rows.length} Position{rows.length === 1 ? "" : "en"}
            </span>
            {total ? <span className="text-muted-foreground">{eur.format(total)}</span> : null}
          </div>
          {first.comment ? <p className="mt-1 text-muted-foreground">{first.comment}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {first.adminAgentLink ? (
              <Link href={first.adminAgentLink} className="hover:underline">
                {first.agentName}
              </Link>
            ) : (
              first.agentName
            )}{" "}
            · {dateTimeFmt.format(new Date(first.createdAt))}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1 text-sm text-primary hover:underline"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {open ? "Positionen ausblenden" : "Positionen anzeigen"}
      </button>
      {open ? (
        <ul className="flex flex-col divide-y border-l-2 border-l-muted pl-3">
          {rows.map((row) => (
            <FeedbackHistoryItem key={row.id} {...row} companyId={undefined} companyName={undefined} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
