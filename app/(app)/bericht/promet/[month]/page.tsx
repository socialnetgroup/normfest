import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseDialerTimeToSeconds, type DialerAgentSummary } from "@/lib/dialer/status";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return capitalize(
    new Intl.DateTimeFormat("bs", { month: "long", year: "numeric" }).format(new Date(Number(year), Number(m) - 1, 1)),
  );
}

// Anis, 2026-08-20: "Takodjer napravi Promet (Augusit, juli, juni) klikabilno
// kako bi se provjerilo prometa po danu" - a team-wide (not per-agent) daily
// revenue drill-down for one month, reached by clicking a month row on
// /bericht's own Promet table. Reuses the exact same MonthCalendar component
// as /bericht/[agentId] and /tim, just fed team-aggregated DayEntry rows
// (summed across every agent for that day) instead of one agent's own rows.
export default async function BerichtPrometMonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin" && profile?.role !== "report") notFound();
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const supabase = await createClient();
  const monthStart = `${month}-01`;
  const [yearStr, monthNumStr] = month.split("-");
  // Date.UTC (not the local Date constructor) - a local-time construction
  // here would shift by a day once converted via .toISOString() on a
  // machine ahead of UTC, the exact bug found live in /bericht's own
  // "Jučer" figure the same day (see that page's own comment).
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

  const byDate = new Map<string, { revenue: number; sales: number; calls: number }>();
  for (const r of rows ?? []) {
    if (r.day_off) continue;
    const entry = byDate.get(r.date) ?? { revenue: 0, sales: 0, calls: 0 };
    entry.revenue += r.revenue;
    entry.sales += r.sales_count;
    entry.calls += r.calls_count ?? 0;
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
        <Link href="/bericht" className="text-sm text-muted-foreground hover:underline">
          ← Izvještaj
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
          Promet po danu - {monthLabel(month)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Timski (svi agenti zajedno), dan po dan.</p>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Za ovaj mjesec još nema uvezenih podataka.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{monthLabel(month)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <span>
                Timski promet: <span className="font-medium text-foreground tabular-nums">{eur.format(teamRevenue)}</span>
              </span>
              <span>
                Prodaje: <span className="font-medium text-foreground tabular-nums">{teamSales}</span>
              </span>
              <span>
                Pozivi: <span className="font-medium text-foreground tabular-nums">{teamCalls || "-"}</span>
              </span>
              {bonusVisible ? (
                <span>
                  Timski bonus:{" "}
                  <span className="font-medium text-success-foreground tabular-nums">
                    {teamBonusKm > 0 ? `${eurCents.format(teamBonusKm).replace("€", "KM")}` : "-"}
                  </span>
                </span>
              ) : null}
            </div>
            <MonthCalendar month={month} days={days} showBonus={bonusVisible} locale="bs" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
