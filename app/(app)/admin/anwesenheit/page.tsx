import Link from "next/link";
import { notFound } from "next/navigation";

import { Download } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeAttendanceSaldo, datesInMonth } from "@/lib/attendance";
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
// schedule's expected hours so far (Mon-Thu 8h, Fri 6h), the resulting
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

  const supabase = await createClient();
  const [{ data: agents }, { data: rows }] = await Promise.all([
    supabase.from("agents").select("id, full_name").eq("active", true).order("full_name"),
    supabase
      .from("agent_attendance")
      .select("agent_id, date, hours_worked, lost_hours, note")
      .gte("date", monthDates[0])
      .lte("date", monthDates[monthDates.length - 1]),
  ]);

  // Real bug found 2026-08-18 ("zasto merima ima -8 sati saldo?") - see
  // lib/attendance.ts's computeAttendanceSaldo for the full story. Soll is
  // now per-agent (Urlaub days reduce it), not one shared column value.
  const entriesByAgent = new Map<string, { date: string; hoursWorked: number; note: string | null }[]>();
  const lostByAgent = new Map<string, number>();
  const urlaubByAgent = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!entriesByAgent.has(r.agent_id)) entriesByAgent.set(r.agent_id, []);
    entriesByAgent.get(r.agent_id)!.push({ date: r.date, hoursWorked: r.hours_worked, note: r.note });
    lostByAgent.set(r.agent_id, (lostByAgent.get(r.agent_id) ?? 0) + r.lost_hours);
    if (r.note?.toLowerCase().includes("urlaub")) urlaubByAgent.set(r.agent_id, (urlaubByAgent.get(r.agent_id) ?? 0) + 1);
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
          Dienstzeit-Übersicht - Soll: Mo-Do 8h, Fr 6h. Nur für Admin/TL sichtbar.
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
            <a
              href={`/api/admin/anwesenheit/export?month=${month}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              <Download className="size-3.5" />
              Excel exportieren
            </a>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Soll basiert auf Mo-Do 8h / Fr 6h, abzüglich Urlaub-Tagen - daher pro Agent unterschiedlich.
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
                    const { worked, expected, saldo } = computeAttendanceSaldo(
                      entriesByAgent.get(a.id) ?? [],
                      monthDates,
                      todayStr,
                    );
                    const lost = lostByAgent.get(a.id) ?? 0;
                    const urlaubTage = urlaubByAgent.get(a.id) ?? 0;
                    return (
                      <tr key={a.id}>
                        <td className="px-2 py-2 font-medium">
                          <Link href={`/admin/anwesenheit/${a.id}`} className="hover:underline">
                            {a.full_name}
                          </Link>
                        </td>
                        <td className="px-2 py-2 tabular-nums">{hours.format(worked)} h</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{hours.format(expected)} h</td>
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
                          {lost > 0 ? (
                            <Badge variant="warning">{hours.format(lost)} h</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums">{urlaubTage || "-"}</td>
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
