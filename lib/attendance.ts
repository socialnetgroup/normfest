// Anwesenheit (attendance) shared logic - CLAUDE.md §14: TL tracks daily
// hours per agent against the standard schedule (Mon-Thu 8h, Fri 7h,
// weekends not a workday) to see who's ahead/behind and needs to make up
// time. Pure functions so the overview page and the per-agent detail page
// compute the same numbers the same way.

/** Expected hours for a given ISO date, purely from its weekday - Mon-Thu
 * are full 8h days, Friday is a shorter 7h day, weekends aren't workdays. */
export function expectedHoursForDate(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  if (day >= 1 && day <= 4) return 8;
  if (day === 5) return 7;
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
