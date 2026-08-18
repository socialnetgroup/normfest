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

const STATUS_LABELS: Record<"de" | "bs", Record<string, string>> = {
  de: {
    INCALL: "Im Gespräch",
    DISPO: "Nachbearbeitung",
    PAUSED: "Pause",
    OFFLINE: "Abgemeldet",
  },
  bs: {
    INCALL: "U razgovoru",
    DISPO: "Naknadna obrada",
    PAUSED: "Pauza",
    OFFLINE: "Odjavljen",
  },
};

const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rate = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const COLUMN_GROUPS: Record<"de" | "bs", { label: string; span: number }[]> = {
  de: [
    { label: "Agent", span: 3 },
    { label: "Volumen", span: 2 },
    { label: "Ergebnis", span: 4 },
    { label: "Effizienz", span: 2 },
    { label: "Zeitverteilung", span: 5 },
    { label: "Aktivität", span: 3 },
  ],
  bs: [
    { label: "Agent", span: 3 },
    { label: "Obim", span: 2 },
    { label: "Rezultat", span: 4 },
    { label: "Efikasnost", span: 2 },
    { label: "Raspodjela vremena", span: 5 },
    { label: "Aktivnost", span: 3 },
  ],
};

// "Positionen"/"Pozicije" added 2026-08-18 (Anis: "to bi trebalo biti 1
// prodaja 6 pozicija... u dialeru oboje prikazati") right after Sales/
// Prodaje - the real distinct-sale count and the real line-item count are
// now two separate numbers instead of one column conflating them.
const COLUMN_HEADERS: Record<"de" | "bs", string[]> = {
  de: [
    "Agent",
    "Status",
    "Zeit im Status",
    "Anrufe",
    "Anrufe/Std.",
    "Sales",
    "Positionen",
    "Konversion",
    "Verkäufe/Std.",
    "Ø Bearbeitungszeit",
    "Auslastung",
    "Sprechzeit",
    "Wartezeit",
    "Nachbearbeitung",
    "Pausenzeit",
    "Totzeit",
    "Gesamtzeit",
    "Aktiv",
    "Inaktiv",
  ],
  bs: [
    "Agent",
    "Status",
    "Vrijeme u statusu",
    "Pozivi",
    "Pozivi/h",
    "Prodaje",
    "Pozicije",
    "Konverzija",
    "Prodaje/h",
    "Ø vrijeme obrade",
    "Zauzetost",
    "Vrijeme razgovora",
    "Vrijeme čekanja",
    "Naknadna obrada",
    "Pauza",
    "Mrtvo vrijeme",
    "Ukupno vrijeme",
    "Aktivno",
    "Neaktivno",
  ],
};

const NO_DATA_LABEL: Record<"de" | "bs", string> = {
  de: "Keine Agenten-Daten vorhanden.",
  bs: "Nema podataka o agentima.",
};

const TOTAL_LABEL: Record<"de" | "bs", string> = { de: "Gesamt", bs: "Ukupno" };
const AGENTS_SUFFIX: Record<"de" | "bs", string> = { de: "Agenten", bs: "agenata" };

export function DialerStatusTable({
  rows,
  sortByStatus = false,
  locale = "de",
  agentHref = (id: string) => `/admin/team/${id}`,
}: {
  rows: DialerAgentSummary[];
  sortByStatus?: boolean;
  /** report@ gets Bosnian labels + report-safe agent links (2026-08-17, Anis:
   * "Dialer informacije na Report takodjer prevedi na bosanski") - admin's
   * own view of this same shared table stays German, default "de". */
  locale?: "de" | "bs";
  agentHref?: (agentId: string) => string;
}) {
  const sortedRows = sortByStatus
    ? [...rows].sort((a, b) => {
        const pa = STATUS_ORDER[a.status.toUpperCase()] ?? 99;
        const pb = STATUS_ORDER[b.status.toUpperCase()] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.fullName.localeCompare(b.fullName);
      })
    : [...rows].sort((a, b) => a.fullName.localeCompare(b.fullName));

  if (sortedRows.length === 0) {
    return <p className="text-sm text-muted-foreground">{NO_DATA_LABEL[locale]}</p>;
  }

  const totals = computeDialerTotals(sortedRows);
  const groups = COLUMN_GROUPS[locale];
  const headers = COLUMN_HEADERS[locale];
  const statusLabels = STATUS_LABELS[locale];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {groups.map((g, i) => (
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
            <th className="px-2 py-2 font-medium">{headers[0]}</th>
            <th className="px-2 py-2 font-medium">{headers[1]}</th>
            <th className="px-2 py-2 font-medium">{headers[2]}</th>
            <th className="border-l px-2 py-2 font-medium">{headers[3]}</th>
            <th className="px-2 py-2 font-medium">{headers[4]}</th>
            <th className="border-l px-2 py-2 font-medium">{headers[5]}</th>
            <th className="px-2 py-2 font-medium">{headers[6]}</th>
            <th className="px-2 py-2 font-medium">{headers[7]}</th>
            <th className="px-2 py-2 font-medium">{headers[8]}</th>
            <th className="border-l px-2 py-2 font-medium">{headers[9]}</th>
            <th className="px-2 py-2 font-medium">{headers[10]}</th>
            <th className="border-l px-2 py-2 font-medium">{headers[11]}</th>
            <th className="px-2 py-2 font-medium">{headers[12]}</th>
            <th className="px-2 py-2 font-medium">{headers[13]}</th>
            <th className="px-2 py-2 font-medium">{headers[14]}</th>
            <th className="px-2 py-2 font-medium">{headers[15]}</th>
            <th className="border-l px-2 py-2 font-medium">{headers[16]}</th>
            <th className="px-2 py-2 font-medium">{headers[17]}</th>
            <th className="px-2 py-2 font-medium">{headers[18]}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sortedRows.map((a) => (
            <tr key={a.agentId}>
              <td className="px-2 py-2 font-medium">
                <Link href={agentHref(a.agentId)} className="hover:underline">
                  {a.fullName}
                </Link>
              </td>
              <td className="px-2 py-2">
                <Badge variant={statusVariant(a.status)}>{statusLabels[a.status.toUpperCase()] ?? a.status}</Badge>
              </td>
              <td className="px-2 py-2 tabular-nums">{a.timeInStatus}</td>
              <td className="border-l px-2 py-2 tabular-nums">{a.totalCalls}</td>
              <td className="px-2 py-2 tabular-nums">{rate.format(a.callsPerHour)}</td>
              <td className="border-l px-2 py-2 tabular-nums">{a.realSales}</td>
              <td className="px-2 py-2 tabular-nums text-muted-foreground">{a.salePositions}</td>
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
            <td className="px-2 py-2">{TOTAL_LABEL[locale]}</td>
            <td className="px-2 py-2 text-muted-foreground">
              <span className="text-xs font-normal">
                {sortedRows.length} {AGENTS_SUFFIX[locale]}
              </span>
            </td>
            <td className="px-2 py-2" />
            <td className="border-l px-2 py-2 tabular-nums">{totals.totalCalls}</td>
            <td className="px-2 py-2 tabular-nums">{rate.format(totals.callsPerHour)}</td>
            <td className="border-l px-2 py-2 tabular-nums">{totals.realSales}</td>
            <td className="px-2 py-2 tabular-nums text-muted-foreground">{totals.salePositions}</td>
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
