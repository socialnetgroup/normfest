import { LogSaleForm } from "@/components/log-sale-form";
import { ProgressBar } from "@/components/progress-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type SettingsMap = Record<string, number>;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: myAgent }, { data: settingsRows }] = await Promise.all([
    user
      ? supabase.from("agents").select("id, full_name").eq("profile_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", [
        "agent_monthly_goal",
        "team_monthly_goal_floor",
        "team_monthly_goal_target",
        "team_monthly_goal_stretch",
        "team_leader_bonus_threshold",
      ]),
  ]);

  const goals: SettingsMap = {};
  for (const row of settingsRows ?? []) {
    goals[row.key] = Number(row.value);
  }

  const now = new Date();
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: monthRows } = await supabase
    .from("agent_daily_performance")
    .select("agent_id, revenue, agents(full_name)")
    .gte("date", monthStartStr);

  const byAgent = new Map<string, { name: string; revenue: number }>();
  for (const row of monthRows ?? []) {
    const name = (row.agents as { full_name: string } | null)?.full_name;
    if (!name) continue;
    const entry = byAgent.get(row.agent_id) ?? { name, revenue: 0 };
    entry.revenue += row.revenue;
    byAgent.set(row.agent_id, entry);
  }

  const leaderboard = [...byAgent.entries()]
    .map(([agentId, v]) => ({ agentId, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const teamRevenue = leaderboard.reduce((sum, a) => sum + a.revenue, 0);
  const myRevenue = myAgent ? (byAgent.get(myAgent.id)?.revenue ?? 0) : null;

  const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{monthLabel}</p>
      </div>

      {myAgent ? (
        <Card>
          <CardHeader>
            <CardTitle>Mein Ziel — {myAgent.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <LogSaleForm />
            {goals.agent_monthly_goal ? (
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{eur.format(myRevenue ?? 0)}</span>
                  <span className="text-muted-foreground">Ziel {eur.format(goals.agent_monthly_goal)}</span>
                </div>
                <ProgressBar value={myRevenue ?? 0} max={goals.agent_monthly_goal} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {goals.team_monthly_goal_target ? (
        <Card>
          <CardHeader>
            <CardTitle>Team-Ziel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{eur.format(teamRevenue)}</span>
              <span className="text-muted-foreground">
                Minimum {eur.format(goals.team_monthly_goal_floor)} · Ziel{" "}
                {eur.format(goals.team_monthly_goal_target)} · Stretch{" "}
                {eur.format(goals.team_monthly_goal_stretch)}
              </span>
            </div>
            <ProgressBar
              value={teamRevenue}
              max={goals.team_monthly_goal_stretch}
              markers={[
                { position: goals.team_monthly_goal_floor, label: "Minimum" },
                { position: goals.team_monthly_goal_target, label: "Ziel" },
                { position: goals.team_leader_bonus_threshold, label: "TL-Bonus" },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Rangliste — {monthLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Verkäufe diesen Monat.</p>
          ) : (
            <ol className="flex flex-col divide-y">
              {leaderboard.map((row, i) => (
                <li key={row.agentId} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                    {row.name}
                  </span>
                  <span className="font-medium">{eur.format(row.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
