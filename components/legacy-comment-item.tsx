import { Badge } from "@/components/ui/badge";

const dateTimeFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

// Real historical call notes from a decommissioned ticketing system (§14
// item 135) - merged chronologically into the same Feedback-Verlauf list
// as real sales_feedback rows, per Anis's own "hronoloski ako ima novih
// komentara u toolu" ask, but visually distinguished (muted, dashed left
// border, own badge) so it's never mistaken for this app's own structured
// feedback (§3.2.6 "never silently mix data sources"). Read-only - no
// edit/delete, this is historical record from before this app existed.
export function LegacyCommentItem({
  comment,
  occurredAt,
  agentName,
}: {
  comment: string;
  occurredAt: string;
  agentName: string | null;
}) {
  return (
    <li className="flex items-start gap-2 border-l-2 border-l-muted-foreground/30 py-2.5 pl-3 text-base">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">Historisch (altes System)</Badge>
        </div>
        <p className="mt-1 text-muted-foreground">{comment}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {agentName ?? "Unbekannt"} · {dateTimeFmt.format(new Date(occurredAt))}
        </p>
      </div>
    </li>
  );
}
