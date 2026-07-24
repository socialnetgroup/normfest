import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

export default async function AgentHistoryPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const [{ data: agent }, { data: rows, error }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet, active").eq("id", agentId).single(),
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, day_off")
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

  const byMonth = new Map<string, DayEntry[]>();
  for (const r of rows ?? []) {
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push({
      date: r.date,
      revenue: r.revenue,
      salesCount: r.sales_count,
      callsCount: r.calls_count,
      dayOff: r.day_off,
    });
  }
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/team" className="text-sm text-muted-foreground hover:underline">
          ← Team Dashboard
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">{agent.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gebiet {agent.gebiet}
          {!agent.active ? " - inaktiv" : ""} · monatlicher Verlauf, jeder Monat mit Kalender-Drill-in.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Daten für diesen Agenten importiert.</p>
      ) : (
        months.map((month) => {
          const days = byMonth.get(month)!;
          const worked = days.filter((d) => !d.dayOff);
          const revenue = worked.reduce((sum, d) => sum + d.revenue, 0);
          const sales = worked.reduce((sum, d) => sum + d.salesCount, 0);
          const calls = worked.reduce((sum, d) => sum + (d.callsCount ?? 0), 0);

          return (
            <Card key={month}>
              <CardHeader>
                <CardTitle className="capitalize">{monthLabel(month)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                  <span>
                    Umsatz: <span className="font-medium text-foreground tabular-nums">{eur.format(revenue)}</span>
                  </span>
                  <span>
                    Sales: <span className="font-medium text-foreground tabular-nums">{sales}</span>
                  </span>
                  <span>
                    Anrufe: <span className="font-medium text-foreground tabular-nums">{calls || "-"}</span>
                  </span>
                  <span>
                    CR:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {calls > 0 ? pct.format(sales / calls) : "-"}
                    </span>
                  </span>
                </div>
                <MonthCalendar month={month} days={days} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
