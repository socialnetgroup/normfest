import { AudioPlayButton } from "@/components/audio-play-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvaluationViewTracker } from "@/components/evaluation-view-tracker";
import { getCurrentUser } from "@/lib/auth";
import { CALL_QUALITY_PHASES } from "@/lib/qa-evaluation";
import { createClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(date: string) {
  return dateFmt.format(new Date(`${date}T00:00:00Z`));
}

const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Agent-facing "Bewertungen" tab (2026-08-19), Anis: "genereting a
 * Bewertungen menu tab at each agent, showing the bewertungen they got from
 * the Teamleader with a notification that they have new, unread, unlistened
 * Bewertungen from their TL. Also show which TL did the Bewertung." Read-only
 * mirror of the admin-side QA-Bewertungen detail view, scoped to the
 * logged-in agent's own rows via fn_get_my_evaluations() (§14 item 109's
 * self-visibility RLS + the evaluator-name join a plain agent can't do
 * directly, since profiles RLS only lets a caller read their own row). */
export default async function BewertungenPage() {
  const { user, profile } = await getCurrentUser();
  const supabase = await createClient();

  const { data: myAgent } = user
    ? await supabase.from("agents").select("id").eq("profile_id", user.id).maybeSingle()
    : { data: null };

  if (!myAgent) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bewertungen</h1>
        <p className="text-sm text-muted-foreground">
          {profile?.role === "admin"
            ? "Admin-Konten sind keinem Agenten zugeordnet - siehe stattdessen QA-Bewertungen im Admin-Bereich."
            : "Dein Konto ist noch keinem Agenten zugeordnet."}
        </p>
      </div>
    );
  }

  const { data: evaluations, error } = await supabase.rpc("fn_get_my_evaluations");

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Fehler beim Laden: {error.message}
      </p>
    );
  }

  const rows = evaluations ?? [];
  const unreadIds = rows.filter((r) => !r.viewed_at).map((r) => r.id);

  return (
    <div className="flex flex-col gap-6">
      <EvaluationViewTracker unreadIds={unreadIds} />
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bewertungen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deine Call-Qualität-Bewertungen von deinem Teamleiter.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Bewertung vorhanden.</p>
      ) : (
        rows.map((evaluation) => {
          const isUnread = unreadIds.includes(evaluation.id);
          return (
            <Card key={evaluation.id} className={isUnread ? "border-l-2 border-l-primary" : undefined}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>Anruf vom {formatDate(evaluation.call_date)}</CardTitle>
                      {isUnread ? <Badge variant="warning">Neu</Badge> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      <span>
                        Bewertet von {evaluation.evaluated_by_name} am {dateTimeFmt.format(new Date(evaluation.created_at))} Uhr
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
                  <Badge
                    variant={evaluation.total_score >= 8 ? "success" : evaluation.total_score >= 5 ? "secondary" : "warning"}
                    className="text-base"
                  >
                    {evaluation.total_score} / 10
                  </Badge>
                </div>
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
                {evaluation.comment ? (
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-medium">Gesamtkommentar</p>
                    <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{evaluation.comment}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
