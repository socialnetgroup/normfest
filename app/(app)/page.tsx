import { BellRing } from "lucide-react";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { LogSaleForm } from "@/components/log-sale-form";
import { ProgressBar } from "@/components/progress-bar";
import { RefreshSignalsButton } from "@/components/refresh-signals-button";
import { SignalDismissButton } from "@/components/signal-dismiss-button";
import { WiedervorlageDoneButton } from "@/components/wiedervorlage-done-button";
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

// Real gap found 2026-08-14 (Anis: "provjeri da li prepoznaje sve urlove
// toola") - this hadn't been kept in sync with real nav routes added since
// it was written; /feedback, /email-liste, /meine-ergebnisse, /konto, and
// /dialer all fell through to the raw path instead of a real German label.
function pathLabel(path: string | null): string {
  if (!path) return "";
  if (path === "/") return "Dashboard";
  if (path.startsWith("/firmen/")) return "Firmenprofil";
  if (path === "/firmen") return "Firmen";
  if (path.startsWith("/katalog/")) return "Produktseite";
  if (path === "/katalog") return "Katalog";
  if (path.startsWith("/fokus")) return "Fokus";
  if (path.startsWith("/feedback")) return "Feedback";
  if (path.startsWith("/email-liste")) return "Email-Liste";
  if (path.startsWith("/wissen")) return "Wissen";
  if (path.startsWith("/skript")) return "Skript";
  if (path.startsWith("/assistent")) return "Assistent";
  if (path.startsWith("/meine-ergebnisse")) return "Meine Ergebnisse";
  if (path.startsWith("/konto")) return "Mein Konto";
  if (path.startsWith("/dialer")) return "Dialer";
  if (path.startsWith("/admin")) return "Admin";
  return path;
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const shortDateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

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

  const todayStr = now.toISOString().slice(0, 10);

  const [
    { data: monthRows },
    { count: feedbackCountThisWeek },
    { count: myFeedbackCountThisWeek },
    { data: topSignals },
    { data: signalsTotal },
    { data: companyCountsRows },
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
    // Agent-facing "Feedback diese Woche" tile shows only the caller's own
    // count (Anis, 2026-08-10: "nur seine eigenen feedbacks sehen") - the
    // admin tile above stays team-wide (the original flywheel-adoption
    // widget). sales_feedback.agent_id references profiles.id (user.id),
    // same identifier fn_log_sales_feedback and the /feedback page's own
    // agent-scoping already use.
    user
      ? supabase
          .from("sales_feedback")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", user.id)
          .gte("created_at", weekStart.toISOString())
      : Promise.resolve({ count: 0 }),
    // RPC instead of two direct .from("signals") queries -- signals grew to
    // ~97k rows this session and its RLS policy now also needs to check
    // Gebiet visibility (Anis: agents should only see signals for their own
    // companies), which the same opaque-per-row-check problem would make
    // catastrophically slow at this scale. fn_dashboard_top_signals()/
    // fn_dashboard_signals_count() evaluate the visibility check once; also
    // split into two calls rather than one with `count(*) over()`, since
    // that window function forced materializing/sorting the whole
    // gebiet-filtered set before the LIMIT could apply (measured ~2.15s
    // combined vs ~6ms + ~580ms split). See 20260731060000_signals_gebiet_visibility.sql.
    supabase.rpc("fn_dashboard_top_signals", { p_limit: 8 }),
    supabase.rpc("fn_dashboard_signals_count"),
    // RPC instead of direct .from("companies") counts -- a direct count goes
    // through RLS's companies_select_visible policy, whose fn_company_visible()
    // predicate forces a per-row function call on a full Seq Scan (measured
    // ~2.7s EACH). fn_dashboard_company_counts() replicates the same
    // visibility rule once instead of per row, and now also returns the
    // this-month/2-month/3-month not-contacted breakdown (same numbers admin
    // sees per-agent in "Kontakt-Abdeckung", scoped to the caller) instead of
    // a single 3-month bucket. See 20260731090000_fn_dashboard_company_counts_breakdown.sql.
    supabase.rpc("fn_dashboard_company_counts"),
    myAgent
      ? supabase
          .from("agent_daily_performance")
          .select("sales_count")
          .eq("agent_id", myAgent.id)
          .eq("date", todayStr)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("agents").select("id, full_name, gebiet").eq("active", true)
      : Promise.resolve({ data: null }),
    // RPC instead of the security_invoker `company_gebiet_coverage` view --
    // same RLS-defeats-the-plan issue as the two RPCs above: reading the view
    // under RLS evaluated fn_company_visible() on all 14,347 rows for its
    // GROUP BY (measured ~3.26s). fn_company_gebiet_coverage() is admin-gated
    // explicitly and does the aggregation without per-row RLS overhead
    // (measured ~28ms). See 20260731040000_fn_company_gebiet_coverage.sql.
    isAdmin ? supabase.rpc("fn_company_gebiet_coverage") : Promise.resolve({ data: null }),
    isAdmin ? supabase.rpc("fn_get_agent_login_status") : Promise.resolve({ data: null }),
  ]);

  // Wiedervorlagen fällig heute oder überfällig. Originally team-weit
  // sichtbar (Anis, 2026-08-06: "sve da vidi od svih") - but that predates
  // visibility_mode='gebiet' going live (§14 item 16, 2026-07-31). Once
  // gebiet-scoping was on, `companies(name)` in this join is RLS-gated to
  // the caller's own gebiet, so a non-admin's team-wide sales_feedback rows
  // for OTHER agents' companies still came back (sales_feedback itself is
  // shared-visible), just with a null company name - real bug found
  // 2026-08-14: an agent saw "10 Wiedervorlagen" but only their own ~2
  // rendered with real company/comment, the rest as blank placeholders.
  // Fixed by scoping non-admins to their own agent_id (matching how every
  // other gebiet-scoped feature in this app already works - Firmen list,
  // signals, Email-Liste); admins keep the team-wide view since their RLS
  // isn't gebiet-restricted, so the join never comes back null for them.
  let dueWiedervorlagenBuilder = supabase
    .from("sales_feedback")
    .select("id, company_id, comment, wiedervorlage_date, companies(name), profiles(full_name)")
    .not("wiedervorlage_date", "is", null)
    .eq("wiedervorlage_done", false)
    .lte("wiedervorlage_date", todayStr)
    .order("wiedervorlage_date", { ascending: true })
    .limit(20);
  if (!isAdmin && user) dueWiedervorlagenBuilder = dueWiedervorlagenBuilder.eq("agent_id", user.id);
  const { data: dueWiedervorlagen } = await dueWiedervorlagenBuilder;

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

  const totalCompanies = companyCountsRows?.[0]?.total_count ?? 0;
  const notContactedThisMonth = companyCountsRows?.[0]?.not_contacted_this_month ?? 0;
  const notContacted2Months = companyCountsRows?.[0]?.not_contacted_2months ?? 0;
  const uncontacted = companyCountsRows?.[0]?.not_contacted_3months ?? 0;
  const uncontactedSevere = uncontacted >= 500;
  const uncontactedShare = totalCompanies > 0 ? uncontacted / totalCompanies : 0;

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

      {isAdmin ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Firmen gesamt" value={String(totalCompanies ?? 0)} accent="primary" />
          <StatTile label="Team-Umsatz" value={eur.format(teamRevenue)} accent="primary" />
          <StatTile label="Feedback diese Woche" value={String(feedbackCountThisWeek ?? 0)} accent="success" href="/feedback" />
          <StatTile
            label="Nicht kontaktiert (3+ Mon.)"
            value={String(uncontacted)}
            accent={uncontactedSevere ? "warning" : "secondary"}
            href="#kontakt-abdeckung"
          />
          <StatTile label="Signale offen" value={String(signalsTotal ?? 0)} accent="secondary" />
        </div>
      ) : (
        // Agent view (Anis, 2026-07-31): Firmen gesamt first, then the same
        // not-contacted breakdown admin sees per-agent in "Kontakt-Abdeckung"
        // (now scoped to this agent's own Gebiet via fn_dashboard_company_counts),
        // then Feedback diese Woche. No Signale offen (redundant with the
        // Empfehlungen list below) and no Team-Umsatz (redundant with the
        // Team-Ziel/Mein Ziel cards right below).
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Firmen gesamt" value={String(totalCompanies ?? 0)} accent="primary" />
          <StatTile label={`Nicht kontaktiert diesen Monat (${dayOfMonth}. Tag)`} value={String(notContactedThisMonth)} accent="secondary" />
          <StatTile label="Nicht kontaktiert (2+ Mon.)" value={String(notContacted2Months)} accent="secondary" />
          <StatTile
            label="Nicht kontaktiert (3+ Mon.)"
            value={String(uncontacted)}
            accent={uncontactedSevere ? "warning" : "secondary"}
          />
          <StatTile label="Anteil (3+ Mon.)" value={`${Math.round(uncontactedShare * 100)}%`} accent={uncontactedShare >= 0.4 ? "warning" : "secondary"} />
          <StatTile label="Feedback diese Woche" value={String(myFeedbackCountThisWeek ?? 0)} accent="success" href="/feedback" />
        </div>
      )}

      {myAgent ? (
        <Card>
          <CardHeader>
            <CardTitle>Mein Ziel - {myAgent.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <LogSaleForm />
              <span className="pb-1.5 text-sm text-muted-foreground">
                Heute: {myToday?.sales_count ?? 0} Sales
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
            <div className="mb-1 text-sm font-medium">{eur.format(teamRevenue)}</div>
            <ProgressBar
              value={teamRevenue}
              // Deliberately more than the stretch goal (Anis, 2026-07-31:
              // the stretch marker sitting right at the bar's own 100% edge
              // clipped its label and made the bar read as "full"/capped).
              // Headroom past stretch keeps the label inside the bar and
              // visually signals there's still more to reach for.
              max={goals.team_monthly_goal_stretch * 1.15}
              markers={[
                { position: goals.team_monthly_goal_floor, label: eur.format(goals.team_monthly_goal_floor) },
                { position: goals.team_monthly_goal_target, label: eur.format(goals.team_monthly_goal_target) },
                { position: goals.team_monthly_goal_stretch, label: eur.format(goals.team_monthly_goal_stretch) },
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

      {dueWiedervorlagen && dueWiedervorlagen.length > 0 ? (
        <Card className="border-l-4 border-l-warning">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-4 text-warning-foreground" />
              Wiedervorlagen fällig ({dueWiedervorlagen.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {dueWiedervorlagen.map((w) => {
                const company = w.companies as { name: string } | null;
                const agent = w.profiles as { full_name: string | null } | null;
                const overdue = w.wiedervorlage_date! < todayStr;
                return (
                  <li key={w.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={overdue ? "destructive" : "warning"}>
                          {shortDateFmt.format(new Date(w.wiedervorlage_date!))}
                        </Badge>
                        <Link href={`/firmen/${w.company_id}`} className="font-medium hover:underline">
                          {company?.name ?? "-"}
                        </Link>
                        <span className="text-muted-foreground">· {agent?.full_name ?? "-"}</span>
                      </div>
                      {w.comment ? <p className="mt-1 text-muted-foreground">{w.comment}</p> : null}
                    </div>
                    <WiedervorlageDoneButton id={w.id} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

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
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={signalTypeVariant(s.type)}>{signalTypeLabel(s.type)}</Badge>
                      <Link href={`/firmen/${s.company_id}`} className="font-medium hover:underline">
                        {s.company_name}
                      </Link>
                      {s.product_id && s.product_name ? (
                        <>
                          <span className="text-muted-foreground">→</span>
                          <Link href={`/katalog/${s.product_id}`} className="font-medium text-primary hover:underline">
                            {s.product_name}
                          </Link>
                        </>
                      ) : null}
                    </div>
                    {isAdmin ? <p className="mt-1 text-muted-foreground">{s.reason}</p> : null}
                  </div>
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
