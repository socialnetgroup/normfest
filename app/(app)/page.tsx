import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { LogCallButton } from "@/components/log-call-button";
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
import { getCurrentUser } from "@/lib/auth";
import { signalTypeLabel, signalTypeVariant } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const ONLINE_THRESHOLD_MS = 90_000;

function pathLabel(path: string | null): string {
  if (!path) return "";
  if (path === "/") return "Dashboard";
  if (path.startsWith("/firmen/")) return "Firmenprofil";
  if (path === "/firmen") return "Firmen";
  if (path.startsWith("/katalog/")) return "Produktseite";
  if (path === "/katalog") return "Katalog";
  if (path.startsWith("/fokus")) return "Fokus";
  if (path.startsWith("/wissen")) return "Wissen";
  if (path.startsWith("/skript")) return "Skript";
  if (path.startsWith("/assistent")) return "Assistent";
  if (path.startsWith("/admin")) return "Admin";
  return path;
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type SettingsMap = Record<string, number>;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { user, profile } = await getCurrentUser();

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

  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  const threeMonthsAgoStr = threeMonthsAgo.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  const [
    { data: monthRows },
    { count: feedbackCountThisWeek },
    { data: topSignals },
    { count: signalsTotal },
    { count: uncontactedCount },
    { count: totalCompanies },
    { data: myToday },
    { data: coverageAgents },
    { data: coverageStats },
    { data: loginStatusRows },
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
      .or(`last_contact_date.is.null,last_contact_date.lt.${threeMonthsAgoStr}`),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    myAgent
      ? supabase
          .from("agent_daily_performance")
          .select("sales_count, calls_count")
          .eq("agent_id", myAgent.id)
          .eq("date", todayStr)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("agents").select("id, full_name, gebiet").eq("active", true)
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase
          .from("company_gebiet_coverage")
          .select("gebiet, total, not_contacted_this_month, not_contacted_last_2_months, not_contacted_last_3_months")
      : Promise.resolve({ data: null }),
    isAdmin ? supabase.rpc("fn_get_agent_login_status") : Promise.resolve({ data: null }),
  ]);

  const byAgent = new Map<string, { name: string; revenue: number }>();
  for (const row of monthRows ?? []) {
    const name = (row.agents as { full_name: string } | null)?.full_name;
    if (!name) continue;
    const entry = byAgent.get(row.agent_id) ?? { name, revenue: 0 };
    entry.revenue += row.revenue;
    byAgent.set(row.agent_id, entry);
  }

  // "Online/offline" combines two signals: has this agent ever logged in
  // (auth.users.last_sign_in_at), and a real heartbeat (profiles.last_seen_at/
  // last_seen_path, pinged every 30s by HeartbeatPing while a tab is open) -
  // "online" means a heartbeat within the last 90s, not just "logged in once".
  // Both come through fn_get_agent_login_status() (security definer, admin-
  // gated - auth.users isn't selectable directly by the authenticated role).
  type LoginStatus = "none" | "created" | "idle" | "online";
  const loginStatusByAgent = new Map<string, { status: LoginStatus; path: string | null }>();
  for (const row of loginStatusRows ?? []) {
    const isOnline = row.last_seen_at ? now.getTime() - new Date(row.last_seen_at).getTime() < ONLINE_THRESHOLD_MS : false;
    const status: LoginStatus = !row.has_account
      ? "none"
      : isOnline
        ? "online"
        : row.last_sign_in_at
          ? "idle"
          : "created";
    loginStatusByAgent.set(row.agent_id, { status, path: isOnline ? row.last_seen_path : null });
  }
  const emptyLoginStatus = { status: "none" as LoginStatus, path: null };

  const leaderboard = [...byAgent.entries()]
    .map(([agentId, v]) => ({ agentId, loginStatus: loginStatusByAgent.get(agentId) ?? emptyLoginStatus, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const teamRevenue = leaderboard.reduce((sum, a) => sum + a.revenue, 0);
  const myRevenue = myAgent ? (byAgent.get(myAgent.id)?.revenue ?? 0) : null;

  const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date());

  const uncontacted = uncontactedCount ?? 0;
  const uncontactedSevere = uncontacted >= 500;

  // Firmen have no direct agent_id - the link is companies.gebiet <-> agents.gebiet
  // (each agent owns one Gebiet code, per §4.11). Aggregated in Postgres via the
  // company_gebiet_coverage view (GROUP BY gebiet) rather than client-side over
  // all 13.5k companies - an earlier version hit PostgREST's default 1000-row
  // cap on an unpaginated select and silently undercounted.
  type CoverageStats = {
    total: number;
    notContactedThisMonth: number;
    notContactedLast2Months: number;
    notContactedLast3Months: number;
  };
  const emptyCoverage: CoverageStats = {
    total: 0,
    notContactedThisMonth: 0,
    notContactedLast2Months: 0,
    notContactedLast3Months: 0,
  };
  const byGebiet = new Map<string, CoverageStats>();
  for (const row of coverageStats ?? []) {
    if (!row.gebiet) continue;
    byGebiet.set(row.gebiet, {
      total: row.total ?? 0,
      notContactedThisMonth: row.not_contacted_this_month ?? 0,
      notContactedLast2Months: row.not_contacted_last_2_months ?? 0,
      notContactedLast3Months: row.not_contacted_last_3_months ?? 0,
    });
  }

  const assignedGebiete = new Set((coverageAgents ?? []).map((a) => a.gebiet));
  const coverage = [
    ...(coverageAgents ?? []).map((a) => ({
      label: a.full_name,
      agentId: a.id as string | null,
      ...(byGebiet.get(a.gebiet) ?? emptyCoverage),
    })),
  ].sort((a, b) => b.notContactedLast3Months - a.notContactedLast3Months);

  const unassignedTotals = [...byGebiet.entries()]
    .filter(([gebiet]) => !assignedGebiete.has(gebiet))
    .reduce(
      (sum, [, v]) => ({
        total: sum.total + v.total,
        notContactedThisMonth: sum.notContactedThisMonth + v.notContactedThisMonth,
        notContactedLast2Months: sum.notContactedLast2Months + v.notContactedLast2Months,
        notContactedLast3Months: sum.notContactedLast3Months + v.notContactedLast3Months,
      }),
      emptyCoverage,
    );
  if (unassignedTotals.total > 0) {
    coverage.push({ label: "Nicht zugeordnet", agentId: null, ...unassignedTotals });
  }

  const dayOfMonth = new Date().getDate();

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? <AutoRefresh intervalMs={30_000} /> : null}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Firmen gesamt" value={String(totalCompanies ?? 0)} accent="primary" />
        <StatTile label="Team-Umsatz" value={eur.format(teamRevenue)} accent="primary" />
        <StatTile label="Feedback diese Woche" value={String(feedbackCountThisWeek ?? 0)} accent="success" />
        <StatTile
          label="Nicht kontaktiert (3+ Mon.)"
          value={String(uncontacted)}
          accent={uncontactedSevere ? "warning" : "secondary"}
          href={isAdmin ? "#kontakt-abdeckung" : undefined}
        />
        <StatTile label="Signale offen" value={String(signalsTotal ?? 0)} accent="secondary" />
      </div>

      {myAgent ? (
        <Card>
          <CardHeader>
            <CardTitle>Mein Ziel - {myAgent.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <LogSaleForm />
              <LogCallButton />
              <span className="pb-1.5 text-sm text-muted-foreground">
                Heute: {myToday?.sales_count ?? 0} Sales · {myToday?.calls_count ?? 0} Anrufe
              </span>
            </div>
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
                    {isAdmin ? (
                      <Link
                        href={`/admin/team/${row.agentId}`}
                        className={cn("hover:underline", i === 0 ? "font-semibold" : undefined)}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className={i === 0 ? "font-semibold" : undefined}>{row.name}</span>
                    )}
                    {isAdmin
                      ? (() => {
                          const statusLabel =
                            row.loginStatus.status === "online"
                              ? `Online${row.loginStatus.path ? ` - ${pathLabel(row.loginStatus.path)}` : ""}`
                              : row.loginStatus.status === "idle"
                                ? "Angemeldet, gerade nicht aktiv"
                                : row.loginStatus.status === "created"
                                  ? "Konto erstellt, noch nie angemeldet"
                                  : "Noch kein Konto";
                          return (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                row.loginStatus.status === "online"
                                  ? "bg-success/20 text-success-foreground"
                                  : row.loginStatus.status === "idle"
                                    ? "bg-primary/15 text-primary"
                                    : row.loginStatus.status === "created"
                                      ? "bg-warning/20 text-warning-foreground"
                                      : "bg-muted text-muted-foreground",
                              )}
                            >
                              {statusLabel}
                            </span>
                          );
                        })()
                      : null}
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
            <CardTitle>Signale</CardTitle>
            {isAdmin ? <RefreshSignalsButton /> : null}
          </CardHeader>
          <CardContent>
            {!topSignals || topSignals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Signale berechnet.</p>
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

      {isAdmin && coverage.length > 0 ? (
        <Card id="kontakt-abdeckung" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Kontakt-Abdeckung nach Agent</CardTitle>
            <p className="text-sm text-muted-foreground">
              Firmen je Gebiet, aufgeschlüsselt danach wie viele seit unterschiedlich langer Zeit nicht kontaktiert
              wurden - laut <span className="font-medium">Dat.l.Kontakt</span> (last_contact_date) aus der VIS-Liste.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Agent</th>
                    <th className="px-2 py-2 font-medium">Firmen gesamt</th>
                    <th className="px-2 py-2 font-medium">Nicht kontaktiert diesen Monat ({dayOfMonth}. Tag)</th>
                    <th className="px-2 py-2 font-medium">Nicht kontaktiert (2+ Mon.)</th>
                    <th className="px-2 py-2 font-medium">Nicht kontaktiert (3+ Mon.)</th>
                    <th className="px-2 py-2 font-medium">Anteil (3+ Mon.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {coverage.map((row) => {
                    const pct = row.total > 0 ? row.notContactedLast3Months / row.total : 0;
                    return (
                      <tr key={row.label} className={row.label === "Nicht zugeordnet" ? "opacity-60" : undefined}>
                        <td className="px-2 py-2 font-medium">
                          {row.agentId ? (
                            <Link href={`/admin/team/${row.agentId}`} className="hover:underline">
                              {row.label}
                            </Link>
                          ) : (
                            row.label
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums">{row.total}</td>
                        <td className="px-2 py-2 tabular-nums">{row.notContactedThisMonth}</td>
                        <td className="px-2 py-2 tabular-nums">{row.notContactedLast2Months}</td>
                        <td className="px-2 py-2 tabular-nums">{row.notContactedLast3Months}</td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              "tabular-nums",
                              pct >= 0.4 ? "font-medium text-warning-foreground" : "text-muted-foreground",
                            )}
                          >
                            {Math.round(pct * 100)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
