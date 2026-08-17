import { notFound } from "next/navigation";
import { Activity, History, Wifi } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DialerStatusTable } from "@/components/dialer-status-table";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  buildDialerAgentSummaries,
  fetchDialerAgentStatuses,
  refreshSalesInSummaries,
  type DialerAgentSummary,
} from "@/lib/dialer/status";

const ONLINE_THRESHOLD_MS = 90_000;

// Moved here from the Dashboard's Rangliste (2026-08-14) - Anis: "merge
// dialer status under status in dialer and delete on dashboard, show one
// under the other so everything has a place" - both "is this agent doing
// something right now" signals (our own in-app heartbeat, and the real
// ViciDial dialer) now live on one page instead of split across two.
const PATH_LABELS: Record<"de" | "bs", Record<string, string>> = {
  de: {
    "/": "Dashboard",
    "/firmen/": "Firmenprofil",
    "/firmen": "Firmen",
    "/katalog/": "Produktseite",
    "/katalog": "Katalog",
    "/fokus": "Fokus",
    "/feedback": "Feedback",
    "/email-liste": "Email-Liste",
    "/wissen": "Wissen",
    "/skript": "Skript",
    "/assistent": "Assistent",
    "/meine-ergebnisse": "Meine Ergebnisse",
    "/konto": "Mein Konto",
    "/bericht": "Bericht",
    "/dialer": "Dialer",
    "/admin": "Admin",
  },
  bs: {
    "/": "Dashboard",
    "/firmen/": "Profil firme",
    "/firmen": "Firme",
    "/katalog/": "Stranica proizvoda",
    "/katalog": "Katalog",
    "/fokus": "Fokus",
    "/feedback": "Feedback",
    "/email-liste": "Email lista",
    "/wissen": "Znanje",
    "/skript": "Skripta",
    "/assistent": "Asistent",
    "/meine-ergebnisse": "Moji rezultati",
    "/konto": "Moj račun",
    "/bericht": "Izvještaj",
    "/dialer": "Dialer",
    "/admin": "Admin",
  },
};

function pathLabel(path: string | null, locale: "de" | "bs"): string {
  if (!path) return "";
  const labels = PATH_LABELS[locale];
  for (const [prefix, label] of Object.entries(labels)) {
    if (prefix === "/" ? path === "/" : path.startsWith(prefix)) return label;
  }
  return path;
}

type LoginStatus = "none" | "created" | "idle" | "online";

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

const dateLabelFormat: Record<"de" | "bs", Intl.DateTimeFormat> = {
  de: new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }),
  bs: new Intl.DateTimeFormat("bs", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }),
};

// Anis, 2026-08-17: "Dialer informacije na Report takodjer prevedi na
// bosanski" - report@'s view of this shared page renders in Bosnian; admin's
// own daily-use view stays German (§1's "UI German labels" convention still
// applies to admin/agents, this is a report@-only exception like /bericht).
const T = {
  de: {
    title: "Dialer",
    statusTitle: "Status im Tool",
    statusDesc:
      "Eigener In-App-Status (Login + Heartbeat, alle 30s) - getrennt vom echten Dialer-Status unten, zeigt nur ob und wo ein Agent gerade in diesem Tool aktiv ist.",
    noAccounts: "Keine Agenten-Konten vorhanden.",
    online: "Online",
    idle: "Angemeldet, gerade nicht aktiv",
    created: "Konto erstellt, noch nie angemeldet",
    none: "Noch kein Konto",
    liveTitle: "Live-Status (Dialer)",
    liveBadge: "Live · aktualisiert alle 4s",
    liveDesc:
      "Direkt aus dem bestehenden Dialer gelesen (schreibgeschützt - startet, steuert oder beendet keine Anrufe). Sales, Konversion und Verkäufe/Std. kommen nicht vom Dialer selbst, sondern aus den echten, heute erfassten Verkäufen dieses Tools (gleiche Quelle wie Rangliste/Team Dashboard). Alle anderen Kennzahlen (Auslastung, Ø Bearbeitungszeit, Anrufe/Std., Zeitanteile) sind aus den rohen Dialer-Zeiten selbst berechnet, nicht vom Dialer vorgegeben.",
    unreachable: "Dialer nicht erreichbar",
    historyTitle: "Verlauf (Tages-Snapshots)",
    historyDesc:
      "Ein Snapshot der obigen Live-Status-Daten, automatisch jeden Tag um 18:00 Uhr gespeichert - der Dialer selbst hat keine eigene Historie, also läuft dieser Snapshot als Übergangslösung mit, bis eine echte Anruflog-API vom Dialer-Entwickler bereitsteht.",
    noSnapshots: "Noch kein Snapshot vorhanden - der erste wird beim nächsten 18:00-Uhr-Lauf gespeichert.",
    date: "Datum",
    show: "Anzeigen",
    savedAt: "Gespeichert um",
    clock: "Uhr",
  },
  bs: {
    title: "Dialer",
    statusTitle: "Status u alatu",
    statusDesc:
      "Vlastiti status u alatu (prijava + heartbeat, svakih 30s) - odvojeno od stvarnog Dialer-statusa ispod, pokazuje samo da li i gdje je agent trenutno aktivan u ovom alatu.",
    noAccounts: "Nema agentskih naloga.",
    online: "Online",
    idle: "Prijavljen, trenutno neaktivan",
    created: "Nalog kreiran, još se nije prijavio",
    none: "Još nema nalog",
    liveTitle: "Uživo status (Dialer)",
    liveBadge: "Uživo · ažurira se svakih 4s",
    liveDesc:
      "Direktno pročitano iz postojećeg Dialera (samo za čitanje - ne pokreće, ne kontroliše i ne završava pozive). Prodaje, Konverzija i Prodaje/h ne dolaze direktno iz Dialera, već iz stvarnih, danas unesenih prodaja ovog alata (isti izvor kao Rang lista/Team Dashboard). Sve ostale metrike (Zauzetost, Ø vrijeme obrade, Pozivi/h, vremenski udjeli) su izračunate iz sirovih Dialer-vremena, nisu date direktno od Dialera.",
    unreachable: "Dialer nije dostupan",
    historyTitle: "Historija (dnevni snimci)",
    historyDesc:
      "Snimak gornjih uživo podataka, automatski sačuvan svaki dan u 18:00 - Dialer sam po sebi nema vlastitu historiju, pa ovaj snimak služi kao privremeno rješenje dok stvarni API za log poziva od strane developera Dialera ne bude spreman.",
    noSnapshots: "Još nema snimka - prvi će biti sačuvan pri sljedećem pokretanju u 18:00.",
    date: "Datum",
    show: "Prikaži",
    savedAt: "Sačuvano u",
    clock: "",
  },
} as const;

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const { datum: datumParam } = await searchParams;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  // Anis, 2026-08-17: "stavi pored izvjestaja i /dialer i bukvalno sve sto
  // se vidi u admin /dialer stavi u report" - report@ sees literally the
  // same content as admin here (this page has no write actions - pure
  // read-only display + a GET date-select form - so there's nothing to
  // additionally lock down for a read-only role beyond what admin-only
  // already gated for HR-adjacency reasons, and Anis explicitly asked for
  // full parity here rather than a trimmed-down version).
  const canView = profile?.role === "admin" || profile?.role === "report";
  const isReport = profile?.role === "report";
  const locale: "de" | "bs" = isReport ? "bs" : "de";
  const t = T[locale];
  const agentHref = (id: string) => (isReport ? `/bericht/${id}` : `/admin/team/${id}`);

  let liveRows: DialerAgentSummary[] | null = null;
  let dialerError: string | null = null;
  let snapshotDates: string[] = [];
  let selectedSnapshotRows: DialerAgentSummary[] | null = null;
  let selectedSnapshotCapturedAt: string | null = null;
  let appStatusRows: { agentId: string; name: string; status: LoginStatus; path: string | null }[] = [];

  if (canView) {
    const supabase = await createClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const [
      { data: dialerData, error: fetchError },
      { data: agentRows },
      { data: perfRows },
      { data: snapshotRows },
      { data: loginStatusRows },
    ] = await Promise.all([
      fetchDialerAgentStatuses(),
      supabase.from("agents").select("id, full_name").eq("active", true),
      supabase.from("agent_daily_performance").select("agent_id, sales_count").eq("date", todayStr),
      // Verlauf (2026-08-08): "posto nemamo logove" stopgap (§14 item 24) had
      // no viewer built yet - just capture. Anis: "How to get that?" -> "sure,
      // viewer page now", "do it in dialer menu" (same page, not a new nav item).
      supabase.from("dialer_daily_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }),
      // "Status im Tool" - our own in-app heartbeat, same RPC/threshold the
      // Dashboard's Rangliste used to compute this with before it moved here.
      supabase.rpc("fn_get_agent_login_status"),
    ]);
    dialerError = fetchError;
    const agents = agentRows ?? [];
    const salesByAgentId = new Map((perfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
    liveRows = dialerData ? buildDialerAgentSummaries(dialerData, agents, salesByAgentId) : null;
    snapshotDates = (snapshotRows ?? []).map((r) => r.snapshot_date);

    const now = new Date();
    const nameByAgentId = new Map(agents.map((a) => [a.id, a.full_name]));
    appStatusRows = (loginStatusRows ?? [])
      .map((row) => {
        const isOnline = row.last_seen_at ? now.getTime() - new Date(row.last_seen_at).getTime() < ONLINE_THRESHOLD_MS : false;
        const status: LoginStatus = !row.has_account ? "none" : isOnline ? "online" : row.last_sign_in_at ? "idle" : "created";
        return {
          agentId: row.agent_id,
          name: nameByAgentId.get(row.agent_id) ?? "-",
          status,
          path: isOnline ? row.last_seen_path : null,
        };
      })
      .sort((a, b) => {
        const order: Record<LoginStatus, number> = { online: 0, idle: 1, created: 2, none: 3 };
        return order[a.status] - order[b.status] || a.name.localeCompare(b.name);
      });

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
      {canView ? <AutoRefresh intervalMs={4_000} /> : null}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>

      {canView ? (
        <Card>
          <CardHeader>
            <IconTitle icon={Wifi}>{t.statusTitle}</IconTitle>
            <p className="text-sm text-muted-foreground">{t.statusDesc}</p>
          </CardHeader>
          <CardContent>
            {appStatusRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noAccounts}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {appStatusRows.map((row) => {
                  const statusLabel =
                    row.status === "online"
                      ? `${t.online}${row.path ? ` - ${pathLabel(row.path, locale)}` : ""}`
                      : row.status === "idle"
                        ? t.idle
                        : row.status === "created"
                          ? t.created
                          : t.none;
                  return (
                    <li key={row.agentId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="font-medium">{row.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          row.status === "online"
                            ? "bg-success/20 text-success-foreground"
                            : row.status === "idle"
                              ? "bg-primary/15 text-primary"
                              : row.status === "created"
                                ? "bg-warning/20 text-warning-foreground"
                                : "bg-muted text-muted-foreground",
                        )}
                      >
                        {statusLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canView ? (
        <div className="mx-[calc(50%-50vw)] w-screen px-4 md:px-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <IconTitle icon={Activity}>{t.liveTitle}</IconTitle>
              <Badge variant="success">{t.liveBadge}</Badge>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">{t.liveDesc}</p>
              {dialerError ? (
                <p className="text-sm text-destructive">
                  {t.unreachable}: {dialerError}
                </p>
              ) : (
                <DialerStatusTable rows={liveRows ?? []} sortByStatus locale={locale} agentHref={agentHref} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {canView ? (
        <div className="mx-[calc(50%-50vw)] w-screen px-4 md:px-8">
          <Card>
            <CardHeader>
              <IconTitle icon={History}>{t.historyTitle}</IconTitle>
              <p className="text-sm text-muted-foreground">{t.historyDesc}</p>
            </CardHeader>
            <CardContent>
              {snapshotDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noSnapshots}</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <form action="/dialer" className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="datum">{t.date}</Label>
                      <select
                        id="datum"
                        name="datum"
                        defaultValue={datumParam ?? snapshotDates[0]}
                        className={selectClassName}
                      >
                        {snapshotDates.map((d) => (
                          <option key={d} value={d}>
                            {dateLabelFormat[locale].format(new Date(`${d}T00:00:00`))}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" size="sm">
                      {t.show}
                    </Button>
                    {selectedSnapshotCapturedAt ? (
                      <span className="pb-1.5 text-xs text-muted-foreground">
                        {t.savedAt}{" "}
                        {new Date(selectedSnapshotCapturedAt).toLocaleTimeString(locale === "bs" ? "bs" : "de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                          // real bug, 2026-08-11: this runs server-side (RSC), and
                          // Vercel's Node runtime is UTC - without an explicit
                          // timeZone this rendered the raw UTC hour (e.g. "16:03"
                          // for an 18:03 CEST capture) instead of real local time.
                          timeZone: "Europe/Sarajevo",
                        })}{" "}
                        {t.clock}
                      </span>
                    ) : null}
                  </form>
                  <DialerStatusTable rows={selectedSnapshotRows ?? []} locale={locale} agentHref={agentHref} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
