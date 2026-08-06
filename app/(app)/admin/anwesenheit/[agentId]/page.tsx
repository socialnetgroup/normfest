import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceMonthCalendar, type AttendanceDay } from "@/components/attendance/attendance-month-calendar";
import { datesInMonth, totalExpectedHours } from "@/lib/attendance";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const hours = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

export default async function AgentAnwesenheitPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [{ data: agent }, { data: rows, error }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet, active").eq("id", agentId).single(),
    supabase
      .from("agent_attendance")
      .select("date, hours_worked, lost_hours, note")
      .eq("agent_id", agentId)
      .order("date"),
  ]);

  if (!agent) notFound();
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
      </p>
    );
  }

  const byMonth = new Map<string, AttendanceDay[]>();
  for (const r of rows ?? []) {
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push({ date: r.date, hoursWorked: r.hours_worked, lostHours: r.lost_hours, note: r.note });
  }
  // Always show the current month even with no entries yet, so the TL can
  // start logging today without first navigating to a different month.
  const currentMonth = todayStr.slice(0, 7);
  if (!byMonth.has(currentMonth)) byMonth.set(currentMonth, []);
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/anwesenheit" className="text-sm text-muted-foreground hover:underline">
          ← Anwesenheit
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">{agent.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gebiet {agent.gebiet}
          {!agent.active ? " - inaktiv" : ""} · Tag anklicken zum Eintragen/Bearbeiten.
        </p>
      </div>

      {months.map((month) => {
        const days = byMonth.get(month)!;
        const worked = days.reduce((sum, d) => sum + d.hoursWorked, 0);
        const lost = days.reduce((sum, d) => sum + d.lostHours, 0);
        const urlaubTage = days.filter((d) => d.note?.toLowerCase().includes("urlaub")).length;
        const expected = totalExpectedHours(datesInMonth(month), todayStr);
        const saldo = worked - expected;

        return (
          <Card key={month}>
            <CardHeader>
              <CardTitle className="capitalize">{monthLabel(month)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                <span>
                  Odrađeno: <span className="font-medium text-foreground tabular-nums">{hours.format(worked)} h</span>
                </span>
                <span>
                  Soll: <span className="font-medium text-foreground tabular-nums">{hours.format(expected)} h</span>
                </span>
                <span>
                  Saldo:{" "}
                  <span
                    className={
                      "font-medium tabular-nums " + (saldo < 0 ? "text-destructive" : "text-success-foreground")
                    }
                  >
                    {saldo >= 0 ? "+" : ""}
                    {hours.format(saldo)} h
                  </span>
                </span>
                <span>
                  Nachzuholen: <span className="font-medium text-foreground tabular-nums">{hours.format(lost)} h</span>
                </span>
                <span>
                  Urlaub-Tage: <span className="font-medium text-foreground tabular-nums">{urlaubTage || "-"}</span>
                </span>
              </div>
              <AttendanceMonthCalendar agentId={agentId} month={month} days={days} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
