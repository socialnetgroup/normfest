"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export type DayEntry = {
  date: string;
  revenue: number;
  salesCount: number;
  callsCount: number | null;
  dayOff: boolean;
};

/**
 * Compact month calendar for one agent's daily performance (§14 item 7 -
 * Genesys-style depth-of-view: small by default, click a day for detail,
 * or expand to the full day-by-day list).
 */
export function MonthCalendar({ month, days }: { month: string; days: DayEntry[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const byDate = new Map(days.map((d) => [d.date, d]));
  const [year, m] = month.split("-").map(Number);
  const firstOfMonth = new Date(year, m - 1, 1);
  const daysInMonth = new Date(year, m, 0).getDate();
  // JS getDay(): 0=Sun..6=Sat -> shift so Monday is column 0
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;

  const maxRevenue = Math.max(1, ...days.map((d) => d.revenue));
  const selectedEntry = selected ? byDate.get(selected) : null;

  const cells: (DayEntry | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      return byDate.get(date) ?? { date, revenue: 0, salesCount: 0, callsCount: null, dayOff: false };
    }),
  ];

  if (showList) {
    const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="xs" onClick={() => setShowList(false)}>
            Als Kalender anzeigen
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tag</th>
                <th className="px-3 py-2 font-medium">Umsatz</th>
                <th className="px-3 py-2 font-medium">Sales</th>
                <th className="px-3 py-2 font-medium">Anrufe</th>
                <th className="px-3 py-2 font-medium">CR</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((d) => (
                <tr key={d.date} className={d.dayOff ? "opacity-50" : undefined}>
                  <td className="px-3 py-2 font-medium tabular-nums">{d.date}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dayOff ? "frei" : eur.format(d.revenue)}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dayOff ? "-" : d.salesCount}</td>
                  <td className="px-3 py-2 tabular-nums">{d.callsCount ?? "-"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {d.callsCount ? pct.format(d.salesCount / d.callsCount) : "-"}
                  </td>
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
          Vollständige Liste anzeigen
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((w) => (
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
              title={d.dayOff ? "Frei" : eur.format(d.revenue)}
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
          <span className="font-medium tabular-nums">{selectedEntry.date}</span>
          {selectedEntry.dayOff ? (
            <span className="text-muted-foreground">Frei</span>
          ) : (
            <>
              <span>
                Umsatz: <span className="font-medium tabular-nums">{eur.format(selectedEntry.revenue)}</span>
              </span>
              <span>
                Sales: <span className="font-medium tabular-nums">{selectedEntry.salesCount}</span>
              </span>
              <span>
                Anrufe:{" "}
                <span className="font-medium tabular-nums">{selectedEntry.callsCount ?? "-"}</span>
              </span>
              <span>
                CR:{" "}
                <span className="font-medium tabular-nums">
                  {selectedEntry.callsCount ? pct.format(selectedEntry.salesCount / selectedEntry.callsCount) : "-"}
                </span>
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
