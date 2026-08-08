import { notFound } from "next/navigation";
import { Activity, History, PhoneCall, Sparkles } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DialerStatusTable } from "@/components/dialer-status-table";
import { SoftphoneDialpad } from "@/components/softphone-dialpad";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildDialerAgentSummaries, fetchDialerAgentStatuses, type DialerAgentSummary } from "@/lib/dialer/status";

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
      const { data: snapshot } = await supabase
        .from("dialer_daily_snapshots")
        .select("agents, captured_at")
        .eq("snapshot_date", selectedDate)
        .single();
      selectedSnapshotRows = (snapshot?.agents as DialerAgentSummary[] | undefined) ?? null;
      selectedSnapshotCapturedAt = snapshot?.captured_at ?? null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? <AutoRefresh intervalMs={4_000} /> : null}
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Dialer
          <Badge variant="warning">Bald</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Konzept-Vorschau: Anrufe direkt aus diesem Fenster starten, ohne zwischen Tools zu wechseln. Noch
          nicht verbunden - unten ein Eindruck, wie das Softphone aussehen könnte.
        </p>
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

      <Card>
        <CardHeader>
          <IconTitle icon={Sparkles}>Wie das funktionieren soll</IconTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Anbindung an den bestehenden Dialer über dessen API, direkt aus diesem Fenster - Anruf starten
          (z.B. per Klick von der Firmenprofil-Seite mit vorausgefüllter Nummer), Status live sehen, nach dem
          Gespräch direkt Feedback eintragen, ohne das Tool zu wechseln. Ersetzt nicht den bestehenden Dialer
          (der bleibt System of Record fürs eigentliche Telefonieren, CLAUDE.md §1) - reine
          Bedienoberfläche/Anbindung. Live-Status ist seit heute angebunden (oben, nur Admin) - Anrufe direkt
          auslösen fehlt noch, dafür wird eine separate Dialer-Funktion gebraucht, die bisher nicht bestätigt
          ist.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <IconTitle icon={PhoneCall}>Softphone (Beispiel-Layout)</IconTitle>
          <p className="text-sm text-muted-foreground">
            Ziffernblock funktioniert schon zur Eingabe - der Anruf-Button ist bewusst deaktiviert, es besteht
            noch keine echte Verbindung.
          </p>
        </CardHeader>
        <CardContent>
          <SoftphoneDialpad />
        </CardContent>
      </Card>
    </div>
  );
}
