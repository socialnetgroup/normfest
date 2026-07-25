import { notFound } from "next/navigation";

import { AgentEvaluationForm } from "@/components/agent-evaluation-form";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function NeueBewertungPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("id, full_name, gebiet")
    .eq("active", true)
    .order("full_name");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Neue Bewertung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Einen einzelnen Anruf für einen Mitarbeiter bewerten.
        </p>
      </div>
      {agents && agents.length > 0 ? (
        <AgentEvaluationForm agents={agents} evaluatedBy={user.id} />
      ) : (
        <p className="text-sm text-muted-foreground">Keine aktiven Mitarbeiter gefunden.</p>
      )}
    </div>
  );
}
