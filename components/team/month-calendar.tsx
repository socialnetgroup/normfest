"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatSecondsAsHms } from "@/lib/dialer/status";
import { cn } from "@/lib/utils";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
// Intl.DateTimeFormat("bs", {day,month,year}) renders "2026-08-31" (ISO
// order) in this environment's ICU data rather than the expected
// "31.08.2026." - a real formatting bug caught live, not assumed away.
// Built manually instead of trusting locale-numeric ordering, matching the
// day.month.year. convention every other Bosnian page in this app uses.
function formatDdMmYyyy(date: Date, trailingDot: boolean) {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}${trailingDot ? "." : ""}`;
}
const dateFmt: Record<"de" | "bs", (date: Date) => string> = {
  de: (date) => formatDdMmYyyy(date, false),
  bs: (date) => formatDdMmYyyy(date, true),
};
const WEEKDAYS: Record<"de" | "bs", string[]> = {
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  bs: ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"],
};

// Anis, 2026-08-18: "sve ove glavne stvari kao umsatz, sales, anrufe, s
// koliko je pricano, cr, wiedervorlage dodaj u Vollständige Liste Anzeigen
// dio kod svakog agenta, prevedi na Bosanski i taj dio toola" - the report
// role's per-agent drill-down (/bericht/[agentId]) reuses this same
// component, so it needed its own locale support rather than staying
// hardcoded German like admin/team's and meine-ergebnisse's usage.
// "Wiedervorlage" itself stays untranslated in bs too - already used as a
// loanword on other Bosnian pages in this app (e.g. /bericht, /tim).
const T = {
  de: {
    fullList: "Vollständige Liste anzeigen",
    asCalendar: "Als Kalender anzeigen",
    day: "Tag",
    revenue: "Umsatz",
    sales: "Sales",
    calls: "Anrufe",
    talk: "Sprechzeit",
    cr: "CR",
    wv: "Wiedervorlage",
    bonus: "Bonus",
    off: "Frei",
  },
  bs: {
    fullList: "Prikaži punu listu",
    asCalendar: "Prikaži kao kalendar",
    day: "Dan",
    revenue: "Promet",
    sales: "Prodaje",
    calls: "Pozivi",
    talk: "Vrijeme razgovora",
    cr: "Konverzija",
    wv: "Wiedervorlage",
    bonus: "Bonus",
    off: "Slobodno",
  },
} as const;

function bonusLabel(km: number) {
  return km > 0 ? eurCents.format(km).replace("€", "KM") : "-";
}

function talkLabel(seconds: number | null) {
  return seconds !== null && seconds > 0 ? formatSecondsAsHms(seconds) : "-";
}

export type DayEntry = {
  date: string;
  revenue: number;
  salesCount: number;
  callsCount: number | null;
  dayOff: boolean;
  bonusKm: number;
  /** Real per-day talk time in seconds, from that day's dialer_daily_snapshots
   * row (admin/report only - RLS doesn't grant agents read access to that
   * table, so it stays null on /meine-ergebnisse). Only ever set for days
   * that actually have a stored snapshot - most days before 2026-08-10
   * (§14 item 24) won't. */
  talkSeconds: number | null;
  /** Real count of that day's sales_feedback rows (created_at) that had a
   * wiedervorlage_date set - same "count by creation day, not by the
   * scheduled callback day" convention already established in /tim
   * (§14 item 97). */
  wiedervorlageCount: number;
};

/**
 * Compact month calendar for one agent's daily performance (§14 item 7 -
 * Genesys-style depth-of-view: small by default, click a day for detail,
 * or expand to the full day-by-day list).
 */
export function MonthCalendar({
  month,
  days,
  showBonus = true,
  locale = "de",
}: {
  month: string;
  days: DayEntry[];
  showBonus?: boolean;
  locale?: "de" | "bs";
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const t = T[locale];
  const formatDate = (date: string) => dateFmt[locale](new Date(`${date}T00:00:00Z`));

  const byDate = new Map(days.map((d) => [d.date, d]));
  const [year, m] = month.split("-").map(Number);
  const firstOfMonth = new Date(year, m - 1, 1);
  const daysInMonth = new Date(year, m, 0).getDate();
  // JS getDay(): 0=Sun..6=Sat -> shift so Monday is column 0
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;

  const maxRevenue = Math.max(1, ...days.map((d) => d.revenue));
  const selectedEntry = selected ? byDate.get(selected) : null;

  const emptyDay = (date: string): DayEntry => ({
    date,
    revenue: 0,
    salesCount: 0,
    callsCount: null,
    dayOff: false,
    bonusKm: 0,
    talkSeconds: null,
    wiedervorlageCount: 0,
  });

  const cells: (DayEntry | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      return byDate.get(date) ?? emptyDay(date);
    }),
  ];

  if (showList) {
    const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="xs" onClick={() => setShowList(false)}>
            {t.asCalendar}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.day}</th>
                <th className="px-3 py-2 font-medium">{t.revenue}</th>
                <th className="px-3 py-2 font-medium">{t.sales}</th>
                <th className="px-3 py-2 font-medium">{t.calls}</th>
                <th className="px-3 py-2 font-medium">{t.talk}</th>
                <th className="px-3 py-2 font-medium">{t.cr}</th>
                <th className="px-3 py-2 font-medium">{t.wv}</th>
                {showBonus ? <th className="px-3 py-2 font-medium">{t.bonus}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((d) => (
                <tr key={d.date} className={d.dayOff ? "opacity-50" : undefined}>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatDate(d.date)}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dayOff ? t.off.toLowerCase() : eur.format(d.revenue)}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dayOff ? "-" : d.salesCount}</td>
                  <td className="px-3 py-2 tabular-nums">{d.callsCount ?? "-"}</td>
                  <td className="px-3 py-2 tabular-nums">{talkLabel(d.talkSeconds)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {d.callsCount ? pct.format(d.salesCount / d.callsCount) : "-"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{d.wiedervorlageCount > 0 ? d.wiedervorlageCount : "-"}</td>
                  {showBonus ? (
                    <td className="px-3 py-2 tabular-nums font-medium text-success">
                      {d.dayOff ? "-" : bonusLabel(d.bonusKm)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="xs" onClick={() => setShowList(true)}>
          {t.fullList}
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS[locale].map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d === null ? (
            <div key={`blank-${i}`} />
          ) : (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelected(d.date === selected ? null : d.date)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md border text-xs transition-colors",
                d.date === selected ? "border-primary ring-1 ring-primary" : "border-transparent hover:border-border",
                d.dayOff ? "bg-muted/40 text-muted-foreground" : "bg-muted/20",
              )}
              title={d.dayOff ? t.off : eur.format(d.revenue)}
            >
              <span className="tabular-nums">{Number(d.date.slice(-2))}</span>
              {!d.dayOff && d.revenue > 0 ? (
                <span
                  className="mt-0.5 h-1 rounded-full bg-primary"
                  style={{ width: `${Math.max(15, Math.round((d.revenue / maxRevenue) * 100))}%` }}
                />
              ) : null}
            </button>
          ),
        )}
      </div>
      {selectedEntry ? (
        <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <span className="font-medium tabular-nums">{formatDate(selectedEntry.date)}</span>
          {selectedEntry.dayOff ? (
            <span className="text-muted-foreground">{t.off}</span>
          ) : (
            <>
              <span>
                {t.revenue}: <span className="font-medium tabular-nums">{eur.format(selectedEntry.revenue)}</span>
              </span>
              <span>
                {t.sales}: <span className="font-medium tabular-nums">{selectedEntry.salesCount}</span>
              </span>
              <span>
                {t.calls}:{" "}
                <span className="font-medium tabular-nums">{selectedEntry.callsCount ?? "-"}</span>
              </span>
              <span>
                {t.talk}: <span className="font-medium tabular-nums">{talkLabel(selectedEntry.talkSeconds)}</span>
              </span>
              <span>
                {t.cr}:{" "}
                <span className="font-medium tabular-nums">
                  {selectedEntry.callsCount ? pct.format(selectedEntry.salesCount / selectedEntry.callsCount) : "-"}
                </span>
              </span>
              <span>
                {t.wv}:{" "}
                <span className="font-medium tabular-nums">
                  {selectedEntry.wiedervorlageCount > 0 ? selectedEntry.wiedervorlageCount : "-"}
                </span>
              </span>
              {showBonus ? (
                <span>
                  {t.bonus}:{" "}
                  <span className="font-medium text-success tabular-nums">
                    {bonusLabel(selectedEntry.bonusKm)}
                  </span>
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
