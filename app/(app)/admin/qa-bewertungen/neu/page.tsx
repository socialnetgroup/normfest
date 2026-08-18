import { notFound } from "next/navigation";

import { QaCallPicker } from "@/components/qa-call-picker";
import { getCurrentUser } from "@/lib/auth";
import { fetchDialerAgentStatuses, fetchDialerCallLog, mapExtensionsToAgentIds } from "@/lib/dialer/status";
import { createClient } from "@/lib/supabase/server";

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Real call picker (2026-08-19, Anis: "kada se bira novi formular, i agent
// da izbaci spisak poziva koji se mogu ocijeniti, sa filterom po danu...
// da odaberem pozive koje ocijeniti a koji su se desili jučer") - fetches
// the real metrike.php CDR for the selected agent's extension on the
// selected day, server-side, and hands the resulting call list to the
// client picker. See lib/dialer/status.ts's fetchDialerCallLog for why this
// stays a raw log fetch (no answered/not-answered classification) and
// components/qa-call-picker.tsx for the actual pick-a-call UX.
export default async function NeueBewertungPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string; datum?: string }>;
}) {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const { agentId: agentIdParam, datum: datumParam } = await searchParams;
  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("id, full_name, gebiet")
    .eq("active", true)
    .order("full_name");

  if (!agents || agents.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Neue Bewertung</h1>
        <p className="text-sm text-muted-foreground">Keine aktiven Mitarbeiter gefunden.</p>
      </div>
    );
  }

  const selectedAgentId = agentIdParam && agents.some((a) => a.id === agentIdParam) ? agentIdParam : agents[0].id;
  const selectedDate = datumParam || yesterdayIso();

  const [{ data: dialerRows }, { data: callLogRows, error: dialerError }] = await Promise.all([
    fetchDialerAgentStatuses().then((r) => ({ data: r.data ?? [] })),
    fetchDialerCallLog(new Date(`${selectedDate}T00:00:00`), new Date(`${selectedDate}T23:59:59`), 20000),
  ]);

  const agentByExtension = mapExtensionsToAgentIds(dialerRows, agents);
  const calls = (callLogRows ?? [])
    .filter((row) => agentByExtension.get(row.user)?.id === selectedAgentId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Neue Bewertung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mitarbeiter und Tag wählen, echten Anruf aus der Liste übernehmen (oder unten manuell eintragen).
        </p>
      </div>
      <QaCallPicker
        agents={agents}
        evaluatedBy={user.id}
        calls={calls}
        dialerError={dialerError}
        selectedAgentId={selectedAgentId}
        selectedDate={selectedDate}
      />
    </div>
  );
}
