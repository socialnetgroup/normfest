import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { computeDialerTotals, formatSecondsAsHms, type DialerAgentSummary } from "@/lib/dialer/status";
import { cn } from "@/lib/utils";

// Extracted from app/(app)/dialer/page.tsx (2026-08-08) so the live table and
// the daily-snapshot history viewer render identically instead of drifting
// apart - both consume the same DialerAgentSummary[] shape (buildDialerAgentSummaries()
// output, live or from a stored dialer_daily_snapshots row).
const STATUS_ORDER: Record<string, number> = { INCALL: 0, DISPO: 1, PAUSED: 2 };

function statusVariant(status: string): "success" | "default" | "warning" | "muted" {
  const s = status.toUpperCase();
  if (s === "INCALL") return "success";
  if (s === "DISPO") return "default";
  if (s === "PAUSED") return "warning";
  return "muted";
}

const STATUS_LABELS: Record<string, string> = {
  INCALL: "Im Gespräch",
  DISPO: "Nachbearbeitung",
  PAUSED: "Pause",
  OFFLINE: "Abgemeldet",
};

const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rate = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const COLUMN_GROUPS = [
  { label: "Agent", span: 3 },
  { label: "Volumen", span: 2 },
  { label: "Ergebnis", span: 3 },
  { label: "Effizienz", span: 2 },
  { label: "Zeitverteilung", span: 5 },
  { label: "Aktivität", span: 3 },
];

export function DialerStatusTable({ rows, sortByStatus = false }: { rows: DialerAgentSummary[]; sortByStatus?: boolean }) {
  const sortedRows = sortByStatus
    ? [...rows].sort((a, b) => {
        const pa = STATUS_ORDER[a.status.toUpperCase()] ?? 99;
        const pb = STATUS_ORDER[b.status.toUpperCase()] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.fullName.localeCompare(b.fullName);
      })
    : [...rows].sort((a, b) => a.fullName.localeCompare(b.fullName));

  if (sortedRows.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Agenten-Daten vorhanden.</p>;
  }

  const totals = computeDialerTotals(sortedRows);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {COLUMN_GROUPS.map((g, i) => (
              <th
                key={g.label}
                colSpan={g.span}
                className={cn(
                  "px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase",
                  i > 0 && "border-l",
                )}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            <th className="px-2 py-2 font-medium">Agent</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Zeit im Status</th>
            <th className="border-l px-2 py-2 font-medium">Anrufe</th>
            <th className="px-2 py-2 font-medium">Anrufe/Std.</th>
            <th className="border-l px-2 py-2 font-medium">Sales</th>
            <th className="px-2 py-2 font-medium">Konversion</th>
            <th className="px-2 py-2 font-medium">Verkäufe/Std.</th>
            <th className="border-l px-2 py-2 font-medium">Ø Bearbeitungszeit</th>
            <th className="px-2 py-2 font-medium">Auslastung</th>
            <th className="border-l px-2 py-2 font-medium">Sprechzeit</th>
            <th className="px-2 py-2 font-medium">Wartezeit</th>
            <th className="px-2 py-2 font-medium">Nachbearbeitung</th>
            <th className="px-2 py-2 font-medium">Pausenzeit</th>
            <th className="px-2 py-2 font-medium">Totzeit</th>
            <th className="border-l px-2 py-2 font-medium">Gesamtzeit</th>
            <th className="px-2 py-2 font-medium">Aktiv</th>
            <th className="px-2 py-2 font-medium">Inaktiv</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sortedRows.map((a) => (
            <tr key={a.agentId}>
              <td className="px-2 py-2 font-medium">
                <Link href={`/admin/team/${a.agentId}`} className="hover:underline">
                  {a.fullName}
                </Link>
              </td>
              <td className="px-2 py-2">
                <Badge variant={statusVariant(a.status)}>{STATUS_LABELS[a.status.toUpperCase()] ?? a.status}</Badge>
              </td>
              <td className="px-2 py-2 tabular-nums">{a.timeInStatus}</td>
              <td className="border-l px-2 py-2 tabular-nums">{a.totalCalls}</td>
              <td className="px-2 py-2 tabular-nums">{rate.format(a.callsPerHour)}</td>
              <td className="border-l px-2 py-2 tabular-nums">{a.realSales}</td>
              <td className="px-2 py-2 tabular-nums">{pct.format(a.conversion)}</td>
              <td className="px-2 py-2 tabular-nums">{rate.format(a.salesPerHour)}</td>
              <td className="border-l px-2 py-2 tabular-nums">{formatSecondsAsHms(a.ahtSeconds)}</td>
              <td className="px-2 py-2 tabular-nums">{pct.format(a.occupancy)}</td>
              <td className="border-l px-2 py-2 tabular-nums">{a.talkTime}</td>
              <td className="px-2 py-2 tabular-nums">{a.waitTime}</td>
              <td className="px-2 py-2 tabular-nums">{a.dispoTime}</td>
              <td className="px-2 py-2 tabular-nums">
                {a.pauseTime} <span className="text-muted-foreground">({pct.format(a.pauseShare)})</span>
              </td>
              <td className="px-2 py-2 tabular-nums">
                {a.deadTime} <span className="text-muted-foreground">({pct.format(a.deadShare)})</span>
              </td>
              <td className="border-l px-2 py-2 tabular-nums">{a.totalTime}</td>
              <td
                className={cn(
                  "px-2 py-2 tabular-nums",
                  a.status.toUpperCase() === "PAUSED" ? "text-muted-foreground" : "text-success-foreground",
                )}
              >
                {a.activeTime}
              </td>
              <td className="px-2 py-2 tabular-nums text-muted-foreground">{a.inactiveTime}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="px-2 py-2">Gesamt</td>
            <td className="px-2 py-2 text-muted-foreground">
              <span className="text-xs font-normal">{sortedRows.length} Agenten</span>
            </td>
            <td className="px-2 py-2" />
            <td className="border-l px-2 py-2 tabular-nums">{totals.totalCalls}</td>
            <td className="px-2 py-2 tabular-nums">{rate.format(totals.callsPerHour)}</td>
            <td className="border-l px-2 py-2 tabular-nums">{totals.realSales}</td>
            <td className="px-2 py-2 tabular-nums">{pct.format(totals.conversion)}</td>
            <td className="px-2 py-2 tabular-nums">{rate.format(totals.salesPerHour)}</td>
            <td className="border-l px-2 py-2 tabular-nums">{formatSecondsAsHms(totals.ahtSeconds)}</td>
            <td className="px-2 py-2 tabular-nums">{pct.format(totals.occupancy)}</td>
            <td className="border-l px-2 py-2 tabular-nums">{formatSecondsAsHms(totals.talkSeconds)}</td>
            <td className="px-2 py-2 tabular-nums">{formatSecondsAsHms(totals.waitSeconds)}</td>
            <td className="px-2 py-2 tabular-nums">{formatSecondsAsHms(totals.dispoSeconds)}</td>
            <td className="px-2 py-2 tabular-nums">
              {formatSecondsAsHms(totals.pauseSeconds)}{" "}
              <span className="font-normal text-muted-foreground">({pct.format(totals.pauseShare)})</span>
            </td>
            <td className="px-2 py-2 tabular-nums">
              {formatSecondsAsHms(totals.deadSeconds)}{" "}
              <span className="font-normal text-muted-foreground">({pct.format(totals.deadShare)})</span>
            </td>
            <td className="border-l px-2 py-2 tabular-nums">{formatSecondsAsHms(totals.totalSeconds)}</td>
            <td className="px-2 py-2 tabular-nums text-success-foreground">
              {formatSecondsAsHms(totals.activeSeconds)}{" "}
              <span className="font-normal text-muted-foreground">({pct.format(totals.activeShare)})</span>
            </td>
            <td className="px-2 py-2 tabular-nums text-muted-foreground">
              {formatSecondsAsHms(totals.inactiveSeconds)}{" "}
              <span className="font-normal">({pct.format(1 - totals.activeShare)})</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
