import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildRealCallsByDateAgent, parseDialerTimeToSeconds, type DialerAgentSummary } from "@/lib/dialer/status";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  const formatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  return formatter.format(new Date(Number(year), Number(m) - 1, 1));
}

// Anis, 2026-08-21: "TIM promet po danu za npr august pa 'prikazi punu
// listu' to sve nemamo u admin view-u? Kopirao bih isto i tamo da se sve
// vidi prosireno s pozivima, javljenim itd" - the team-wide (not per-agent)
// daily drill-down already built for /bericht/promet/[month] (§14 item 131),
// mirrored here for admin. Deliberate near-duplicate of that page (German
// instead of Bosnian, /admin/team instead of /bericht as the back-link) -
// same reasoning as /tim being a full parallel copy of /admin/team itself.
export default async function AdminTeamPrometMonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const supabase = await createClient();
  const monthStart = `${month}-01`;
  const [yearStr, monthNumStr] = month.split("-");
  const nextMonthDate = new Date(Date.UTC(Number(yearStr), Number(monthNumStr), 1));
  const monthEnd = nextMonthDate.toISOString().slice(0, 10);

  const [{ data: rows, error }, { data: allRows }, { data: bonusSettings }, { data: snapshotRows }, { data: feedbackRows }] =
    await Promise.all([
      supabase
        .from("agent_daily_performance")
        .select("agent_id, date, revenue, sales_count, calls_count, day_off")
        .gte("date", monthStart)
        .lt("date", monthEnd)
        .order("date"),
      supabase.from("agent_daily_performance").select("agent_id, date, revenue, day_off"),
      supabase
        .from("settings")
        .select("key, value")
        .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]),
      supabase
        .from("dialer_daily_snapshots")
        .select("snapshot_date, agents")
        .gte("snapshot_date", monthStart)
        .lt("snapshot_date", monthEnd),
      supabase
        .from("sales_feedback")
        .select("created_at, wiedervorlage_date")
        .gte("created_at", monthStart)
        .lt("created_at", monthEnd),
    ]);
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
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

  const talkSecondsByDate = new Map<string, number>();
  const dispoSecondsByDate = new Map<string, number>();
  for (const snap of snapshotRows ?? []) {
    const summaries = (snap.agents as DialerAgentSummary[] | null) ?? [];
    let talk = 0;
    let dispo = 0;
    for (const s of summaries) {
      talk += parseDialerTimeToSeconds(s.talkTime);
      dispo += parseDialerTimeToSeconds(s.dispoTime);
    }
    talkSecondsByDate.set(snap.snapshot_date, talk);
    dispoSecondsByDate.set(snap.snapshot_date, dispo);
  }

  const wiedervorlageByDate = new Map<string, number>();
  for (const row of feedbackRows ?? []) {
    if (!row.wiedervorlage_date) continue;
    const date = row.created_at.slice(0, 10);
    wiedervorlageByDate.set(date, (wiedervorlageByDate.get(date) ?? 0) + 1);
  }

  const realCallsByKey = buildRealCallsByDateAgent(
    (rows ?? []).map((r) => ({ date: r.date, agent_id: r.agent_id, calls_count: r.calls_count })),
    (snapshotRows ?? []) as { snapshot_date: string; agents: { agentId: string; totalCalls: number }[] | null }[],
  );

  const byDate = new Map<string, { revenue: number; sales: number; calls: number }>();
  for (const r of rows ?? []) {
    if (r.day_off) continue;
    const entry = byDate.get(r.date) ?? { revenue: 0, sales: 0, calls: 0 };
    entry.revenue += r.revenue;
    entry.sales += r.sales_count;
    entry.calls += realCallsByKey.get(`${r.date}|${r.agent_id}`) ?? r.calls_count ?? 0;
    byDate.set(r.date, entry);
  }

  const days: DayEntry[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      let bonusKm = 0;
      const perAgentBonus = bonusByDate.get(date);
      if (perAgentBonus) {
        for (const km of perAgentBonus.values()) bonusKm += km;
      }
      return {
        date,
        revenue: v.revenue,
        salesCount: v.sales,
        callsCount: v.calls || null,
        dayOff: false,
        bonusKm,
        talkSeconds: talkSecondsByDate.get(date) ?? null,
        dispoSeconds: dispoSecondsByDate.get(date) ?? null,
        wiedervorlageCount: wiedervorlageByDate.get(date) ?? 0,
      };
    });

  const teamRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
  const teamSales = days.reduce((sum, d) => sum + d.salesCount, 0);
  const teamCalls = days.reduce((sum, d) => sum + (d.callsCount ?? 0), 0);
  const teamBonusKm = days.reduce((sum, d) => sum + d.bonusKm, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/team" className="text-sm text-muted-foreground hover:underline">
          ← Team Dashboard
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
          Umsatz pro Tag - {monthLabel(month)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Team-weit (alle Agenten zusammen), Tag für Tag.</p>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Für diesen Monat noch keine importierten Daten.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{monthLabel(month)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <span>
                Team-Umsatz: <span className="font-medium text-foreground tabular-nums">{eur.format(teamRevenue)}</span>
              </span>
              <span>
                Sales: <span className="font-medium text-foreground tabular-nums">{teamSales}</span>
              </span>
              <span>
                Anrufe: <span className="font-medium text-foreground tabular-nums">{teamCalls || "-"}</span>
              </span>
              {bonusVisible ? (
                <span>
                  Team-Bonus:{" "}
                  <span className="font-medium text-success-foreground tabular-nums">
                    {teamBonusKm > 0 ? `${eurCents.format(teamBonusKm).replace("€", "KM")}` : "-"}
                  </span>
                </span>
              ) : null}
            </div>
            <MonthCalendar month={month} days={days} showBonus={bonusVisible} locale="de" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
