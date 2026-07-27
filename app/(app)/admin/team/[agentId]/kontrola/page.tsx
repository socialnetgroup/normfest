import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AgentReportButton } from "@/components/agent-report-button";
import { MarkdownLite } from "@/components/markdown-lite";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

// "Sistem kontrolinga" pilot (2026-07-27, Alan Sacic first): controlling/QA
// overview for one agent - real Team Dashboard numbers (last 30 days), real
// QA-Bewertungen history, and a history of AI-generated coaching reports
// (agent_ai_reports). Deliberately does not show a feedback-adoption metric
// - agents don't have profile/login accounts yet (§4.11), so sales_feedback
// has no real per-agent data for this pilot; said explicitly rather than
// silently showing zero. Admin-only, same HR-adjacent reasoning as the other
// per-agent screens.
export default async function AgentKontrolaPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 30);
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const periodEndStr = periodEnd.toISOString().slice(0, 10);

  const [{ data: agent }, { data: perfRows }, { data: evalRows }, { data: reports }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet, active").eq("id", agentId).single(),
    supabase
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, day_off")
      .eq("agent_id", agentId)
      .gte("date", periodStartStr)
      .lte("date", periodEndStr)
      .order("date"),
    supabase
      .from("agent_evaluations")
      .select("id, call_date, total_score, f1_score, f2_score, f3_score, f4_score, f5_score, comment")
      .eq("agent_id", agentId)
      .order("call_date", { ascending: false })
      .limit(10),
    supabase
      .from("agent_ai_reports")
      .select("id, period_start, period_end, summary, created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false }),
  ]);

  if (!agent) notFound();

  const worked = (perfRows ?? []).filter((r) => !r.day_off);
  const totalRevenue = worked.reduce((sum, r) => sum + r.revenue, 0);
  const totalSales = worked.reduce((sum, r) => sum + r.sales_count, 0);
  const totalCalls = worked.reduce((sum, r) => sum + (r.calls_count ?? 0), 0);
  const conversionRate = totalCalls > 0 ? totalSales / totalCalls : null;
  const evalAvg =
    evalRows && evalRows.length > 0 ? evalRows.reduce((sum, e) => sum + e.total_score, 0) / evalRows.length : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/team/${agentId}`} className="text-sm text-muted-foreground hover:underline">
          ← {agent.full_name}
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">Kontrolling - {agent.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gebiet {agent.gebiet} · Zeitraum {dateFmt.format(periodStart)} - {dateFmt.format(periodEnd)} (letzte 30
          Tage)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Umsatz (30 Tage)" value={eur.format(totalRevenue)} accent="primary" />
        <StatTile label="Verkäufe" value={String(totalSales)} accent="secondary" />
        <StatTile
          label="Conversion Rate"
          value={conversionRate !== null ? pct.format(conversionRate) : "-"}
          accent="secondary"
        />
        <StatTile
          label="QA-Ø (letzte 10)"
          value={evalAvg !== null ? `${evalAvg.toFixed(1)}/10` : "-"}
          accent={evalAvg !== null && evalAvg >= 7 ? "success" : "warning"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-primary" />
            QA-Bewertungen (letzte {evalRows?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!evalRows || evalRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine QA-Bewertung erfasst.{" "}
              <Link href="/admin/qa-bewertungen/neu" className="underline">
                Jetzt bewerten
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {evalRows.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{dateFmt.format(new Date(e.call_date))}</span>
                  <span className="text-muted-foreground">
                    F1 {e.f1_score} · F2 {e.f2_score} · F3 {e.f3_score} · F4 {e.f4_score} · F5 {e.f5_score}
                  </span>
                  <Badge variant={e.total_score >= 7 ? "success" : e.total_score >= 4 ? "secondary" : "warning"}>
                    {e.total_score}/10
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>KI-Kontrollingberichte</CardTitle>
          <p className="text-sm text-muted-foreground">
            Kurzer, ausschließlich auf echten Zahlen basierender Bericht (Team-Dashboard-Umsatz + QA-Bewertungen) -
            keine Feedback-Daten enthalten, da {agent.full_name} noch kein Login-Konto im Tool hat.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AgentReportButton agentId={agentId} />
          {!reports || reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch kein Bericht generiert.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {reports.map((r) => (
                <li key={r.id} className="rounded-lg border-l-4 border-l-primary/30 bg-muted/20 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {dateFmt.format(new Date(r.period_start))} - {dateFmt.format(new Date(r.period_end))}
                    </span>
                    <Badge variant="secondary">KI-generiert</Badge>
                  </div>
                  <MarkdownLite content={r.summary} className="flex flex-col gap-1.5 text-sm" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
