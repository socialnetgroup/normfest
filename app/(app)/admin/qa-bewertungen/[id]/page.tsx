import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { AudioPlayButton } from "@/components/audio-play-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EvaluationDeleteButton } from "@/components/evaluation-delete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { CALL_QUALITY_PHASES } from "@/lib/qa-evaluation";
import { createClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(date: string) {
  return dateFmt.format(new Date(`${date}T00:00:00Z`));
}

export default async function BewertungDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: evaluation } = await supabase
    .from("agent_evaluations")
    .select("*, agents(full_name, gebiet)")
    .eq("id", id)
    .single();

  if (!evaluation) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/admin/qa-bewertungen" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Zurück zu QA-Bewertungen
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {evaluation.agents?.full_name ?? "Unbekannt"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <span>
              Anruf vom {formatDate(evaluation.call_date)}
              {evaluation.call_duration_minutes ? ` · ${evaluation.call_duration_minutes} Min.` : ""}
              {evaluation.call_reference ? ` · ${evaluation.call_reference}` : ""}
            </span>
            {evaluation.call_recording_url ? (
              <span className="flex items-center gap-1">
                <AudioPlayButton url={evaluation.call_recording_url} size="icon-xs" label="Aufnahme" />
                Aufnahme
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant={evaluation.total_score >= 8 ? "success" : evaluation.total_score >= 5 ? "secondary" : "warning"}
            className="text-base"
          >
            {evaluation.total_score} / 10
          </Badge>
          <Link
            href={`/admin/qa-bewertungen/${evaluation.id}/bearbeiten`}
            className={buttonVariants({ variant: "outline", size: "icon-xs" })}
            aria-label="Bearbeiten"
          >
            <Pencil className="size-3.5" />
          </Link>
          <EvaluationDeleteButton
            id={evaluation.id}
            agentName={evaluation.agents?.full_name ?? "Unbekannt"}
            redirectTo="/admin/qa-bewertungen"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Call-Qualität Rubrik</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {CALL_QUALITY_PHASES.map((phase) => {
            const score = evaluation[`${phase.key}_score` as keyof typeof evaluation] as number;
            const note = evaluation[`${phase.key}_note` as keyof typeof evaluation] as string | null;
            return (
              <div key={phase.key} className="flex flex-col gap-1 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{phase.label}</span>
                  <Badge variant={score === 2 ? "success" : score === 1 ? "secondary" : "warning"}>
                    {score} / 2
                  </Badge>
                </div>
                {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {evaluation.comment ? (
        <Card>
          <CardHeader>
            <CardTitle>Gesamtkommentar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line">{evaluation.comment}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
