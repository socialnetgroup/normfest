import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  computeDialerTotals,
  formatSecondsAsHms,
  parseDialerTimeToSeconds,
  type DialerAgentSummary,
  type DialerAgentTotals,
} from "@/lib/dialer/status";
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

const NO_DATA_LABEL: Record<"de" | "bs", string> = {
  de: "Keine Agenten-Daten vorhanden.",
  bs: "Nema podataka o agentima.",
};

const TOTAL_LABEL: Record<"de" | "bs", string> = { de: "Gesamt", bs: "Ukupno" };
const AGENTS_SUFFIX: Record<"de" | "bs", string> = { de: "Agenten", bs: "agenata" };

const GROUP_LABELS: Record<"de" | "bs", Record<string, string>> = {
  de: {
    agent: "Agent",
    obim: "Volumen",
    rezultat: "Ergebnis",
    efikasnost: "Effizienz",
    vrijeme: "Zeitverteilung",
    aktivnost: "Aktivität",
  },
  bs: {
    agent: "Agent",
    obim: "Obim",
    rezultat: "Rezultat",
    efikasnost: "Efikasnost",
    vrijeme: "Raspodjela vremena",
    aktivnost: "Aktivnost",
  },
};

type AppStatusInfo = { label: string; badgeVariant: "success" | "secondary" | "warning" | "muted" };

type ColumnDef = {
  key: string;
  group: string;
  header: string;
  cell: (row: DialerAgentSummary) => ReactNode;
  foot: (totals: DialerAgentTotals) => ReactNode;
  /** True for columns whose Gesamt value is real even on a `reconstructed`
   * (backfilled-from-CDR) snapshot - totalCalls/realSales/salePositions/
   * conversion/talkTime. Everything else (rates needing totalHours, AHT,
   * occupancy, every other time-breakdown field) renders "-" instead of a
   * fabricated aggregate - see the `reconstructed` prop's own note. */
  alwaysReal?: boolean;
};

/** Builds the ordered column list for one render. Data-driven (rather than
 * positional headers[N] indexing, as this table used before 2026-08-18) so
 * the compact "Report" variant and the full "Admin" variant can share one
 * implementation without fragile index math - Anis: "proširiti OBIM -
 * dostupnost... obrisati vrijeme obrade... Raspodjela vremena kompletno
 * obrisati za Report view... status u alatu dodati poslije statusa u
 * dialeru, istu tabelu." */
function buildColumns(
  locale: "de" | "bs",
  variant: "full" | "compact",
  statusLabels: Record<string, string>,
  appStatusByAgentId: Map<string, AppStatusInfo> | undefined,
  agentHref: (agentId: string) => string,
): ColumnDef[] {
  const t =
    locale === "bs"
      ? {
          status: "Status",
          statusAlat: "Status u alatu",
          vrijemeStatus: "Vrijeme u statusu",
          pozivi: "Pozivi",
          poziviH: "Pozivi/h",
          dostupnost: "Ø Sprechzeit/Poziv",
          prodaje: "Prodaje",
          pozicije: "Pozicije",
          konverzija: "Konverzija",
          prodajeH: "Prodaje/h",
          obrada: "Ø vrijeme obrade",
          zauzetost: "Zauzetost",
          razgovor: "Vrijeme razgovora",
          cekanje: "Vrijeme čekanja",
          naknadna: "Naknadna obrada",
          pauza: "Pauza",
          mrtvo: "Mrtvo vrijeme",
          ukupno: "Ukupno vrijeme",
          aktivno: "Aktivno",
          neaktivno: "Neaktivno",
          nemaNalog: "Nema nalog",
        }
      : {
          status: "Status",
          statusAlat: "Status im Tool",
          vrijemeStatus: "Zeit im Status",
          pozivi: "Anrufe",
          poziviH: "Anrufe/Std.",
          dostupnost: "Ø Sprechzeit/Anruf",
          prodaje: "Sales",
          pozicije: "Positionen",
          konverzija: "Konversion",
          prodajeH: "Verkäufe/Std.",
          obrada: "Ø Bearbeitungszeit",
          zauzetost: "Auslastung",
          razgovor: "Sprechzeit",
          cekanje: "Wartezeit",
          naknadna: "Nachbearbeitung",
          pauza: "Pausenzeit",
          mrtvo: "Totzeit",
          ukupno: "Gesamtzeit",
          aktivno: "Aktiv",
          neaktivno: "Inaktiv",
          nemaNalog: "Kein Konto",
        };

  const cols: ColumnDef[] = [
    {
      key: "agent",
      group: "agent",
      header: "Agent",
      cell: (a) => (
        <Link href={agentHref(a.agentId)} className="hover:underline">
          {a.fullName}
        </Link>
      ),
      foot: () => null,
    },
    {
      key: "status",
      group: "agent",
      header: t.status,
      cell: (a) => <Badge variant={statusVariant(a.status)}>{statusLabels[a.status.toUpperCase()] ?? a.status}</Badge>,
      foot: () => null,
    },
  ];

  if (appStatusByAgentId) {
    cols.push({
      key: "appStatus",
      group: "agent",
      header: t.statusAlat,
      cell: (a) => {
        const info = appStatusByAgentId.get(a.agentId);
        return info ? <Badge variant={info.badgeVariant}>{info.label}</Badge> : <Badge variant="muted">{t.nemaNalog}</Badge>;
      },
      foot: () => null,
    });
  }

  cols.push(
    { key: "timeInStatus", group: "agent", header: t.vrijemeStatus, cell: (a) => a.timeInStatus, foot: () => null },
    {
      key: "totalCalls",
      group: "obim",
      header: t.pozivi,
      cell: (a) => a.totalCalls,
      foot: (tt) => tt.totalCalls,
      alwaysReal: true,
    },
    {
      key: "callsPerHour",
      group: "obim",
      header: t.poziviH,
      cell: (a) => rate.format(a.callsPerHour),
      foot: (tt) => rate.format(tt.callsPerHour),
    },
    {
      // Anis, 2026-08-18: the CDR-based % (reachedCalls/CDR-own-total) came
      // out as "125 od 144" while the real dialer reported 354 real calls
      // that same day - metrike.php's CDR genuinely undercounts vs. the
      // live totalCalls counter (root cause deferred, "naknadno cemo se
      // baviti metrikama php"). Replaced with a fully real, CDR-free proxy
      // per his own suggestion: average real talk time per real call
      // (both totalCalls and talkTime already come from agents.php, same
      // trusted source as every other column here) - "kolicinu poziva i
      // trajanje poziva i sprechzeit pa sinteticki izracunati".
      key: "reachRate",
      group: "obim",
      header: t.dostupnost,
      cell: (a) => {
        if (a.totalCalls <= 0) return "-";
        const avgSec = parseDialerTimeToSeconds(a.talkTime) / a.totalCalls;
        return `${Math.round(avgSec)}s`;
      },
      foot: (tt) => (tt.totalCalls > 0 ? `${Math.round(tt.talkSeconds / tt.totalCalls)}s` : "-"),
      alwaysReal: true,
    },
    {
      key: "realSales",
      group: "rezultat",
      header: t.prodaje,
      cell: (a) => a.realSales,
      foot: (tt) => tt.realSales,
      alwaysReal: true,
    },
    {
      key: "salePositions",
      group: "rezultat",
      header: t.pozicije,
      cell: (a) => <span className="text-muted-foreground">{a.salePositions}</span>,
      foot: (tt) => <span className="text-muted-foreground">{tt.salePositions}</span>,
      alwaysReal: true,
    },
    {
      key: "conversion",
      group: "rezultat",
      header: t.konverzija,
      cell: (a) => pct.format(a.conversion),
      foot: (tt) => pct.format(tt.conversion),
      alwaysReal: true,
    },
    {
      key: "salesPerHour",
      group: "rezultat",
      header: t.prodajeH,
      cell: (a) => rate.format(a.salesPerHour),
      foot: (tt) => rate.format(tt.salesPerHour),
    },
  );

  if (variant === "full") {
    cols.push({
      key: "aht",
      group: "efikasnost",
      header: t.obrada,
      cell: (a) => formatSecondsAsHms(a.ahtSeconds),
      foot: (tt) => formatSecondsAsHms(tt.ahtSeconds),
    });
  }
  cols.push({
    key: "occupancy",
    group: "efikasnost",
    header: t.zauzetost,
    cell: (a) => pct.format(a.occupancy),
    foot: (tt) => pct.format(tt.occupancy),
  });

  if (variant === "full") {
    cols.push(
      {
        key: "talkTime",
        group: "vrijeme",
        header: t.razgovor,
        cell: (a) => a.talkTime,
        foot: (tt) => formatSecondsAsHms(tt.talkSeconds),
        alwaysReal: true,
      },
      { key: "waitTime", group: "vrijeme", header: t.cekanje, cell: (a) => a.waitTime, foot: (tt) => formatSecondsAsHms(tt.waitSeconds) },
      { key: "dispoTime", group: "vrijeme", header: t.naknadna, cell: (a) => a.dispoTime, foot: (tt) => formatSecondsAsHms(tt.dispoSeconds) },
      {
        key: "pauseTime",
        group: "vrijeme",
        header: t.pauza,
        cell: (a) => (
          <>
            {a.pauseTime} <span className="text-muted-foreground">({pct.format(a.pauseShare)})</span>
          </>
        ),
        foot: (tt) => (
          <>
            {formatSecondsAsHms(tt.pauseSeconds)}{" "}
            <span className="font-normal text-muted-foreground">({pct.format(tt.pauseShare)})</span>
          </>
        ),
      },
      {
        key: "deadTime",
        group: "vrijeme",
        header: t.mrtvo,
        cell: (a) => (
          <>
            {a.deadTime} <span className="text-muted-foreground">({pct.format(a.deadShare)})</span>
          </>
        ),
        foot: (tt) => (
          <>
            {formatSecondsAsHms(tt.deadSeconds)}{" "}
            <span className="font-normal text-muted-foreground">({pct.format(tt.deadShare)})</span>
          </>
        ),
      },
    );
  }

  cols.push(
    { key: "totalTime", group: "aktivnost", header: t.ukupno, cell: (a) => a.totalTime, foot: (tt) => formatSecondsAsHms(tt.totalSeconds) },
    {
      key: "activeTime",
      group: "aktivnost",
      header: t.aktivno,
      cell: (a) => (
        <span className={a.status.toUpperCase() === "PAUSED" ? "text-muted-foreground" : "text-success-foreground"}>
          {a.activeTime}
        </span>
      ),
      foot: (tt) => (
        <span className="text-success-foreground">
          {formatSecondsAsHms(tt.activeSeconds)} <span className="font-normal text-muted-foreground">({pct.format(tt.activeShare)})</span>
        </span>
      ),
    },
    {
      key: "inactiveTime",
      group: "aktivnost",
      header: t.neaktivno,
      cell: (a) => <span className="text-muted-foreground">{a.inactiveTime}</span>,
      foot: (tt) => (
        <span className="text-muted-foreground">
          {formatSecondsAsHms(tt.inactiveSeconds)} <span className="font-normal">({pct.format(1 - tt.activeShare)})</span>
        </span>
      ),
    },
  );

  return cols;
}

export function DialerStatusTable({
  rows,
  sortByStatus = false,
  locale = "de",
  agentHref = (id: string) => `/admin/team/${id}`,
  reconstructed = false,
  variant = "full",
  appStatusByAgentId,
}: {
  rows: DialerAgentSummary[];
  sortByStatus?: boolean;
  /** report@ gets Bosnian labels + report-safe agent links (2026-08-17, Anis:
   * "Dialer informacije na Report takodjer prevedi na bosanski") - admin's
   * own view of this same shared table stays German, default "de". */
  locale?: "de" | "bs";
  agentHref?: (agentId: string) => string;
  /** A backfilled snapshot (2026-08-18, real 17.08. gap) has real Anrufe/
   * Sprechzeit/Sales/Positionen per row but every other time field is "-"
   * (unavailable from the CDR source) - computeDialerTotals() would still
   * happily recompute Auslastung/Ø Bearbeitungszeit etc. from those raw
   * time strings, and since "-" parses to 0 seconds, that produces a
   * real-looking but false 100% Auslastung in the Gesamt row. When true,
   * those derived Gesamt cells render "-" too instead of a fabricated
   * aggregate - per-row cells already correctly show "-"/0 as set by the
   * backfill itself. */
  reconstructed?: boolean;
  /** "full" = every column (admin's daily-use view, unchanged). "compact"
   * (2026-08-18, "za REPORT samo... genralno smanjiti velicina dialer
   * tabele") drops Ø Bearbeitungszeit and the whole Zeitverteilung group. */
  variant?: "full" | "compact";
  /** When provided, merges a "Status im Tool" column right after the real
   * dialer Status column (2026-08-18, "status u alatu dodati poslije
   * statusa u dialeru i istu tabelu") - pre-formatted at the page level
   * (which already has locale-aware pathLabel() logic) rather than
   * duplicated here. Omit for the Verlauf history table, where "status
   * right now" doesn't apply to a past day. */
  appStatusByAgentId?: Map<string, AppStatusInfo>;
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
  const statusLabels = STATUS_LABELS[locale];
  const columns = buildColumns(locale, variant, statusLabels, appStatusByAgentId, agentHref);
  const groupLabels = GROUP_LABELS[locale];

  // Derive group spans/order from the actual column list rather than a
  // hardcoded array, so "compact" and "full" (with/without the merged
  // Status-im-Tool column) can never silently drift out of sync with the
  // real column count.
  const groupOrder: string[] = [];
  const groupSpans = new Map<string, number>();
  for (const col of columns) {
    if (!groupSpans.has(col.group)) {
      groupOrder.push(col.group);
      groupSpans.set(col.group, 0);
    }
    groupSpans.set(col.group, groupSpans.get(col.group)! + 1);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {groupOrder.map((g, i) => (
              <th
                key={g}
                colSpan={groupSpans.get(g)}
                className={cn(
                  "px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase",
                  i > 0 && "border-l",
                )}
              >
                {groupLabels[g]}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((col, i) => (
              <th
                key={col.key}
                className={cn("px-2 py-2 font-medium", i > 0 && columns[i - 1].group !== col.group && "border-l")}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sortedRows.map((a) => (
            <tr key={a.agentId}>
              {columns.map((col, i) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-2 py-2 tabular-nums",
                    i > 0 && columns[i - 1].group !== col.group && "border-l",
                    col.key === "agent" && "font-medium",
                  )}
                >
                  {col.cell(a)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            {columns.map((col, i) => {
              if (col.key === "agent") {
                return (
                  <td key={col.key} className="px-2 py-2">
                    {TOTAL_LABEL[locale]}
                  </td>
                );
              }
              if (col.key === "status" || col.key === "appStatus" || col.key === "timeInStatus") {
                return (
                  <td
                    key={col.key}
                    className={cn("px-2 py-2 text-muted-foreground", columns[i - 1]?.group !== col.group && "border-l")}
                  >
                    {col.key === "status" ? (
                      <span className="text-xs font-normal">
                        {sortedRows.length} {AGENTS_SUFFIX[locale]}
                      </span>
                    ) : null}
                  </td>
                );
              }
              const footValue = reconstructed && !col.alwaysReal ? "-" : col.foot(totals);
              return (
                <td
                  key={col.key}
                  className={cn("px-2 py-2 tabular-nums", columns[i - 1]?.group !== col.group && "border-l")}
                >
                  {footValue}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
