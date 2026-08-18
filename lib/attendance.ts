// Anwesenheit (attendance) shared logic - CLAUDE.md §14: TL tracks daily
// hours per agent against the standard schedule (Mon-Thu 8h, Fri 6h,
// weekends not a workday) to see who's ahead/behind and needs to make up
// time. Pure functions so the overview page and the per-agent detail page
// compute the same numbers the same way.

/** Expected hours for a given ISO date, purely from its weekday - Mon-Thu
 * are full 8h days, Friday is a shorter 6h day, weekends aren't workdays. */
export function expectedHoursForDate(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  if (day >= 1 && day <= 4) return 8;
  if (day === 5) return 6;
  return 0;
}

export function isWorkday(dateStr: string): boolean {
  return expectedHoursForDate(dateStr) > 0;
}

/** All ISO dates (YYYY-MM-DD) in a "YYYY-MM" month, inclusive. */
export function datesInMonth(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Sum of expected hours across a set of dates, capped at "today" if that
 * date falls inside the range - the current month shouldn't yet expect
 * hours for days that haven't happened. */
export function totalExpectedHours(dates: string[], todayStr: string = new Date().toISOString().slice(0, 10)): number {
  return dates.filter((d) => d <= todayStr).reduce((sum, d) => sum + expectedHoursForDate(d), 0);
}

export const NOTE_PRESETS = ["Urlaub", "Krankheit", "Kasnio", "Sonstiges"] as const;

export function isUrlaubNote(note: string | null | undefined): boolean {
  return !!note?.toLowerCase().includes("urlaub");
}

export type AttendanceSaldoEntry = { date: string; hoursWorked: number; note: string | null };

/** Real bug found 2026-08-18 (Anis: "zasto merima ima -8 sati saldo?") -
 * Saldo was computed as `sum(all hours_worked for the month) - sum(expected
 * hours up to today)`, two mismatched halves: "worked" summed EVERY row
 * regardless of date (including a real future-dated pre-fill past today,
 * which shouldn't count as already-worked before it happens), and "expected"
 * never excluded Urlaub days even though the original Anwesenheit design
 * explicitly says an Urlaub day covers its own Soll with no deficit
 * ("Urlaub pokriva dnevnu obavezu", §14) - that exclusion was documented as
 * the intent but never actually implemented. Both bugs independently made a
 * real agent's Saldo look worse than it truly was. This is the one shared
 * computation the overview page, the per-agent page, and the Excel export
 * all now use so they can't drift apart on the fix again. */
export function computeAttendanceSaldo(
  entries: AttendanceSaldoEntry[],
  monthDates: string[],
  todayStr: string,
): { worked: number; expected: number; saldo: number } {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  let worked = 0;
  let expected = 0;
  for (const date of monthDates) {
    if (date > todayStr) continue;
    const entry = byDate.get(date);
    worked += entry?.hoursWorked ?? 0;
    if (isUrlaubNote(entry?.note)) continue;
    expected += expectedHoursForDate(date);
  }
  return { worked, expected, saldo: worked - expected };
}
