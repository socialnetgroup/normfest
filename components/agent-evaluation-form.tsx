"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AudioPlayButton } from "@/components/audio-play-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CALL_QUALITY_PHASES } from "@/lib/qa-evaluation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Agent = { id: string; full_name: string; gebiet: string };
type EvaluationInsert = Database["public"]["Tables"]["agent_evaluations"]["Insert"];
// Only the fields this form actually reads from an existing row (edit mode)
// - the write path below builds its own fully-named EvaluationInsert object,
// so `initial` never needs the full Row type (e.g. evaluated_by, total_score,
// created_at aren't read here).
type EvaluationRow = Pick<
  Database["public"]["Tables"]["agent_evaluations"]["Row"],
  | "id"
  | "agent_id"
  | "call_date"
  | "call_duration_minutes"
  | "call_reference"
  | "call_recording_url"
  | "comment"
  | "f1_score"
  | "f1_note"
  | "f2_score"
  | "f2_note"
  | "f3_score"
  | "f3_note"
  | "f4_score"
  | "f4_note"
  | "f5_score"
  | "f5_note"
>;

/** Create-mode prefill from a real picked CDR call (§14 item 109's call
 * picker on /admin/qa-bewertungen/neu) - distinct from `initial` (edit mode,
 * carries a real row id and switches the submit to an update). Never both
 * at once; `initial` always wins if somehow both are passed. */
export type EvaluationPrefill = {
  call_date: string;
  call_duration_minutes: number | null;
  call_reference: string | null;
  call_recording_url: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function AgentEvaluationForm({
  agents,
  evaluatedBy,
  initial,
  prefill,
  initialAgentId,
}: {
  agents: Agent[];
  evaluatedBy: string;
  initial?: EvaluationRow;
  /** Real picked-call prefill for create mode - see EvaluationPrefill's own
   * note. Ignored if `initial` is set. */
  prefill?: EvaluationPrefill;
  /** Which agent to default the "Mitarbeiter" select to in create mode
   * (e.g. the agent already selected in the call picker above this form) -
   * ignored if `initial` is set. */
  initialAgentId?: string;
}) {
  const router = useRouter();
  const isEdit = !!initial;
  const [agentId, setAgentId] = useState(initial?.agent_id ?? initialAgentId ?? agents[0]?.id ?? "");
  const [callDate, setCallDate] = useState(initial?.call_date ?? prefill?.call_date ?? todayIso());
  const [callDuration, setCallDuration] = useState(
    (initial?.call_duration_minutes ?? prefill?.call_duration_minutes)?.toString() ?? "",
  );
  const [callReference, setCallReference] = useState(initial?.call_reference ?? prefill?.call_reference ?? "");
  const [callRecordingUrl] = useState(initial?.call_recording_url ?? prefill?.call_recording_url ?? null);
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(
      CALL_QUALITY_PHASES.map((p) => [p.key, initial ? ((initial[`${p.key}_score` as keyof EvaluationRow] as number) ?? 0) : 0]),
    ),
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(
      CALL_QUALITY_PHASES.map((p) => [p.key, initial ? ((initial[`${p.key}_note` as keyof EvaluationRow] as string | null) ?? "") : ""]),
    ),
  );
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalScore = CALL_QUALITY_PHASES.reduce((sum, p) => sum + (scores[p.key] ?? 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId) return;

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();

    const row: EvaluationInsert = {
      agent_id: agentId,
      evaluated_by: evaluatedBy,
      call_date: callDate,
      call_duration_minutes: callDuration ? Number(callDuration) : null,
      call_reference: callReference || null,
      call_recording_url: callRecordingUrl,
      total_score: totalScore,
      comment: comment || null,
      f1_score: scores.f1 ?? 0,
      f1_note: notes.f1 || null,
      f2_score: scores.f2 ?? 0,
      f2_note: notes.f2 || null,
      f3_score: scores.f3 ?? 0,
      f3_note: notes.f3 || null,
      f4_score: scores.f4 ?? 0,
      f4_note: notes.f4 || null,
      f5_score: scores.f5 ?? 0,
      f5_note: notes.f5 || null,
    };

    const { error } = isEdit
      ? await supabase.from("agent_evaluations").update(row).eq("id", initial.id)
      : await supabase.from("agent_evaluations").insert(row);
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    router.push(isEdit ? `/admin/qa-bewertungen/${initial.id}` : "/admin/qa-bewertungen");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="agent">Mitarbeiter</Label>
          <select
            id="agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name} ({a.gebiet})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="call-date">Datum des Anrufs</Label>
          <Input id="call-date" type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="call-duration">Dauer (Minuten, optional)</Label>
          <Input
            id="call-duration"
            type="number"
            min={0}
            value={callDuration}
            onChange={(e) => setCallDuration(e.target.value)}
            placeholder="z.B. 6"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="call-reference">Anruf-Referenz (optional)</Label>
          <Input
            id="call-reference"
            value={callReference}
            onChange={(e) => setCallReference(e.target.value)}
            placeholder="Kundenname, Lead-Code, o.ä."
          />
        </div>
        {callRecordingUrl ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>Aufnahme</Label>
            <div className="flex items-center gap-2">
              <AudioPlayButton url={callRecordingUrl} size="icon-sm" label="Aufnahme dieses Anrufs" />
              <span className="text-sm text-muted-foreground">Aufnahme dieses Anrufs abspielen</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <Label>Call-Qualität Rubrik</Label>
          <span className="font-heading text-sm font-semibold text-primary tabular-nums">{totalScore} / 10</span>
        </div>
        {CALL_QUALITY_PHASES.map((phase) => (
          <div key={phase.key} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{phase.label}</span>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScores((prev) => ({ ...prev, [phase.key]: value }))}
                    className={
                      "flex size-7 items-center justify-center rounded-md border text-sm font-semibold tabular-nums transition-colors " +
                      (scores[phase.key] === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent")
                    }
                    aria-label={`${value} Punkte`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{phase.hint}</p>
            <Input
              value={notes[phase.key]}
              onChange={(e) => setNotes((prev) => ({ ...prev, [phase.key]: e.target.value }))}
              placeholder="Konkrete Beobachtung aus diesem Anruf (optional)"
              className="h-8 text-xs"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t pt-4">
        <Label htmlFor="comment">Gesamtkommentar</Label>
        <textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Zusammenfassung, Coaching-Hinweise..."
          rows={3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving" || !agentId}>
          {status === "saving" ? "Speichern..." : isEdit ? "Änderungen speichern" : "Bewertung speichern"}
        </Button>
        {status === "error" && errorMessage ? (
          <span className="text-sm text-destructive" role="alert">
            {errorMessage}
          </span>
        ) : null}
      </div>
    </form>
  );
}
