import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return capitalize(
    new Intl.DateTimeFormat("bs", { month: "long", year: "numeric" }).format(new Date(Number(year), Number(m) - 1, 1)),
  );
}

// Anis, 2026-08-17: "We need the going deeper possibility by clicking on
// each name, something like the Team menu point in admin. So I kinda need
// all information as well." - a report-accessible equivalent of
// admin/team/[agentId] (same monthly cards + MonthCalendar drill-in), not
// the separate admin-only Kontrolling sub-page (QA-Bewertungen/coaching
// reports) - that's a different, deeper HR-adjacent screen the "Team menu
// point" reference wasn't pointing at. agent_daily_performance/agents are
// already shared-read RLS (confirmed in item 88's own investigation), so no
// new RLS/RPC work was needed here, just the page itself.
export default async function BerichtAgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin" && profile?.role !== "report") notFound();

  const supabase = await createClient();
  const [{ data: agent }, { data: rows, error }, { data: allRows }, { data: bonusSettings }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet, active").eq("id", agentId).single(),
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, day_off")
      .eq("agent_id", agentId)
      .order("date"),
    supabase.from("agent_daily_performance").select("agent_id, date, revenue, day_off"),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]),
  ]);

  if (!agent) notFound();
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Greška pri učitavanju: {error.message}
      </p>
    );
  }

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettings ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);
  const bonusVisible = bonusSettingsMap.bonus_visible === true;

  const bonusByDate = computeBonusByDate(
    (allRows ?? []).map((r) => ({ agentId: r.agent_id, date: r.date, revenue: r.revenue, dayOff: r.day_off })),
    thresholds,
    minContributionPct,
    minQualifyingAgents,
  );

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
      bonusKm: bonusByDate.get(r.date)?.get(agentId) ?? 0,
    });
  }
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/bericht" className="text-sm text-muted-foreground hover:underline">
          ← Izvještaj
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">{agent.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Područje {agent.gebiet}
          {!agent.active ? " - neaktivan" : ""} · mjesečni pregled, svaki mjesec s kalendarom.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Za ovog agenta još nema uvezenih podataka.</p>
      ) : (
        months.map((month) => {
          const days = byMonth.get(month)!;
          const worked = days.filter((d) => !d.dayOff);
          const revenue = worked.reduce((sum, d) => sum + d.revenue, 0);
          const sales = worked.reduce((sum, d) => sum + d.salesCount, 0);
          const calls = worked.reduce((sum, d) => sum + (d.callsCount ?? 0), 0);
          const bonusKm = worked.reduce((sum, d) => sum + d.bonusKm, 0);

          return (
            <Card key={month}>
              <CardHeader>
                <CardTitle>{monthLabel(month)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                  <span>
                    Promet: <span className="font-medium text-foreground tabular-nums">{eur.format(revenue)}</span>
                  </span>
                  <span>
                    Prodaje: <span className="font-medium text-foreground tabular-nums">{sales}</span>
                  </span>
                  <span>
                    Pozivi: <span className="font-medium text-foreground tabular-nums">{calls || "-"}</span>
                  </span>
                  <span>
                    Konverzija:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {calls > 0 ? pct.format(sales / calls) : "-"}
                    </span>
                  </span>
                  {bonusVisible ? (
                    <span>
                      Bonus:{" "}
                      <span className="font-medium text-success-foreground tabular-nums">
                        {bonusKm > 0 ? `${eurCents.format(bonusKm).replace("€", "KM")}` : "-"}
                      </span>
                    </span>
                  ) : null}
                </div>
                <MonthCalendar month={month} days={days} showBonus={bonusVisible} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
