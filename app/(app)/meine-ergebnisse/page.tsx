import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

// Same structure as /admin/team/[agentId] (month cards + calendar drill-in,
// real per-day bonus), just scoped to the logged-in agent's own data instead
// of admin-only access to any agent — Anis, 2026-07-31: agents should see
// their own historical results the same way admin sees the team's.
export default async function MeineErgebnissePage() {
  const { user, profile } = await getCurrentUser();
  const supabase = await createClient();

  const { data: myAgent } = user
    ? await supabase.from("agents").select("id, full_name, gebiet, active").eq("profile_id", user.id).maybeSingle()
    : { data: null };

  if (!myAgent) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Meine Ergebnisse</h1>
        <p className="text-sm text-muted-foreground">
          {profile?.role === "admin"
            ? "Admin-Konten sind keinem Agenten zugeordnet - siehe stattdessen das Team Dashboard."
            : "Dein Konto ist noch keinem Agenten zugeordnet."}
        </p>
      </div>
    );
  }

  const [{ data: rows, error }, { data: allRows }, { data: bonusSettings }] = await Promise.all([
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, day_off")
      .eq("agent_id", myAgent.id)
      .order("date"),
    supabase.from("agent_daily_performance").select("agent_id, date, revenue, day_off"),
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

  const bonusSettingsMap: Record<string, unknown> = {};
  for (const row of bonusSettings ?? []) bonusSettingsMap[row.key] = row.value;
  const thresholds = (bonusSettingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(bonusSettingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(bonusSettingsMap.bonus_min_qualifying_agents ?? 7);

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
      bonusKm: bonusByDate.get(r.date)?.get(myAgent.id) ?? 0,
    });
  }
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Meine Ergebnisse</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {myAgent.full_name} · Gebiet {myAgent.gebiet} · monatlicher Verlauf, jeder Monat mit Kalender-Drill-in.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Daten importiert.</p>
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
                  <span>
                    Bonus:{" "}
                    <span className="font-medium text-success-foreground tabular-nums">
                      {bonusKm > 0 ? `${eurCents.format(bonusKm).replace("€", "KM")}` : "-"}
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
