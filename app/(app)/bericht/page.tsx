import { BarChart3, TrendingUp, Sparkles, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computeBonusByDate, type BonusThreshold } from "@/lib/team/bonus";
import {
  buildDialerAgentSummaries,
  computeDialerTotals,
  fetchDialerAgentStatuses,
  formatSecondsAsHms,
} from "@/lib/dialer/status";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const minutesFmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num = (n: number) => n.toLocaleString("de-DE");

const ONLINE_THRESHOLD_MS = 90_000;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return capitalize(
    new Intl.DateTimeFormat("bs", { month: "long", year: "numeric" }).format(new Date(Number(year), Number(m) - 1, 1)),
  );
}

// Anis, 2026-08-17: "a kinda of viewing angle wheres the project at" - one
// live-computed overview page for report@ (and admin, for QA). Deliberately
// excludes Signale/Bestellungen/Fokus/Anreicherung-Katalog per Anis's own
// framing ("they dont care so deep operational") - real business-level
// numbers only: Umsatz (compact monthly summary here - the full per-agent
// deep-dive moved to its own "Tim" menu page), contact coverage per agent,
// flywheel adoption (feedback + Wiedervorlagen), Dialer volume, and
// AI-Assistent usage.
export default async function BerichtPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin" && profile?.role !== "report") notFound();

  const supabase = await createClient();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonthKey = todayStr.slice(0, 7);
  const dayOfMonth = now.getDate();
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

  const [
    { data: reportStatsRows },
    { count: feedbackTotal },
    { count: feedbackWeek },
    { count: feedbackPrevWeek },
    { count: feedbackToday },
    { count: wiedervorlageOpen },
    { count: wiedervorlageOverdue },
    { data: perfRows },
    { data: allAgents },
    { data: bonusSettingsRows },
    { data: coverageStats },
    { data: loginStatusRows },
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
    // Kompletna historija (bez datumskog ograničenja) - potrebno i za tačan
    // "dnevni prosjek" (stvarni broj radnih dana, ne kalendarski) i za
    // mjesečni sažetak ispod.
    supabase
      .from("agent_daily_performance")
      .select("agent_id, date, revenue, sales_count, calls_count, day_off"),
    supabase.from("agents").select("id, full_name, gebiet").eq("active", true),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]),
    // Ista tabela kao na admin Dashboardu ("Kontakt-Abdeckung nach Agent") -
    // fn_company_gebiet_coverage() prošireno da dozvoli i report@ (migracija
    // 20260817020000, isti potpis funkcije, samo širi provjera pristupa).
    supabase.rpc("fn_company_gebiet_coverage"),
    // "Aktivni agenti trenutno" KPI - isti RPC/prag kao /dialer's "Status im
    // Tool" (fn_get_agent_login_status, prošireno za report@ u migraciji
    // 20260817030000).
    supabase.rpc("fn_get_agent_login_status"),
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
        (perfRows ?? []).map((r) => ({ agentId: r.agent_id, date: r.date, revenue: r.revenue, dayOff: r.day_off })),
        thresholds,
        minContributionPct,
        minQualifyingAgents,
      )
    : null;

  const teamRevenueToday = (perfRows ?? [])
    .filter((r) => r.date === todayStr && !r.day_off)
    .reduce((sum, r) => sum + r.revenue, 0);
  const teamRevenueWeek = (perfRows ?? [])
    .filter((r) => r.date >= weekStart.toISOString().slice(0, 10) && !r.day_off)
    .reduce((sum, r) => sum + r.revenue, 0);
  const teamRevenuePrevWeek = (perfRows ?? [])
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

  // Mjesečni sažetak (timski nivo, ne po agentu - puna deep-dive tabela po
  // agentu je premještena na zasebnu "Tim" stranicu, Anis 2026-08-17: "Vrati
  // kao sto je bilo pregled po mjesecu promet npr rezimirano ali sa
  // dodatnim detaljima").
  type MonthSummary = { revenue: number; sales: number; calls: number; bonusKm: number };
  const byMonth = new Map<string, MonthSummary>();
  // Stvarni promet po datumu (za sve agente zajedno) - koristi se za "dnevni
  // prosjek" da se dijeli sa stvarnim brojem radnih dana, ne kalendarskih.
  const revenueByDate = new Map<string, number>();
  for (const row of perfRows ?? []) {
    if (row.day_off) continue;
    const month = row.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { revenue: 0, sales: 0, calls: 0, bonusKm: 0 };
    entry.revenue += row.revenue;
    entry.sales += row.sales_count;
    entry.calls += row.calls_count ?? 0;
    entry.bonusKm += bonusByDate?.get(row.date)?.get(row.agent_id) ?? 0;
    byMonth.set(month, entry);
    revenueByDate.set(row.date, (revenueByDate.get(row.date) ?? 0) + row.revenue);
  }
  const months = [...byMonth.keys()].sort().reverse();
  const teamRevenueMonth = byMonth.get(currentMonthKey)?.revenue ?? 0;

  // Dnevni prosjek prometa - Anis, 2026-08-17: "2339 euro dnevno prosjek
  // prometa nije tacan, ja racunam oko 3576 eura? kako smo razliciti
  // brojevi". Prvobitna verzija je dijelila sa SVIM kalendarskim danima
  // dosad prošlim u mjesecu (uklj. vikende, kad niko ne radi) - to umjetno
  // snižava prosjek, jer vikendi ulaze u nazivnik sa 0 € prometa. Ispravno:
  // dijeliti samo sa stvarnim danima koji imaju bar nešto prometa (tj.
  // stvarno odrađenim radnim danima), izvedeno direktno iz podataka umjesto
  // pretpostavljanja radne sedmice - automatski isključuje vikende (0 €) i
  // eventualne buduće/anomalne redove u fajlu (jer su isto 0 € do danas).
  function realWorkingDaysInMonth(month: string): number {
    let count = 0;
    for (const [date, revenue] of revenueByDate) {
      if (!date.startsWith(month)) continue;
      if (month === currentMonthKey && date > todayStr) continue;
      if (revenue > 0) count++;
    }
    return count;
  }
  const dailyAvgRevenueMonth = teamRevenueMonth / Math.max(1, realWorkingDaysInMonth(currentMonthKey));

  // Projektovani promet za tekući mjesec - Anis, 2026-08-18: "Dodati
  // PROJEKTOVANI OČEKIVANI PROMET ZA TEKUĆI MJESEC u Tiles". Run-rate
  // procjena: stvarni dnevni prosjek (već izračunat gore, dijeljen sa
  // stvarnim radnim danima dosad) pomnožen sa UKUPNIM brojem radnih dana
  // (pon-pet) u cijelom mjesecu - ne kalendarskim danima, jer se vikendom
  // ne radi (isti princip kao "Dnevni prosjek prometa" iznad).
  function totalWeekdaysInMonth(month: string): number {
    const [year, m] = month.split("-").map(Number);
    const daysInMonth = new Date(year, m, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }
  const projectedRevenueMonth = dailyAvgRevenueMonth * totalWeekdaysInMonth(currentMonthKey);

  // "Online agenti trenutno" - isti prag/logika kao /dialer's Status im
  // Tool (fn_get_agent_login_status + 90s heartbeat prag).
  const activeAgentsNow = (loginStatusRows ?? []).filter(
    (row) => row.last_seen_at && now.getTime() - new Date(row.last_seen_at).getTime() < ONLINE_THRESHOLD_MS,
  ).length;

  // Kontakt-Abdeckung (identična logika kao app/(app)/page.tsx - admin
  // Dashboard, namjerno kopirano, ne izdvojeno, jer je jedina druga upotreba
  // i ne vrijedi dodavati zajedničku helper funkciju za dva poziva).
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
  const coverageByGebiet = new Map<string, CoverageStats>();
  for (const row of coverageStats ?? []) {
    if (!row.gebiet) continue;
    coverageByGebiet.set(row.gebiet, {
      total: row.total ?? 0,
      notContactedThisMonth: row.not_contacted_this_month ?? 0,
      notContactedLast2Months: row.not_contacted_last_2_months ?? 0,
      notContactedLast3Months: row.not_contacted_last_3_months ?? 0,
    });
  }
  const assignedGebiete = new Set((allAgents ?? []).map((a) => a.gebiet));
  const coverage = [
    ...(allAgents ?? []).map((a) => ({
      label: a.full_name,
      agentId: a.id as string | null,
      ...(coverageByGebiet.get(a.gebiet) ?? emptyCoverage),
    })),
  ].sort((a, b) => b.notContactedLast3Months - a.notContactedLast3Months);
  const unassignedTotals = [...coverageByGebiet.entries()]
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
    coverage.push({ label: "Nedodijeljeno", agentId: null, ...unassignedTotals });
  }

  const { data: dialerRows, error: dialerError } = await fetchDialerAgentStatuses();
  const dialerTotals =
    !dialerError && dialerRows ? computeDialerTotals(buildDialerAgentSummaries(dialerRows, allAgents ?? [], new Map())) : null;
  const talkShare = dialerTotals && dialerTotals.totalSeconds > 0 ? dialerTotals.talkSeconds / dialerTotals.totalSeconds : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Izvještaj</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Uživo - stanje {new Intl.DateTimeFormat("bs", { dateStyle: "long", timeStyle: "short" }).format(now)}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Timski promet (mjesec)"
          value={eur.format(teamRevenueMonth)}
          sub={`Danas: ${eur.format(teamRevenueToday)}`}
          accent="primary"
        />
        <StatTile label="Dnevni prosjek prometa" value={eur.format(dailyAvgRevenueMonth)} accent="primary" />
        <StatTile
          label="Projektovani promet (mjesec)"
          value={eur.format(projectedRevenueMonth)}
          sub="Na osnovu dnevnog prosjeka"
          accent="primary"
        />
        <StatTile
          label="Feedback ukupno"
          value={num(feedbackTotal ?? 0)}
          sub={`Ove sedmice: ${num(feedbackWeek ?? 0)} · Danas: ${num(feedbackToday ?? 0)}`}
          accent="success"
        />
        <StatTile label="Online agenti trenutno" value={num(activeAgentsNow)} accent="secondary" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="size-4 text-primary" />
            Dialer (danas)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dialerError || !dialerTotals ? (
            <p className="text-sm text-muted-foreground">Dialer podaci trenutno nisu dostupni.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatTile label="Pozivi ukupno" value={num(dialerTotals.totalCalls)} accent="secondary" />
              <StatTile
                label="Vrijeme razgovora"
                value={formatSecondsAsHms(dialerTotals.talkSeconds)}
                sub={talkShare !== null ? `${pct.format(talkShare)} od ukupnog vremena` : undefined}
                accent="secondary"
              />
              <StatTile
                label="Prosječno vrijeme obrade"
                value={`${minutesFmt.format(dialerTotals.ahtSeconds / 60)} min`}
                accent="secondary"
              />
              <StatTile label="Zauzetost" value={pct.format(dialerTotals.occupancy)} accent="secondary" />
              <StatTile label="Konverzija (Prodaje/Pozivi)" value={pct.format(dialerTotals.conversion)} accent="success" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            Promet
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ove sedmice: <span className="font-medium tabular-nums text-foreground">{eur.format(teamRevenueWeek)}</span>
            {revenueWowDelta !== null ? (
              <span className={revenueWowDelta >= 0 ? "text-success-foreground" : "text-destructive"}>
                {" "}
                ({revenueWowDelta >= 0 ? "+" : ""}
                {pct.format(revenueWowDelta)} u odnosu na prošlu sedmicu, isti period)
              </span>
            ) : null}
          </p>
        </CardHeader>
        <CardContent>
          {months.length === 0 ? (
            <p className="text-sm text-muted-foreground">Još nema uvezenih podataka.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Mjesec</th>
                    <th className="px-2 py-2 font-medium">Timski promet</th>
                    <th className="px-2 py-2 font-medium">Dnevni prosjek</th>
                    <th className="px-2 py-2 font-medium">Prodaje</th>
                    <th className="px-2 py-2 font-medium">Pozivi ukupno</th>
                    <th className="px-2 py-2 font-medium">Konverzija</th>
                    {bonusVisible ? <th className="px-2 py-2 font-medium">Timski bonus</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {months.map((m) => {
                    const v = byMonth.get(m)!;
                    const conversion = v.calls > 0 ? v.sales / v.calls : null;
                    const dailyAvg = v.revenue / Math.max(1, realWorkingDaysInMonth(m));
                    return (
                      <tr key={m}>
                        <td className="px-2 py-2 font-medium">{monthLabel(m)}</td>
                        <td className="px-2 py-2 tabular-nums">{eur.format(v.revenue)}</td>
                        <td className="px-2 py-2 tabular-nums">{eur.format(dailyAvg)}</td>
                        <td className="px-2 py-2 tabular-nums">{v.sales}</td>
                        <td className="px-2 py-2 tabular-nums">{v.calls || "-"}</td>
                        <td className="px-2 py-2 tabular-nums">{conversion !== null ? pct1.format(conversion) : "-"}</td>
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
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Puni pregled po agentu, po mjesecu:{" "}
            <Link href="/tim" className="underline">
              Tim →
            </Link>
          </p>
        </CardContent>
      </Card>

      {coverage.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              Pokrivenost kontakata po agentu
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Firme po području, raščlanjeno po tome koliko dugo nisu kontaktirane - prema{" "}
              <span className="font-medium">Dat.l.Kontakt</span> (datum zadnjeg kontakta) iz VIS liste.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Agent</th>
                    <th className="px-2 py-2 font-medium">Ukupno firmi</th>
                    <th className="px-2 py-2 font-medium">Nekontaktirano ovaj mjesec ({dayOfMonth}. dan)</th>
                    <th className="px-2 py-2 font-medium">Nekontaktirano (2+ mj.)</th>
                    <th className="px-2 py-2 font-medium">Nekontaktirano (3+ mj.)</th>
                    <th className="px-2 py-2 font-medium">Udio (3+ mj.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {coverage.map((row) => {
                    const rowPct = row.total > 0 ? row.notContactedLast3Months / row.total : 0;
                    return (
                      <tr key={row.label} className={row.label === "Nedodijeljeno" ? "opacity-60" : undefined}>
                        <td className="px-2 py-2 font-medium">
                          {row.agentId ? (
                            <Link href={`/bericht/${row.agentId}`} className="hover:underline">
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
                              rowPct >= 0.4 ? "font-medium text-warning-foreground" : "text-muted-foreground",
                            )}
                          >
                            {Math.round(rowPct * 100)}%
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Aktivnost u alatu
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Koliko stvarnog feedbacka agenti unose u alat i koliko je zakazanih poziva (Wiedervorlage) otvoreno.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Feedback ove sedmice"
              value={num(feedbackWeek ?? 0)}
              sub={
                feedbackWowDelta !== null
                  ? `${feedbackWowDelta >= 0 ? "+" : ""}${pct.format(feedbackWowDelta)} u odnosu na prošlu sedmicu (isti period)`
                  : undefined
              }
              accent="success"
            />
            <StatTile label="Otvorene Wiedervorlage" value={num(wiedervorlageOpen ?? 0)} accent="secondary" />
            <StatTile
              label="Od toga kasne"
              value={num(wiedervorlageOverdue ?? 0)}
              accent={(wiedervorlageOverdue ?? 0) > 0 ? "warning" : "success"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Korištenje AI asistenta
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Pitanja ukupno"
              value={num(stats.chat_messages_total)}
              sub={`Ove sedmice: ${num(stats.chat_messages_week)} · Danas: ${num(stats.chat_messages_today)}`}
              accent="primary"
            />
            <StatTile label="Aktivni korisnici (ikad koristili)" value={num(stats.chat_active_agents)} accent="secondary" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
