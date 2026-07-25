import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ClipboardList, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvaluationDeleteButton } from "@/components/evaluation-delete-button";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(date: string) {
  return dateFmt.format(new Date(`${date}T00:00:00Z`));
}

export default async function QaBewertungenPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const [{ data: agents }, { data: evaluations }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet").eq("active", true).order("full_name"),
    supabase
      .from("agent_evaluations")
      .select("id, agent_id, call_date, total_score, comment, created_at, agents(full_name)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const latestByAgent = new Map<string, { call_date: string; total_score: number; created_at: string }>();
  for (const evaluation of evaluations ?? []) {
    if (!latestByAgent.has(evaluation.agent_id)) {
      latestByAgent.set(evaluation.agent_id, evaluation);
    }
  }
  const evaluatedThisMonth = new Set(
    (evaluations ?? [])
      .filter((e) => e.created_at.slice(0, 7) === currentMonthKey)
      .map((e) => e.agent_id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">QA-Bewertungen</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monatliche Pflichtbewertung pro Mitarbeiter - ein bewerteter Anruf je Bewertung.
          </p>
        </div>
        <Link href="/admin/qa-bewertungen/neu">
          <Button className="gap-2">
            <Plus className="size-4" />
            Neue Bewertung
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" />
            Diesen Monat
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y rounded-lg border">
            {(agents ?? []).map((agent) => {
              const latest = latestByAgent.get(agent.id);
              const done = evaluatedThisMonth.has(agent.id);
              return (
                <li key={agent.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{agent.full_name}</span>{" "}
                    <span className="text-muted-foreground">({agent.gebiet})</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {latest ? (
                      <span className="text-xs text-muted-foreground">
                        letzte: {formatDate(latest.call_date)} · {latest.total_score}/10
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">noch keine Bewertung</span>
                    )}
                    <Badge variant={done ? "success" : "warning"}>{done ? "Erledigt" : "Fehlt"}</Badge>
                  </div>
                </li>
              );
            })}
            {(!agents || agents.length === 0) && (
              <li className="px-3 py-4 text-sm text-muted-foreground">Keine aktiven Mitarbeiter gefunden.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-primary" />
            Alle Bewertungen
          </CardTitle>
        </CardHeader>
        <CardContent>
          {evaluations && evaluations.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-lg border">
              {evaluations.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-1">
                  <Link
                    href={`/admin/qa-bewertungen/${e.id}`}
                    className="flex flex-1 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{e.agents?.full_name ?? "Unbekannt"}</span>{" "}
                      <span className="text-muted-foreground">· {formatDate(e.call_date)}</span>
                    </div>
                    <Badge variant={e.total_score >= 8 ? "success" : e.total_score >= 5 ? "secondary" : "warning"}>
                      {e.total_score} / 10
                    </Badge>
                  </Link>
                  <EvaluationDeleteButton id={e.id} agentName={e.agents?.full_name ?? "Unbekannt"} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Noch keine Bewertungen erfasst.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
