import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthCalendar, type DayEntry } from "@/components/team/month-calendar";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(m) - 1, 1),
  );
}

// Same structure as /admin/team/[agentId] (month cards + calendar drill-in),
// just scoped to the logged-in agent's own data instead of admin-only access
// to any agent — Anis, 2026-07-31: agents should see their own historical
// results the same way admin sees the team's. Bonus is deliberately not
// shown here (Anis, 2026-07-31: "Bonus regelung bei agenten momentan
// abschalten") -- no bonus computation is done on this page at all, so
// there's nothing left over to accidentally leak.
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

  const [{ data: rows, error }, { data: feedbackRows }] = await Promise.all([
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, day_off")
      .eq("agent_id", myAgent.id)
      .order("date"),
    // Wiedervorlage per day (2026-08-18) - agents can read their own
    // sales_feedback (shared-visibility RLS, §14 item 19), unlike
    // dialer_daily_snapshots (admin/report-only), so Sprechzeit stays null
    // here while Wiedervorlage is real.
    user
      ? supabase.from("sales_feedback").select("created_at, wiedervorlage_date").eq("agent_id", user.id)
      : Promise.resolve({ data: [] as { created_at: string; wiedervorlage_date: string | null }[] }),
  ]);

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
      </p>
    );
  }

  const wiedervorlageByDate = new Map<string, number>();
  for (const row of feedbackRows ?? []) {
    if (!row.wiedervorlage_date) continue;
    const date = row.created_at.slice(0, 10);
    wiedervorlageByDate.set(date, (wiedervorlageByDate.get(date) ?? 0) + 1);
  }

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
      bonusKm: 0,
      talkSeconds: null,
      wiedervorlageCount: wiedervorlageByDate.get(r.date) ?? 0,
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
                </div>
                <MonthCalendar month={month} days={days} showBonus={false} />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
