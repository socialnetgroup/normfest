"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AgentEvaluationForm, type EvaluationPrefill } from "@/components/agent-evaluation-form";
import type { DialerCallLogRow } from "@/lib/dialer/status";

type Agent = { id: string; full_name: string; gebiet: string };

function formatCallTime(startTime: string) {
  // startTime is a real "YYYY-MM-DD HH:MM:SS" local string from metrike.php.
  const [, time] = startTime.split(" ");
  return time ? time.slice(0, 5) : startTime;
}

function formatDurationMinSec(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const selectClassName =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** QA-Bewertungen call picker (2026-08-19, Anis: "kada se bira novi formular,
 * i agent da izbaci spisak poziva koji se mogu ocijeniti, sa filterom po
 * danu... da odaberem pozive koje ocijeniti") - the Agent+Datum GET-form
 * (server-refetches real CDR rows for that agent/day) lives in the page
 * component; this client component owns just the "pick one real call to
 * pre-fill the form with" interaction, so no page reload is needed for that
 * part. Manual entry (no call selected) still works exactly as before -
 * this is additive, not a replacement, for calls before the CDR's own real
 * history start (2026-08-10, §14 item 105) or a dialer outage. */
export function QaCallPicker({
  agents,
  evaluatedBy,
  calls,
  dialerError,
  selectedAgentId,
  selectedDate,
}: {
  agents: Agent[];
  evaluatedBy: string;
  calls: DialerCallLogRow[];
  dialerError: string | null;
  selectedAgentId: string;
  selectedDate: string;
}) {
  const [selectedCall, setSelectedCall] = useState<DialerCallLogRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const statusOptions = [...new Set(calls.map((c) => c.status))].sort();
  const filteredCalls = statusFilter ? calls.filter((c) => c.status === statusFilter) : calls;

  const prefill: EvaluationPrefill | undefined = selectedCall
    ? {
        call_date: selectedDate,
        call_duration_minutes: Math.round(selectedCall.lengthInSec / 60),
        call_reference: `${selectedCall.phoneNumber || "-"} um ${formatCallTime(selectedCall.startTime)} Uhr (${selectedCall.status})`,
        call_recording_url: selectedCall.recording,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="agentId">Mitarbeiter (für Anrufliste)</Label>
            <select id="agentId" name="agentId" defaultValue={selectedAgentId} className={selectClassName}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name} ({a.gebiet})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="datum">Datum</Label>
            <input
              id="datum"
              name="datum"
              type="date"
              defaultValue={selectedDate}
              className={selectClassName}
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Anrufe laden
          </Button>
        </form>

        {calls.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1">
            <Label htmlFor="statusFilter">Status filtern</Label>
            <select
              id="statusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${selectClassName} w-fit`}
            >
              <option value="">Alle Status ({calls.length})</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status} ({calls.filter((c) => c.status === status).length})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4">
          {dialerError ? (
            <p className="text-sm text-destructive">Dialer nicht erreichbar: {dialerError}</p>
          ) : calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Anrufe für diesen Mitarbeiter an diesem Tag gefunden (echte Anruf-Historie beginnt am
              10.08.2026).
            </p>
          ) : filteredCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Anrufe mit Status &quot;{statusFilter}&quot; gefunden.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Uhrzeit</th>
                    <th className="px-3 py-2 font-medium">Dauer</th>
                    <th className="px-3 py-2 font-medium">Telefonnummer</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Aufnahme</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCalls.map((call, i) => (
                    <tr key={`${call.startTime}-${i}`} className={selectedCall === call ? "bg-accent" : undefined}>
                      <td className="px-3 py-2 tabular-nums">{formatCallTime(call.startTime)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatDurationMinSec(call.lengthInSec)}</td>
                      <td className="px-3 py-2 tabular-nums">{call.phoneNumber || "-"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="muted">{call.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {call.recording ? (
                          <a
                            href={call.recording}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            🎧
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="xs"
                          variant={selectedCall === call ? "default" : "outline"}
                          onClick={() => setSelectedCall(call)}
                        >
                          {selectedCall === call ? "Ausgewählt" : "Diesen Anruf bewerten"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AgentEvaluationForm
        key={selectedCall ? `${selectedCall.startTime}-${selectedCall.user}` : "manual"}
        agents={agents}
        evaluatedBy={evaluatedBy}
        prefill={prefill}
        initialAgentId={selectedAgentId}
      />
    </div>
  );
}
