import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DayOffToggle } from "@/components/day-off-toggle";
import { computeBonusByDate, computeDailyBonus, type BonusThreshold } from "@/lib/team/bonus";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

type DayRow = {
  date: string;
  revenue: number;
  sales_count: number;
  calls_count: number | null;
  agent_id: string;
  day_off: boolean;
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

  const today = new Date().toISOString().slice(0, 10);

  const [{ data, error }, { data: allAgents }, { data: todayRows }, { data: bonusSettings }] = await Promise.all([
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, agent_id, day_off, agents(full_name)")
      .order("date"),
    supabase.from("agents").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("agent_daily_performance").select("agent_id, revenue, day_off").eq("date", today),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents"]),
  ]);

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as unknown as DayRow[];

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettings ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);

  const todayByAgent = new Map(
    (todayRows ?? []).map((r) => [r.agent_id, { revenue: r.revenue, dayOff: r.day_off }]),
  );
  const todayAgents = (allAgents ?? []).map((a) => ({
    agentId: a.id,
    name: a.full_name,
    revenue: todayByAgent.get(a.id)?.revenue ?? 0,
    dayOff: todayByAgent.get(a.id)?.dayOff ?? false,
  }));
  const dailyBonus = computeDailyBonus(todayAgents, thresholds, minContributionPct, minQualifyingAgents);

  const bonusByDate = computeBonusByDate(
    rows.map((r) => ({ agentId: r.agent_id, date: r.date, revenue: r.revenue, dayOff: r.day_off })),
    thresholds,
    minContributionPct,
    minQualifyingAgents,
  );

  const byMonth = new Map<
    string,
    Map<
      string,
      { agentId: string; name: string; revenue: number; sales: number; calls: number; callDays: number; bonusKm: number }
    >
  >();
  for (const row of rows) {
    const agentName = row.agents?.full_name;
    if (!agentName) continue;
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const agentMap = byMonth.get(month)!;
    const entry = agentMap.get(row.agent_id) ?? {
      agentId: row.agent_id,
      name: agentName,
      revenue: 0,
      sales: 0,
      calls: 0,
      callDays: 0,
      bonusKm: 0,
    };
    entry.revenue += row.revenue;
    entry.sales += row.sales_count;
    if (row.calls_count !== null) {
      entry.calls += row.calls_count;
      entry.callDays += 1;
    }
    entry.bonusKm += bonusByDate.get(row.date)?.get(row.agent_id) ?? 0;
    agentMap.set(row.agent_id, entry);
  }

  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Team Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nur für Admins sichtbar. Tägliche Verkaufsleistung pro Agent, importiert aus den
            monatlichen Team-Dashboard-Dateien.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/admin/team/bonus-regeln"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Bonus-Regeln
          </Link>
          <Link
            href={`/admin/team/tag/${today}`}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Tagesansicht →
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Täglicher Bonus - heute</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            <span>
              Team-Umsatz heute:{" "}
              <span className="font-medium">{eur.format(dailyBonus.teamRevenue)}</span>
            </span>
            <span>
              Prag erreicht:{" "}
              <span className="font-medium">
                {dailyBonus.thresholdReached
                  ? `${eur.format(dailyBonus.thresholdReached.team_revenue)} → ${dailyBonus.budget} KM Budget`
                  : "Nicht erreicht"}
              </span>
            </span>
            <span>
              Qualifizierte Agenten:{" "}
              <span className="font-medium">{dailyBonus.qualifyingCount}</span>
              <span className="text-muted-foreground"> (mind. {dailyBonus.minQualifyingAgents} nötig)</span>
              {!dailyBonus.enoughQualifiers ? (
                <Badge variant="muted" className="ml-2">
                  Bonus wird nicht verteilt
                </Badge>
              ) : null}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Umsatz heute</th>
                  <th className="px-3 py-2 font-medium">% Beitrag</th>
                  <th className="px-3 py-2 font-medium">Qualifiziert</th>
                  <th className="px-3 py-2 font-medium">Bonus (KM)</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dailyBonus.results.map((r) => (
                  <tr key={r.agentId}>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/admin/team/${r.agentId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{eur.format(r.revenue)}</td>
                    <td className="px-3 py-2">{pct.format(r.contributionPct / 100)}</td>
                    <td className="px-3 py-2">{r.qualifies ? "Ja" : "Nein"}</td>
                    <td className="px-3 py-2">{r.bonusKm > 0 ? `${eurCents.format(r.bonusKm).replace("€", "KM")}` : "-"}</td>
                    <td className="px-3 py-2">
                      <DayOffToggle agentId={r.agentId} date={today} dayOff={r.dayOff} />
                    </td>
                  </tr>
                ))}
                {todayAgents
                  .filter((a) => a.dayOff)
                  .map((a) => (
                    <tr key={a.agentId} className="opacity-50">
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/admin/team/${a.agentId}`} className="hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2" colSpan={4}>
                        Heute frei
                      </td>
                      <td className="px-3 py-2">
                        <DayOffToggle agentId={a.agentId} date={today} dayOff={a.dayOff} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Daten importiert.</p>
      ) : (
        months.map((month) => {
          const agentMap = byMonth.get(month)!;
          const sorted = [...agentMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
          const teamRevenue = sorted.reduce((sum, [, v]) => sum + v.revenue, 0);
          const teamSales = sorted.reduce((sum, [, v]) => sum + v.sales, 0);
          const teamBonusKm = sorted.reduce((sum, [, v]) => sum + v.bonusKm, 0);

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
                  <span>
                    Team-Bonus:{" "}
                    <span className="font-medium text-foreground">
                      {teamBonusKm > 0 ? `${eurCents.format(teamBonusKm).replace("€", "KM")}` : "-"}
                    </span>
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
                        <th className="px-3 py-2 font-medium">Bonus (KM)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sorted.map(([agentId, v]) => (
                        <tr key={agentId}>
                          <td className="px-3 py-2 font-medium">
                            <Link href={`/admin/team/${agentId}`} className="hover:underline">
                              {v.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{eur.format(v.revenue)}</td>
                          <td className="px-3 py-2">{v.sales}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? v.calls : "-"}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? pct.format(v.sales / v.calls) : "-"}</td>
                          <td className="px-3 py-2 font-medium text-success-foreground">
                            {v.bonusKm > 0 ? `${eurCents.format(v.bonusKm).replace("€", "KM")}` : "-"}
                          </td>
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
