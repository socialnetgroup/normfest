import Link from "next/link";

import { LogSaleForm } from "@/components/log-sale-form";
import { ProgressBar } from "@/components/progress-bar";
import { RefreshSignalsButton } from "@/components/refresh-signals-button";
import { SignalDismissButton } from "@/components/signal-dismiss-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { signalTypeLabel, signalTypeVariant } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type SettingsMap = Record<string, number>;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: myAgent }, { data: settingsRows }, { data: profile }] = await Promise.all([
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
    user ? supabase.from("profiles").select("role").eq("id", user.id).single() : Promise.resolve({ data: null }),
  ]);
  const isAdmin = profile?.role === "admin";

  const goals: SettingsMap = {};
  for (const row of settingsRows ?? []) {
    goals[row.key] = Number(row.value);
  }

  const now = new Date();
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setMonth(now.getMonth() - 2);
  const twoMonthsAgoStr = twoMonthsAgo.toISOString().slice(0, 10);

  const [
    { data: monthRows },
    { count: feedbackCountThisWeek },
    { data: topSignals },
    { count: signalsTotal },
    { count: uncontactedCount },
  ] = await Promise.all([
    supabase
      .from("agent_daily_performance")
      .select("agent_id, revenue, agents(full_name)")
      .gte("date", monthStartStr),
    supabase
      .from("sales_feedback")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString()),
    supabase
      .from("signals")
      .select("id, type, score, reason, company_id, product_id, companies(name)")
      .order("score", { ascending: false })
      .limit(8),
    supabase.from("signals").select("id", { count: "exact", head: true }),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("do_not_contact", false)
      .or(`last_contact_date.is.null,last_contact_date.lt.${twoMonthsAgoStr}`),
  ]);

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

  const uncontacted = uncontactedCount ?? 0;
  const uncontactedSevere = uncontacted >= 500;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Team-Umsatz" value={eur.format(teamRevenue)} accent="primary" />
        <StatTile label="Feedback diese Woche" value={String(feedbackCountThisWeek ?? 0)} accent="success" />
        <StatTile label="Empfehlungen offen" value={String(signalsTotal ?? 0)} accent="secondary" />
        <StatTile
          label="Nicht kontaktiert (2+ Mon.)"
          value={String(uncontacted)}
          accent={uncontactedSevere ? "warning" : "secondary"}
        />
      </div>

      {myAgent ? (
        <Card>
          <CardHeader>
            <CardTitle>Mein Ziel - {myAgent.full_name}</CardTitle>
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
          <CardTitle>Rangliste - {monthLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Verkäufe diesen Monat.</p>
          ) : (
            <ol className="flex flex-col divide-y">
              {leaderboard.map((row, i) => (
                <li key={row.agentId} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-xs font-bold",
                        i === 0
                          ? "bg-warning/25 text-warning-foreground"
                          : i === 1 || i === 2
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className={i === 0 ? "font-semibold" : undefined}>{row.name}</span>
                  </span>
                  <span className={cn("tabular-nums", i === 0 ? "font-bold text-primary" : "font-medium")}>
                    {eur.format(row.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {(topSignals && topSignals.length > 0) || isAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Top-Empfehlungen</CardTitle>
            {isAdmin ? <RefreshSignalsButton /> : null}
          </CardHeader>
          <CardContent>
            {!topSignals || topSignals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Empfehlungen berechnet.</p>
            ) : (
            <ul className="flex flex-col divide-y">
              {topSignals.map((s) => (
                <li key={s.id} className="flex items-start gap-2 py-2.5 text-sm">
                  <Link
                    href={`/firmen/${s.company_id}`}
                    className="flex flex-1 items-start justify-between gap-3 hover:underline"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={signalTypeVariant(s.type)}>{signalTypeLabel(s.type)}</Badge>
                        <span className="font-medium">
                          {(s.companies as { name: string } | null)?.name}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{s.reason}</p>
                    </div>
                  </Link>
                  <SignalDismissButton companyId={s.company_id} type={s.type} productId={s.product_id} />
                </li>
              ))}
            </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
