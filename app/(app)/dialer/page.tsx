import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, PhoneCall, Sparkles } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SoftphoneDialpad } from "@/components/softphone-dialpad";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchDialerAgentStatuses, matchDialerAgent, type DialerAgentStatus } from "@/lib/dialer/status";
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
};

export default async function DialerPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  const isAdmin = profile?.role === "admin";

  let dialerRows: DialerAgentStatus[] | null = null;
  let dialerError: string | null = null;
  let agents: { id: string; full_name: string }[] = [];

  if (isAdmin) {
    const supabase = await createClient();
    const [{ data: dialerData, error: fetchError }, { data: agentRows }] = await Promise.all([
      fetchDialerAgentStatuses(),
      supabase.from("agents").select("id, full_name").eq("active", true),
    ]);
    dialerRows = dialerData;
    dialerError = fetchError;
    agents = agentRows ?? [];
  }

  const sortedRows = dialerRows
    ? [...dialerRows].sort((a, b) => {
        const pa = STATUS_ORDER[a.status.toUpperCase()] ?? 99;
        const pb = STATUS_ORDER[b.status.toUpperCase()] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.fullName.localeCompare(b.fullName);
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? <AutoRefresh intervalMs={15_000} /> : null}
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <IconTitle icon={Activity}>Live-Status (Dialer)</IconTitle>
            <Badge variant="success">Live · aktualisiert alle 15s</Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Direkt aus dem bestehenden Dialer gelesen (schreibgeschützt - startet, steuert oder beendet
              keine Anrufe). Nur für Admin sichtbar, gleiche Einstufung wie das Team Dashboard.
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
                      <th className="px-2 py-2 font-medium">Agent</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Zeit im Status</th>
                      <th className="px-2 py-2 font-medium">Anrufe</th>
                      <th className="px-2 py-2 font-medium">Sales</th>
                      <th className="px-2 py-2 font-medium">Konversion</th>
                      <th className="px-2 py-2 font-medium">Sprechzeit</th>
                      <th className="px-2 py-2 font-medium">Pausenzeit</th>
                      <th className="px-2 py-2 font-medium">Wartezeit</th>
                      <th className="px-2 py-2 font-medium">Nachbearbeitung</th>
                      <th className="px-2 py-2 font-medium">Totzeit</th>
                      <th className="px-2 py-2 font-medium">Aktiv</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedRows.map((row) => {
                      const matched = matchDialerAgent(row.fullName, agents);
                      return (
                        <tr key={row.extension}>
                          <td className="px-2 py-2 font-medium">
                            {matched ? (
                              <Link href={`/admin/team/${matched.id}`} className="hover:underline">
                                {matched.full_name}
                              </Link>
                            ) : (
                              row.fullName
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Badge variant={statusVariant(row.status)}>
                              {STATUS_LABELS[row.status.toUpperCase()] ?? row.status}
                            </Badge>
                          </td>
                          <td className="px-2 py-2 tabular-nums">{row.timeInStatus}</td>
                          <td className="px-2 py-2 tabular-nums">{row.totalCalls}</td>
                          <td className="px-2 py-2 tabular-nums">{row.sales}</td>
                          <td className="px-2 py-2 tabular-nums">{row.conversionRate}</td>
                          <td className="px-2 py-2 tabular-nums">{row.talkTime}</td>
                          <td className="px-2 py-2 tabular-nums">{row.pauseTime}</td>
                          <td className="px-2 py-2 tabular-nums">{row.waitTime}</td>
                          <td className="px-2 py-2 tabular-nums">{row.dispoTime}</td>
                          <td className="px-2 py-2 tabular-nums">{row.deadTime}</td>
                          <td
                            className={cn(
                              "px-2 py-2 tabular-nums",
                              row.status.toUpperCase() === "PAUSED"
                                ? "text-muted-foreground"
                                : "text-success-foreground",
                            )}
                          >
                            {row.activeTime}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
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
