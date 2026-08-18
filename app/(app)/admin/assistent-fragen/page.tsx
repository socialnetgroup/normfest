import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 30;

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Sarajevo",
});

// Anis (2026-08-18): "Mogu li dobiti listing pitanja u AI Asistentu i ko je
// napravio" - chat_log has always been private-per-agent (§10 M7, "a chat
// transcript is closer to a personal notebook") EXCEPT for admin, who can
// already read every row via chat_log_select_own_or_admin - this is the
// first UI that actually surfaces that admin-only read, listing each real
// question (role='user') with who asked it and when. Answers/tool_calls are
// deliberately not shown here - just the question + author, matching the
// literal ask ("listing pitanja i ko je napravio"), not a full transcript
// viewer (that's a bigger, separate feature if ever needed).
export default async function AssistentFragenPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; von?: string; bis?: string; page?: string }>;
}) {
  const { agent: agentFilter, von: vonFilter, bis: bisFilter, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();

  let questionsBuilder = supabase
    .from("chat_log")
    .select("id, agent_id, content, created_at, profiles(full_name)", { count: "exact" })
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .range(from, to);
  if (agentFilter) questionsBuilder = questionsBuilder.eq("agent_id", agentFilter);
  if (vonFilter) questionsBuilder = questionsBuilder.gte("created_at", `${vonFilter}T00:00:00.000Z`);
  if (bisFilter) questionsBuilder = questionsBuilder.lte("created_at", `${bisFilter}T23:59:59.999Z`);

  const [{ data: agentOptions }, { data: questionRows, count }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").order("full_name"),
    questionsBuilder,
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(agentFilter || vonFilter || bisFilter);

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (agentFilter) params.set("agent", agentFilter);
    if (vonFilter) params.set("von", vonFilter);
    if (bisFilter) params.set("bis", bisFilter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/assistent-fragen?${qs}` : "/admin/assistent-fragen";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
          <Sparkles className="size-6 text-primary" />
          Assistent-Fragen
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle im KI-Assistenten gestellten Fragen, mit Autor und Zeitpunkt - Antworten und Tool-Aufrufe werden hier
          nicht angezeigt.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form action="/admin/assistent-fragen" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="agent">Agent</Label>
              <select id="agent" name="agent" defaultValue={agentFilter ?? ""} className={selectClassName}>
                <option value="">Alle</option>
                {(agentOptions ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="von">Von</Label>
              <Input id="von" name="von" type="date" defaultValue={vonFilter ?? ""} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bis">Bis</Label>
              <Input id="bis" name="bis" type="date" defaultValue={bisFilter ?? ""} className="w-40" />
            </div>
            <Button type="submit" size="sm">
              Filtern
            </Button>
            {hasFilter ? (
              <Link href="/admin/assistent-fragen" className="pb-1.5 text-sm text-muted-foreground hover:underline">
                Zurücksetzen
              </Link>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {total} Frage{total === 1 ? "" : "n"}
            {hasFilter ? " (gefiltert)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!questionRows || questionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Fragen gefunden.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {questionRows.map((q) => (
                <li key={q.id} className="flex flex-col gap-1 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {(q.profiles as { full_name: string | null } | null)?.full_name ?? "-"}
                    </span>
                    <span className="tabular-nums">{dateTimeFmt.format(new Date(q.created_at))} Uhr</span>
                  </div>
                  <p className="text-sm">{q.content}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-4 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="hover:underline">
              ← Zurück
            </Link>
          ) : (
            <span className="text-muted-foreground/40">← Zurück</span>
          )}
          <span className="text-muted-foreground">
            Seite {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="hover:underline">
              Weiter →
            </Link>
          ) : (
            <span className="text-muted-foreground/40">Weiter →</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
