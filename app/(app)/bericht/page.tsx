import { BarChart3, TrendingUp, Sparkles, Phone } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import { buildDialerAgentSummaries, computeDialerTotals, fetchDialerAgentStatuses } from "@/lib/dialer/status";
import { notFound } from "next/navigation";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("de-DE");

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

// Anis, 2026-08-17: "a kinda of viewing angle wheres the project at" - one
// live-computed overview page for report@ (and admin, for QA). Deliberately
// excludes Signale/Bestellungen/Fokus per Anis's own framing ("they dont
// care so deep operational, they dont even know that exists") - only real
// business-level numbers: reach (companies/catalog), Umsatz, flywheel
// adoption (feedback + Wiedervorlagen), data quality (Anreicherung/Katalog),
// Dialer volume, and AI-Assistent usage.
export default async function BerichtPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin" && profile?.role !== "report") notFound();

  const supabase = await createClient();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  // Comparing a partial current week (e.g. just Monday) against a FULL
  // previous week would produce a misleading, always-negative-looking delta
  // - the fair comparison is the same elapsed span (same weekdays) in the
  // previous week, not the whole 7 days.
  const prevWeekSameSpanEnd = new Date(prevWeekStart);
  prevWeekSameSpanEnd.setDate(prevWeekSameSpanEnd.getDate() + dayOfWeek + 1);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  // Last 4 real calendar months of agent_daily_performance, for the Umsatz
  // trend + bonus totals - same shape as admin/team's own monthly cards.
  const trendStartStr = `${new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10)}`;

  const [
    { data: reportStatsRows },
    { count: feedbackTotal },
    { count: feedbackWeek },
    { count: feedbackPrevWeek },
    { count: feedbackToday },
    { count: wiedervorlageOpen },
    { count: wiedervorlageOverdue },
    { data: trendRows },
    { data: allAgents },
    { data: bonusSettingsRows },
    { count: productsTotal },
    { count: productsWithPhoto },
    { count: productsWithDescription },
  ] = await Promise.all([
    supabase.rpc("fn_report_stats"),
    supabase.from("sales_feedback").select("id", { count: "exact", head: true }),
    supabase.from("sales_feedback").select("id", { count: "exact", head: true }).gte("created_at", weekStart.toISOString()),
    supabase
      .from("sales_feedback")
      .select("id", { count: "exact", head: true })
      .gte("created_at", prevWeekStart.toISOString())
      .lt("created_at", prevWeekSameSpanEnd.toISOString()),
    supabase.from("sales_feedback").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    supabase
      .from("sales_feedback")
      .select("id", { count: "exact", head: true })
      .not("wiedervorlage_date", "is", null)
      .eq("wiedervorlage_done", false),
    supabase
      .from("sales_feedback")
      .select("id", { count: "exact", head: true })
      .not("wiedervorlage_date", "is", null)
      .eq("wiedervorlage_done", false)
      .lt("wiedervorlage_date", todayStr),
    supabase
      .from("agent_daily_performance")
      .select("agent_id, date, revenue, day_off")
      .gte("date", trendStartStr),
    supabase.from("agents").select("id, full_name").eq("active", true),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }).not("image_path", "is", null),
    supabase.from("products").select("id", { count: "exact", head: true }).not("description", "is", null),
  ]);

  const stats = reportStatsRows?.[0] ?? {
    companies_total: 0,
    places_resolved: 0,
    website_fetched: 0,
    ai_analyzed: 0,
    ambiguous: 0,
    chat_messages_total: 0,
    chat_messages_week: 0,
    chat_messages_today: 0,
    chat_active_agents: 0,
  };

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettingsRows ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);
  const bonusVisible = bonusSettingsMap.bonus_visible === true;

  const bonusByDate = bonusVisible
    ? computeBonusByDate(
        (trendRows ?? []).map((r) => ({ agentId: r.agent_id, date: r.date, revenue: r.revenue, dayOff: r.day_off })),
        thresholds,
        minContributionPct,
        minQualifyingAgents,
      )
    : null;

  const byMonth = new Map<string, { revenue: number; bonusKm: number }>();
  for (const r of trendRows ?? []) {
    if (r.day_off) continue;
    const month = r.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { revenue: 0, bonusKm: 0 };
    entry.revenue += r.revenue;
    entry.bonusKm += bonusByDate?.get(r.date)?.get(r.agent_id) ?? 0;
    byMonth.set(month, entry);
  }
  const months = [...byMonth.keys()].sort().reverse();
  const teamRevenueMonth = byMonth.get(monthStartStr.slice(0, 7))?.revenue ?? 0;
  const teamRevenueToday = (trendRows ?? [])
    .filter((r) => r.date === todayStr && !r.day_off)
    .reduce((sum, r) => sum + r.revenue, 0);
  const teamRevenueWeek = (trendRows ?? [])
    .filter((r) => r.date >= weekStart.toISOString().slice(0, 10) && !r.day_off)
    .reduce((sum, r) => sum + r.revenue, 0);
  const teamRevenuePrevWeek = (trendRows ?? [])
    .filter(
      (r) =>
        r.date >= prevWeekStart.toISOString().slice(0, 10) &&
        r.date < prevWeekSameSpanEnd.toISOString().slice(0, 10) &&
        !r.day_off,
    )
    .reduce((sum, r) => sum + r.revenue, 0);
  const revenueWowDelta = teamRevenuePrevWeek > 0 ? (teamRevenueWeek - teamRevenuePrevWeek) / teamRevenuePrevWeek : null;
  const feedbackWowDelta =
    (feedbackPrevWeek ?? 0) > 0 ? ((feedbackWeek ?? 0) - (feedbackPrevWeek ?? 0)) / (feedbackPrevWeek ?? 1) : null;

  const agentNameById = new Map((allAgents ?? []).map((a) => [a.id, a.full_name]));
  const perAgentRevenue = new Map<string, number>();
  for (const r of trendRows ?? []) {
    if (r.day_off || r.date.slice(0, 7) !== monthStartStr.slice(0, 7)) continue;
    perAgentRevenue.set(r.agent_id, (perAgentRevenue.get(r.agent_id) ?? 0) + r.revenue);
  }
  const leaderboard = [...perAgentRevenue.entries()]
    .map(([agentId, revenue]) => ({ agentId, name: agentNameById.get(agentId) ?? "-", revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const productsPct = (n: number | null) => (productsTotal ? Math.round(((n ?? 0) / productsTotal) * 100) : 0);
  const enrichmentPct = (n: number) =>
    stats.companies_total > 0 ? Math.round((n / stats.companies_total) * 100) : 0;

  const { data: dialerRows, error: dialerError } = await fetchDialerAgentStatuses();
  const dialerTotals =
    !dialerError && dialerRows ? computeDialerTotals(buildDialerAgentSummaries(dialerRows, allAgents ?? [], new Map())) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bericht</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live-Daten - Stand {new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short" }).format(now)}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Firmen gesamt" value={num(stats.companies_total)} accent="primary" />
        <StatTile label="Katalog gesamt" value={num(productsTotal ?? 0)} accent="secondary" />
        <StatTile
          label="Feedback gesamt"
          value={num(feedbackTotal ?? 0)}
          sub={`Diese Woche: ${num(feedbackWeek ?? 0)} · Heute: ${num(feedbackToday ?? 0)}`}
          accent="success"
        />
        <StatTile
          label="Team-Umsatz (Monat)"
          value={eur.format(teamRevenueMonth)}
          sub={`Heute: ${eur.format(teamRevenueToday)}`}
          accent="primary"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            Umsatz
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <span>
              Diese Woche: <span className="font-medium tabular-nums">{eur.format(teamRevenueWeek)}</span>
              {revenueWowDelta !== null ? (
                <span className={revenueWowDelta >= 0 ? "text-success-foreground" : "text-destructive"}>
                  {" "}
                  ({revenueWowDelta >= 0 ? "+" : ""}
                  {pct.format(revenueWowDelta)} ggü. Vorwoche, gleicher Zeitraum)
                </span>
              ) : null}
            </span>
            {bonusVisible ? (
              <span>
                Team-Bonus (Monat):{" "}
                <span className="font-medium text-success-foreground tabular-nums">
                  {eurCents.format(byMonth.get(monthStartStr.slice(0, 7))?.bonusKm ?? 0).replace("€", "KM")}
                </span>
              </span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Monat</th>
                  <th className="px-2 py-2 font-medium">Team-Umsatz</th>
                  {bonusVisible ? <th className="px-2 py-2 font-medium">Team-Bonus</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {months.map((m) => {
                  const v = byMonth.get(m)!;
                  return (
                    <tr key={m}>
                      <td className="px-2 py-2 font-medium capitalize">{monthLabel(m)}</td>
                      <td className="px-2 py-2 tabular-nums">{eur.format(v.revenue)}</td>
                      {bonusVisible ? (
                        <td className="px-2 py-2 tabular-nums text-success-foreground">
                          {v.bonusKm > 0 ? eurCents.format(v.bonusKm).replace("€", "KM") : "-"}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Nach Agent (dieser Monat)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Agent</th>
                    <th className="px-2 py-2 font-medium">Umsatz</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leaderboard.map((a) => (
                    <tr key={a.agentId}>
                      <td className="px-2 py-2 font-medium">{a.name}</td>
                      <td className="px-2 py-2 tabular-nums">{eur.format(a.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Flywheel-Gesundheit
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Wie viel echtes Agenten-Feedback ins Tool fließt und wie viele Wiedervorlagen offen stehen.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Feedback diese Woche"
              value={num(feedbackWeek ?? 0)}
              sub={
                feedbackWowDelta !== null
                  ? `${feedbackWowDelta >= 0 ? "+" : ""}${pct.format(feedbackWowDelta)} ggü. Vorwoche, gleicher Zeitraum`
                  : undefined
              }
              accent="success"
            />
            <StatTile label="Wiedervorlagen offen" value={num(wiedervorlageOpen ?? 0)} accent="secondary" />
            <StatTile
              label="Davon überfällig"
              value={num(wiedervorlageOverdue ?? 0)}
              accent={(wiedervorlageOverdue ?? 0) > 0 ? "warning" : "success"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Anreicherung &amp; Katalog
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Datenqualität über den ganzen Bestand - wie gut ist die Firmen- und Produktbasis erschlossen.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={`Places aufgelöst (${enrichmentPct(stats.places_resolved)}%)`}
              value={`${num(stats.places_resolved)} / ${num(stats.companies_total)}`}
              accent="secondary"
            />
            <StatTile
              label={`KI-analysiert (${enrichmentPct(stats.ai_analyzed)}%)`}
              value={`${num(stats.ai_analyzed)} / ${num(stats.companies_total)}`}
              accent={enrichmentPct(stats.ai_analyzed) >= 50 ? "success" : "warning"}
            />
            <StatTile
              label={`Katalog-Fotos (${productsPct(productsWithPhoto)}%)`}
              value={`${num(productsWithPhoto ?? 0)} / ${num(productsTotal ?? 0)}`}
              accent={productsPct(productsWithPhoto) >= 90 ? "success" : "warning"}
            />
            <StatTile
              label={`Katalog-Beschreibungen (${productsPct(productsWithDescription)}%)`}
              value={`${num(productsWithDescription ?? 0)} / ${num(productsTotal ?? 0)}`}
              accent={productsPct(productsWithDescription) >= 90 ? "success" : "warning"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="size-4 text-primary" />
            Dialer (heute)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dialerError || !dialerTotals ? (
            <p className="text-sm text-muted-foreground">Dialer-Daten aktuell nicht verfügbar.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Anrufe gesamt" value={num(dialerTotals.totalCalls)} accent="secondary" />
              <StatTile
                label="Ø Bearbeitungszeit"
                value={`${Math.round(dialerTotals.ahtSeconds)}s`}
                accent="secondary"
              />
              <StatTile label="Auslastung" value={pct.format(dialerTotals.occupancy)} accent="secondary" />
              <StatTile label="Konversion (Verkäufe/Anrufe)" value={pct.format(dialerTotals.conversion)} accent="success" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI-Assistent Nutzung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Fragen gesamt"
              value={num(stats.chat_messages_total)}
              sub={`Diese Woche: ${num(stats.chat_messages_week)} · Heute: ${num(stats.chat_messages_today)}`}
              accent="primary"
            />
            <StatTile label="Aktive Nutzer (je genutzt)" value={num(stats.chat_active_agents)} accent="secondary" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
