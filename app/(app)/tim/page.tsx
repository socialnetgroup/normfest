import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeBonusByDate, computeDailyBonus, type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
  return capitalize(
    new Intl.DateTimeFormat("bs", { month: "long", year: "numeric" }).format(new Date(Number(year), Number(m) - 1, 1)),
  );
}

// Anis, 2026-08-17: "dodaj 'TEAM' iz Admina ovamo u Report kao poseban Meni
// dio" - puna kopija admin/team/page.tsx (dnevni bonus danas + potpuna
// mjesečna tabela po agentu), kao vlastita stranica/meni stavka umjesto
// ugrađena u Izvještaj (koji sad ima samo sažeti mjesečni pregled prometa).
// Link na pojedinog agenta ide na već postojeći /bericht/[agentId].
export default async function TimPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin" && profile?.role !== "report") notFound();

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data, error }, { data: allAgents }, { data: todayRows }, { data: bonusSettings }, { data: feedbackRows }] =
    await Promise.all([
      supabase
        .from("agent_daily_performance")
        .select("date, revenue, sales_count, calls_count, agent_id, day_off, agents(full_name)")
        .order("date"),
      supabase.from("agents").select("id, full_name, profile_id").eq("active", true).order("full_name"),
      supabase.from("agent_daily_performance").select("agent_id, revenue, day_off").eq("date", today),
      supabase
        .from("settings")
        .select("key, value")
        .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]),
      // Anis, 2026-08-18: "Feedback po Agentu dodati u TIM" - sales_feedback.agent_id
      // is a PROFILE id (auth.uid()), not agents.id (same key-space distinction
      // already hit multiple times elsewhere in this app) - converted via
      // agents.profile_id below before grouping by month.
      supabase.from("sales_feedback").select("agent_id, created_at"),
    ]);

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Greška pri učitavanju: {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as unknown as DayRow[];

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettings ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);
  const bonusVisible = bonusSettingsMap.bonus_visible === true;

  const todayByAgent = new Map((todayRows ?? []).map((r) => [r.agent_id, { revenue: r.revenue, dayOff: r.day_off }]));
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
      { agentId: string; name: string; revenue: number; sales: number; calls: number; feedback: number; bonusKm: number }
    >
  >();
  for (const row of rows) {
    const agentName = row.agents?.full_name;
    if (!agentName) continue;
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const agentMap = byMonth.get(month)!;
    const entry =
      agentMap.get(row.agent_id) ?? { agentId: row.agent_id, name: agentName, revenue: 0, sales: 0, calls: 0, feedback: 0, bonusKm: 0 };
    entry.revenue += row.revenue;
    entry.sales += row.sales_count;
    entry.calls += row.calls_count ?? 0;
    entry.bonusKm += bonusByDate.get(row.date)?.get(row.agent_id) ?? 0;
    agentMap.set(row.agent_id, entry);
  }

  const agentIdByProfileId = new Map(
    (allAgents ?? []).filter((a) => a.profile_id).map((a) => [a.profile_id as string, a.id]),
  );
  for (const row of feedbackRows ?? []) {
    const agentId = agentIdByProfileId.get(row.agent_id);
    if (!agentId) continue;
    const month = row.created_at.slice(0, 7);
    const agentMap = byMonth.get(month);
    const entry = agentMap?.get(agentId);
    if (entry) entry.feedback += 1;
  }

  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Tim</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dnevni prodajni učinak po agentu, uvezeno iz mjesečnih Team-Dashboard fajlova.
        </p>
      </div>

      {bonusVisible ? (
        <Card>
          <CardHeader>
            <CardTitle>Dnevni bonus - danas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-6 text-sm">
              <span>
                Timski promet danas: <span className="font-medium">{eur.format(dailyBonus.teamRevenue)}</span>
              </span>
              <span>
                Prag dostignut:{" "}
                <span className="font-medium">
                  {dailyBonus.thresholdReached
                    ? `${eur.format(dailyBonus.thresholdReached.team_revenue)} → ${dailyBonus.budget} KM budžet`
                    : "Nije dostignut"}
                </span>
              </span>
              <span>
                Kvalifikovani agenti:{" "}
                <span className="font-medium">{dailyBonus.qualifyingCount}</span>
                <span className="text-muted-foreground"> (min. {dailyBonus.minQualifyingAgents} potrebno)</span>
                {!dailyBonus.enoughQualifiers ? (
                  <Badge variant="muted" className="ml-2">
                    Bonus se ne dijeli
                  </Badge>
                ) : null}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Promet danas</th>
                    <th className="px-3 py-2 font-medium">% udio</th>
                    <th className="px-3 py-2 font-medium">Kvalifikovan</th>
                    <th className="px-3 py-2 font-medium">Bonus (KM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dailyBonus.results.map((r) => (
                    <tr key={r.agentId}>
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/bericht/${r.agentId}`} className="hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{eur.format(r.revenue)}</td>
                      <td className="px-3 py-2">{pct.format(r.contributionPct / 100)}</td>
                      <td className="px-3 py-2">{r.qualifies ? "Da" : "Ne"}</td>
                      <td className="px-3 py-2">{r.bonusKm > 0 ? `${eurCents.format(r.bonusKm).replace("€", "KM")}` : "-"}</td>
                    </tr>
                  ))}
                  {todayAgents
                    .filter((a) => a.dayOff)
                    .map((a) => (
                      <tr key={a.agentId} className="opacity-50">
                        <td className="px-3 py-2 font-medium">
                          <Link href={`/bericht/${a.agentId}`} className="hover:underline">
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2" colSpan={4}>
                          Danas slobodan/na
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Još nema uvezenih podataka.</p>
      ) : (
        months.map((month) => {
          const agentMap = byMonth.get(month)!;
          const sorted = [...agentMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
          const teamRevenue = sorted.reduce((sum, [, v]) => sum + v.revenue, 0);
          const teamSales = sorted.reduce((sum, [, v]) => sum + v.sales, 0);
          const teamFeedback = sorted.reduce((sum, [, v]) => sum + v.feedback, 0);
          const teamBonusKm = sorted.reduce((sum, [, v]) => sum + v.bonusKm, 0);

          return (
            <Card key={month}>
              <CardHeader>
                <CardTitle>{monthLabel(month)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex gap-6 text-sm text-muted-foreground">
                  <span>
                    Timski promet: <span className="font-medium text-foreground">{eur.format(teamRevenue)}</span>
                  </span>
                  <span>
                    Timske prodaje: <span className="font-medium text-foreground">{teamSales}</span>
                  </span>
                  <span>
                    Timski feedback: <span className="font-medium text-foreground">{teamFeedback}</span>
                  </span>
                  {bonusVisible ? (
                    <span>
                      Timski bonus:{" "}
                      <span className="font-medium text-foreground">
                        {teamBonusKm > 0 ? `${eurCents.format(teamBonusKm).replace("€", "KM")}` : "-"}
                      </span>
                    </span>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Agent</th>
                        <th className="px-3 py-2 font-medium">Promet</th>
                        <th className="px-3 py-2 font-medium">Prodaje</th>
                        <th className="px-3 py-2 font-medium">Feedback</th>
                        <th className="px-3 py-2 font-medium">Pozivi</th>
                        <th className="px-3 py-2 font-medium">Konverzija (Prodaje/Pozivi)</th>
                        {bonusVisible ? <th className="px-3 py-2 font-medium">Bonus (KM)</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sorted.map(([agentId, v]) => (
                        <tr key={agentId}>
                          <td className="px-3 py-2 font-medium">
                            <Link href={`/bericht/${agentId}`} className="hover:underline">
                              {v.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{eur.format(v.revenue)}</td>
                          <td className="px-3 py-2">{v.sales}</td>
                          <td className="px-3 py-2">{v.feedback > 0 ? v.feedback : "-"}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? v.calls : "-"}</td>
                          <td className="px-3 py-2">{v.calls > 0 ? pct.format(v.sales / v.calls) : "-"}</td>
                          {bonusVisible ? (
                            <td className="px-3 py-2 font-medium text-success-foreground">
                              {v.bonusKm > 0 ? `${eurCents.format(v.bonusKm).replace("€", "KM")}` : "-"}
                            </td>
                          ) : null}
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
