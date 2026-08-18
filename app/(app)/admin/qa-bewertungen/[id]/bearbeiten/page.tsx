import { notFound } from "next/navigation";

import { AgentEvaluationForm } from "@/components/agent-evaluation-form";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function BewertungBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const [{ data: agents }, { data: evaluation }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet").eq("active", true).order("full_name"),
    supabase
      .from("agent_evaluations")
      .select(
        `id, agent_id, call_date, call_duration_minutes, call_reference, call_recording_url, comment,
        f1_score, f1_note, f2_score, f2_note, f3_score, f3_note, f4_score, f4_note, f5_score, f5_note`,
      )
      .eq("id", id)
      .single(),
  ]);

  if (!evaluation) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bewertung bearbeiten</h1>
        <p className="mt-1 text-sm text-muted-foreground">Änderungen werden direkt gespeichert.</p>
      </div>
      <AgentEvaluationForm agents={agents ?? []} evaluatedBy={user.id} initial={evaluation} />
    </div>
  );
}
