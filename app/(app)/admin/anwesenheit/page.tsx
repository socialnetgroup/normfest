import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { datesInMonth, totalExpectedHours } from "@/lib/attendance";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const hours = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

// Anwesenheit (attendance) overview - CLAUDE.md §14: Anis, "TL prati dnevni
// dolazak na posao... da zna kakvo je stanje da li neko treba nadoknaditi
// itd." One row per agent: hours actually logged this month vs. the standard
// schedule's expected hours so far (Mon-Thu 8h, Fri 7h), the resulting
// Saldo, and separately the running "Nachzuholen" debt from specific
// incidents (e.g. coming in late) - not the same number as the Saldo, since
// an Urlaub day covers its own expected hours with no deficit.
export default async function AnwesenheitPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const { month: monthParam } = await searchParams;
  const todayStr = new Date().toISOString().slice(0, 10);
  const month = monthParam ?? todayStr.slice(0, 7);
  const monthDates = datesInMonth(month);
  const expectedTotal = totalExpectedHours(monthDates, todayStr);

  const supabase = await createClient();
  const [{ data: agents }, { data: rows }] = await Promise.all([
    supabase.from("agents").select("id, full_name").eq("active", true).order("full_name"),
    supabase
      .from("agent_attendance")
      .select("agent_id, date, hours_worked, lost_hours, note")
      .gte("date", monthDates[0])
      .lte("date", monthDates[monthDates.length - 1]),
  ]);

  const byAgent = new Map<string, { worked: number; lost: number; urlaubTage: number }>();
  for (const r of rows ?? []) {
    const entry = byAgent.get(r.agent_id) ?? { worked: 0, lost: 0, urlaubTage: 0 };
    entry.worked += r.hours_worked;
    entry.lost += r.lost_hours;
    if (r.note?.toLowerCase().includes("urlaub")) entry.urlaubTage += 1;
    byAgent.set(r.agent_id, entry);
  }

  const [year, m] = month.split("-").map(Number);
  const prevMonth = new Date(year, m - 2, 1);
  const nextMonth = new Date(year, m, 1);
  const prevStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const nextStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentOrFuture = nextStr > todayStr.slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Anwesenheit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dienstzeit-Übersicht - Soll: Mo-Do 8h, Fr 7h. Nur für Admin/TL sichtbar.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="capitalize">{monthLabel(month)}</CardTitle>
          <div className="flex items-center gap-3 text-sm">
            <Link href={`/admin/anwesenheit?month=${prevStr}`} className="hover:underline">
              ← Vormonat
            </Link>
            {!isCurrentOrFuture ? (
              <Link href={`/admin/anwesenheit?month=${nextStr}`} className="hover:underline">
                Nächster →
              </Link>
            ) : (
              <span className="text-muted-foreground/40">Nächster →</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Soll bisher in diesem Monat: <span className="font-medium text-foreground">{hours.format(expectedTotal)} h</span>
          </p>
          {!agents || agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine aktiven Agenten.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Agent</th>
                    <th className="px-2 py-2 font-medium">Odrađeno</th>
                    <th className="px-2 py-2 font-medium">Soll</th>
                    <th className="px-2 py-2 font-medium">Saldo</th>
                    <th className="px-2 py-2 font-medium">Nachzuholen</th>
                    <th className="px-2 py-2 font-medium">Urlaub-Tage</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agents.map((a) => {
                    const entry = byAgent.get(a.id) ?? { worked: 0, lost: 0, urlaubTage: 0 };
                    const saldo = entry.worked - expectedTotal;
                    return (
                      <tr key={a.id}>
                        <td className="px-2 py-2 font-medium">
                          <Link href={`/admin/anwesenheit/${a.id}`} className="hover:underline">
                            {a.full_name}
                          </Link>
                        </td>
                        <td className="px-2 py-2 tabular-nums">{hours.format(entry.worked)} h</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{hours.format(expectedTotal)} h</td>
                        <td
                          className={cn(
                            "px-2 py-2 tabular-nums font-medium",
                            saldo < 0 ? "text-destructive" : "text-success-foreground",
                          )}
                        >
                          {saldo >= 0 ? "+" : ""}
                          {hours.format(saldo)} h
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {entry.lost > 0 ? (
                            <Badge variant="warning">{hours.format(entry.lost)} h</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums">{entry.urlaubTage || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
