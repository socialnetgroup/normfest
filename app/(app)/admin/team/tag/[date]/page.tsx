import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DayOffToggle } from "@/components/day-off-toggle";
import { computeDailyBonus, shiftDate, type BonusThreshold } from "@/lib/team/bonus";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export default async function TeamDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: allAgents }, { data: dayRows }, { data: bonusSettings }] = await Promise.all([
    supabase.from("agents").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("agent_daily_performance").select("agent_id, revenue, sales_count, calls_count, day_off").eq("date", date),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents"]),
  ]);

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettings ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);

  const byAgent = new Map(
    (dayRows ?? []).map((r) => [
      r.agent_id,
      { revenue: r.revenue, salesCount: r.sales_count, callsCount: r.calls_count, dayOff: r.day_off },
    ]),
  );
  const agents = (allAgents ?? []).map((a) => ({
    agentId: a.id,
    name: a.full_name,
    revenue: byAgent.get(a.id)?.revenue ?? 0,
    dayOff: byAgent.get(a.id)?.dayOff ?? false,
  }));
  const dailyBonus = computeDailyBonus(agents, thresholds, minContributionPct, minQualifyingAgents);

  const prevDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const nextDisabled = nextDate > today;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/team" className="text-sm text-muted-foreground hover:underline">
          ← Team Dashboard
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <Link
            href={`/admin/team/tag/${prevDate}`}
            className="rounded-md border px-2 py-1 text-sm hover:bg-muted"
            aria-label="Vorheriger Tag"
          >
            ←
          </Link>
          <h1 className="font-heading text-2xl font-semibold tracking-tight capitalize">{dateLabel(date)}</h1>
          {nextDisabled ? (
            <span className="rounded-md border px-2 py-1 text-sm text-muted-foreground opacity-40" aria-hidden>
              →
            </span>
          ) : (
            <Link
              href={`/admin/team/tag/${nextDate}`}
              className="rounded-md border px-2 py-1 text-sm hover:bg-muted"
              aria-label="Nächster Tag"
            >
              →
            </Link>
          )}
          {date !== today ? (
            <Link href={`/admin/team/tag/${today}`} className="text-sm text-muted-foreground hover:underline">
              Heute
            </Link>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tagesbonus</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            <span>
              Team-Umsatz: <span className="font-medium tabular-nums">{eur.format(dailyBonus.teamRevenue)}</span>
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
              <span className="font-medium tabular-nums">
                {dailyBonus.qualifyingCount} von {dailyBonus.minQualifyingAgents}
              </span>
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
                  <th className="px-3 py-2 font-medium">Umsatz</th>
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
                    <td className="px-3 py-2 tabular-nums">{eur.format(r.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums">{pct.format(r.contributionPct / 100)}</td>
                    <td className="px-3 py-2">{r.qualifies ? "Ja" : "Nein"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.bonusKm > 0 ? `${eurCents.format(r.bonusKm).replace("€", "KM")}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <DayOffToggle agentId={r.agentId} date={date} dayOff={r.dayOff} />
                    </td>
                  </tr>
                ))}
                {agents
                  .filter((a) => a.dayOff)
                  .map((a) => (
                    <tr key={a.agentId} className="opacity-50">
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/admin/team/${a.agentId}`} className="hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2" colSpan={4}>
                        Frei
                      </td>
                      <td className="px-3 py-2">
                        <DayOffToggle agentId={a.agentId} date={date} dayOff={a.dayOff} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
