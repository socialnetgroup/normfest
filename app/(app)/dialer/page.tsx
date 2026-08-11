import { notFound } from "next/navigation";
import { Activity, History } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DialerStatusTable } from "@/components/dialer-status-table";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildDialerAgentSummaries,
  fetchDialerAgentStatuses,
  refreshSalesInSummaries,
  type DialerAgentSummary,
} from "@/lib/dialer/status";

function IconTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      {children}
    </CardTitle>
  );
}

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const dateLabelFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const { datum: datumParam } = await searchParams;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  const isAdmin = profile?.role === "admin";

  let liveRows: DialerAgentSummary[] | null = null;
  let dialerError: string | null = null;
  let snapshotDates: string[] = [];
  let selectedSnapshotRows: DialerAgentSummary[] | null = null;
  let selectedSnapshotCapturedAt: string | null = null;

  if (isAdmin) {
    const supabase = await createClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const [{ data: dialerData, error: fetchError }, { data: agentRows }, { data: perfRows }, { data: snapshotRows }] =
      await Promise.all([
        fetchDialerAgentStatuses(),
        supabase.from("agents").select("id, full_name").eq("active", true),
        supabase.from("agent_daily_performance").select("agent_id, sales_count").eq("date", todayStr),
        // Verlauf (2026-08-08): "posto nemamo logove" stopgap (§14 item 24) had
        // no viewer built yet - just capture. Anis: "How to get that?" -> "sure,
        // viewer page now", "do it in dialer menu" (same page, not a new nav item).
        supabase.from("dialer_daily_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }),
      ]);
    dialerError = fetchError;
    const agents = agentRows ?? [];
    const salesByAgentId = new Map((perfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
    liveRows = dialerData ? buildDialerAgentSummaries(dialerData, agents, salesByAgentId) : null;
    snapshotDates = (snapshotRows ?? []).map((r) => r.snapshot_date);

    const selectedDate = datumParam && snapshotDates.includes(datumParam) ? datumParam : (snapshotDates[0] ?? null);
    if (selectedDate) {
      const [{ data: snapshot }, { data: snapshotPerfRows }] = await Promise.all([
        supabase.from("dialer_daily_snapshots").select("agents, captured_at").eq("snapshot_date", selectedDate).single(),
        supabase.from("agent_daily_performance").select("agent_id, sales_count").eq("date", selectedDate),
      ]);
      const frozenRows = (snapshot?.agents as DialerAgentSummary[] | undefined) ?? null;
      // Anis, 2026-08-11: "sales match... everywhere" - realSales/conversion/
      // salesPerHour were frozen at whatever agent_daily_performance said at
      // 18:00 capture, but the Team Dashboard Excel often gets uploaded/
      // corrected at other times of day, so a stored snapshot's sales figures
      // silently go stale relative to the current source of truth. Re-derive
      // them against the CURRENT agent_daily_performance for that date on
      // every view - dialer-sourced fields (calls, occupancy, time
      // breakdowns) stay frozen, since those are a genuine point-in-time
      // capture that can't be "corrected" after the fact.
      const snapshotSalesByAgentId = new Map((snapshotPerfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
      selectedSnapshotRows = frozenRows ? refreshSalesInSummaries(frozenRows, snapshotSalesByAgentId) : null;
      selectedSnapshotCapturedAt = snapshot?.captured_at ?? null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? <AutoRefresh intervalMs={4_000} /> : null}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dialer</h1>
      </div>

      {isAdmin ? (
        <div className="mx-[calc(50%-50vw)] w-screen px-4 md:px-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <IconTitle icon={Activity}>Live-Status (Dialer)</IconTitle>
              <Badge variant="success">Live · aktualisiert alle 4s</Badge>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Direkt aus dem bestehenden Dialer gelesen (schreibgeschützt - startet, steuert oder beendet
                keine Anrufe). Nur für Admin sichtbar, gleiche Einstufung wie das Team Dashboard.{" "}
                <span className="font-medium">Sales</span>, <span className="font-medium">Konversion</span>{" "}
                und <span className="font-medium">Verkäufe/Std.</span> kommen nicht vom Dialer selbst,
                sondern aus den echten, heute erfassten Verkäufen dieses Tools (gleiche Quelle wie
                Rangliste/Team Dashboard). Alle anderen Kennzahlen (Auslastung, Ø Bearbeitungszeit,
                Anrufe/Std., Zeitanteile) sind aus den rohen Dialer-Zeiten selbst berechnet, nicht vom
                Dialer vorgegeben.
              </p>
              {dialerError ? (
                <p className="text-sm text-destructive">Dialer nicht erreichbar: {dialerError}</p>
              ) : (
                <DialerStatusTable rows={liveRows ?? []} sortByStatus />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mx-[calc(50%-50vw)] w-screen px-4 md:px-8">
          <Card>
            <CardHeader>
              <IconTitle icon={History}>Verlauf (Tages-Snapshots)</IconTitle>
              <p className="text-sm text-muted-foreground">
                Ein Snapshot der obigen Live-Status-Daten, automatisch jeden Tag um 18:00 Uhr gespeichert -
                der Dialer selbst hat keine eigene Historie, also läuft dieser Snapshot als
                Übergangslösung mit, bis eine echte Anruflog-API vom Dialer-Entwickler bereitsteht.
              </p>
            </CardHeader>
            <CardContent>
              {snapshotDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Noch kein Snapshot vorhanden - der erste wird beim nächsten 18:00-Uhr-Lauf gespeichert.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <form action="/dialer" className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="datum">Datum</Label>
                      <select
                        id="datum"
                        name="datum"
                        defaultValue={datumParam ?? snapshotDates[0]}
                        className={selectClassName}
                      >
                        {snapshotDates.map((d) => (
                          <option key={d} value={d}>
                            {dateLabelFormat.format(new Date(`${d}T00:00:00`))}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" size="sm">
                      Anzeigen
                    </Button>
                    {selectedSnapshotCapturedAt ? (
                      <span className="pb-1.5 text-xs text-muted-foreground">
                        Gespeichert um{" "}
                        {new Date(selectedSnapshotCapturedAt).toLocaleTimeString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                          // real bug, 2026-08-11: this runs server-side (RSC), and
                          // Vercel's Node runtime is UTC - without an explicit
                          // timeZone this rendered the raw UTC hour (e.g. "16:03"
                          // for an 18:03 CEST capture) instead of real local time.
                          timeZone: "Europe/Sarajevo",
                        })}{" "}
                        Uhr
                      </span>
                    ) : null}
                  </form>
                  <DialerStatusTable rows={selectedSnapshotRows ?? []} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
