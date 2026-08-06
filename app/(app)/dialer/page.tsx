import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, PhoneCall, Sparkles } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SoftphoneDialpad } from "@/components/softphone-dialpad";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildDialerAgentSummaries,
  fetchDialerAgentStatuses,
  formatSecondsAsHms,
  type DialerAgentStatus,
} from "@/lib/dialer/status";
import { cn } from "@/lib/utils";

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

const STATUS_ORDER: Record<string, number> = { INCALL: 0, DISPO: 1, PAUSED: 2 };

function statusVariant(status: string): "success" | "default" | "warning" | "muted" {
  const s = status.toUpperCase();
  if (s === "INCALL") return "success";
  if (s === "DISPO") return "default";
  if (s === "PAUSED") return "warning";
  return "muted";
}

const STATUS_LABELS: Record<string, string> = {
  INCALL: "Im Gespräch",
  DISPO: "Nachbearbeitung",
  PAUSED: "Pause",
  OFFLINE: "Abgemeldet",
};

const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rate = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Group headers for the widened Live-Status table, in a deliberate order
// (Anis, 2026-08-06: "napravi logičan, povezan redoslijed"): who/what state
// -> how much volume -> what came out of it (business result, using our own
// real numbers) -> how efficiently -> the raw time buckets those efficiency
// ratios are built from -> the dialer's own separate computer-activity split.
const COLUMN_GROUPS = [
  { label: "Agent", span: 3 },
  { label: "Volumen", span: 2 },
  { label: "Ergebnis", span: 3 },
  { label: "Effizienz", span: 2 },
  { label: "Zeitverteilung", span: 5 },
  { label: "Aktivität", span: 3 },
];

export default async function DialerPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  const isAdmin = profile?.role === "admin";

  let dialerRows: DialerAgentStatus[] | null = null;
  let dialerError: string | null = null;
  let agents: { id: string; full_name: string }[] = [];
  let salesByAgentId = new Map<string, number>();

  if (isAdmin) {
    const supabase = await createClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const [{ data: dialerData, error: fetchError }, { data: agentRows }, { data: perfRows }] = await Promise.all([
      fetchDialerAgentStatuses(),
      supabase.from("agents").select("id, full_name").eq("active", true),
      supabase.from("agent_daily_performance").select("agent_id, sales_count").eq("date", todayStr),
    ]);
    dialerRows = dialerData;
    dialerError = fetchError;
    agents = agentRows ?? [];
    // "Sales" in the dialer's own API is the dialer's own internal counter,
    // disconnected from what this app actually tracks (Anis, 2026-08-06:
    // wants it pulled from the same real source as the Rangliste/Team
    // Dashboard - today's agent_daily_performance.sales_count - not the
    // dialer's own number). Falls back to the dialer's raw count only if a
    // row's name doesn't match a real agent.
    salesByAgentId = new Map((perfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
  }

  // Other teams share this same ViciDial instance for unrelated mini-projects
  // (Anis, 2026-08-06: "Normfest dialer pokazuje Jelenu Stancevic... prikazuj
  // samo ljude iz Normfesta") - only show rows that match a real Normfest
  // agent; an unrecognized name is someone else's project, not ours to show.
  // buildDialerAgentSummaries() also computes the standard call-center KPIs
  // below, shared with the daily snapshot cron job so the two can't drift.
  const summaries = dialerRows ? buildDialerAgentSummaries(dialerRows, agents, salesByAgentId) : null;

  const sortedRows = summaries
    ? [...summaries].sort((a, b) => {
        const pa = STATUS_ORDER[a.status.toUpperCase()] ?? 99;
        const pb = STATUS_ORDER[b.status.toUpperCase()] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.fullName.localeCompare(b.fullName);
      })
    : null;

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
        // Breaks out of the page's normal max-w-6xl container - Anis, 2026-08-06:
        // "ima na ekranu 'mjesta' slobodno proširi sam dialer live status u
        // širinu" - this table alone gets real screen width, the rest of the
        // page (concept cards, softphone) stays at the normal reading width.
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
              ) : !sortedRows || sortedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Agenten aktuell im Dialer.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        {COLUMN_GROUPS.map((g, i) => (
                          <th
                            key={g.label}
                            colSpan={g.span}
                            className={cn(
                              "px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase",
                              i > 0 && "border-l",
                            )}
                          >
                            {g.label}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        <th className="px-2 py-2 font-medium">Agent</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Zeit im Status</th>
                        <th className="border-l px-2 py-2 font-medium">Anrufe</th>
                        <th className="px-2 py-2 font-medium">Anrufe/Std.</th>
                        <th className="border-l px-2 py-2 font-medium">Sales</th>
                        <th className="px-2 py-2 font-medium">Konversion</th>
                        <th className="px-2 py-2 font-medium">Verkäufe/Std.</th>
                        <th className="border-l px-2 py-2 font-medium">Ø Bearbeitungszeit</th>
                        <th className="px-2 py-2 font-medium">Auslastung</th>
                        <th className="border-l px-2 py-2 font-medium">Sprechzeit</th>
                        <th className="px-2 py-2 font-medium">Wartezeit</th>
                        <th className="px-2 py-2 font-medium">Nachbearbeitung</th>
                        <th className="px-2 py-2 font-medium">Pausenzeit</th>
                        <th className="px-2 py-2 font-medium">Totzeit</th>
                        <th className="border-l px-2 py-2 font-medium">Gesamtzeit</th>
                        <th className="px-2 py-2 font-medium">Aktiv</th>
                        <th className="px-2 py-2 font-medium">Inaktiv</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sortedRows.map((a) => (
                        <tr key={a.agentId}>
                          <td className="px-2 py-2 font-medium">
                            <Link href={`/admin/team/${a.agentId}`} className="hover:underline">
                              {a.fullName}
                            </Link>
                          </td>
                          <td className="px-2 py-2">
                            <Badge variant={statusVariant(a.status)}>
                              {STATUS_LABELS[a.status.toUpperCase()] ?? a.status}
                            </Badge>
                          </td>
                          <td className="px-2 py-2 tabular-nums">{a.timeInStatus}</td>
                          <td className="border-l px-2 py-2 tabular-nums">{a.totalCalls}</td>
                          <td className="px-2 py-2 tabular-nums">{rate.format(a.callsPerHour)}</td>
                          <td className="border-l px-2 py-2 tabular-nums">{a.realSales}</td>
                          <td className="px-2 py-2 tabular-nums">{pct.format(a.conversion)}</td>
                          <td className="px-2 py-2 tabular-nums">{rate.format(a.salesPerHour)}</td>
                          <td className="border-l px-2 py-2 tabular-nums">{formatSecondsAsHms(a.ahtSeconds)}</td>
                          <td className="px-2 py-2 tabular-nums">{pct.format(a.occupancy)}</td>
                          <td className="border-l px-2 py-2 tabular-nums">{a.talkTime}</td>
                          <td className="px-2 py-2 tabular-nums">{a.waitTime}</td>
                          <td className="px-2 py-2 tabular-nums">{a.dispoTime}</td>
                          <td className="px-2 py-2 tabular-nums">
                            {a.pauseTime} <span className="text-muted-foreground">({pct.format(a.pauseShare)})</span>
                          </td>
                          <td className="px-2 py-2 tabular-nums">
                            {a.deadTime} <span className="text-muted-foreground">({pct.format(a.deadShare)})</span>
                          </td>
                          <td className="border-l px-2 py-2 tabular-nums">{a.totalTime}</td>
                          <td
                            className={cn(
                              "px-2 py-2 tabular-nums",
                              a.status.toUpperCase() === "PAUSED" ? "text-muted-foreground" : "text-success-foreground",
                            )}
                          >
                            {a.activeTime}
                          </td>
                          <td className="px-2 py-2 tabular-nums text-muted-foreground">{a.inactiveTime}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
