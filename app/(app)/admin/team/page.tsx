import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

type DayRow = {
  date: string;
  revenue: number;
  sales_count: number;
  calls_count: number | null;
  agents: { full_name: string } | null;
};

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  const formatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  return formatter.format(new Date(Number(year), Number(m) - 1, 1));
}

export default async function TeamDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const { data, error } = await supabase
    .from("agent_daily_performance")
    .select("date, revenue, sales_count, calls_count, agents(full_name)")
    .order("date");

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as unknown as DayRow[];

  const byMonth = new Map<string, Map<string, { revenue: number; sales: number; calls: number; callDays: number }>>();
  for (const row of rows) {
    const agentName = row.agents?.full_name;
    if (!agentName) continue;
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const agentMap = byMonth.get(month)!;
    const entry = agentMap.get(agentName) ?? { revenue: 0, sales: 0, calls: 0, callDays: 0 };
    entry.revenue += row.revenue;
    entry.sales += row.sales_count;
    if (row.calls_count !== null) {
      entry.calls += row.calls_count;
      entry.callDays += 1;
    }
    agentMap.set(agentName, entry);
  }

  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Team Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nur für Admins sichtbar. Tägliche Verkaufsleistung pro Agent, importiert aus den
          monatlichen Team-Dashboard-Dateien.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Daten importiert.</p>
      ) : (
        months.map((month) => {
          const agentMap = byMonth.get(month)!;
          const sorted = [...agentMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
          const teamRevenue = sorted.reduce((sum, [, v]) => sum + v.revenue, 0);
          const teamSales = sorted.reduce((sum, [, v]) => sum + v.sales, 0);

          return (
            <Card key={month}>
              <CardHeader>
                <CardTitle className="capitalize">{monthLabel(month)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex gap-6 text-sm text-muted-foreground">
                  <span>
                    Team-Umsatz: <span className="font-medium text-foreground">{eur.format(teamRevenue)}</span>
                  </span>
                  <span>
                    Team-Sales: <span className="font-medium text-foreground">{teamSales}</span>
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Agent</th>
                        <th className="px-3 py-2 font-medium">Umsatz</th>
                        <th className="px-3 py-2 font-medium">Sales</th>
                        <th className="px-3 py-2 font-medium">Anrufe</th>
                        <th className="px-3 py-2 font-medium">CR (Sales/Anrufe)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sorted.map(([name, v]) => (
                        <tr key={name}>
                          <td className="px-3 py-2 font-medium">{name}</td>
                          <td className="px-3 py-2">{eur.format(v.revenue)}</td>
                          <td className="px-3 py-2">{v.sales}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? v.calls : "—"}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? pct.format(v.sales / v.calls) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
