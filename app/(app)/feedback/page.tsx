import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FeedbackHistoryItem } from "@/components/feedback-history-item";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 30;

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Taxonomy redesigned 2026-08-08 (CLAUDE.md §14 item 27) - "interested" kept
// out of the filter options (no longer selectable going forward) but any
// pre-existing row with that outcome still renders via FeedbackHistoryItem's
// own OUTCOME_LABELS fallback.
const OUTCOME_OPTIONS = [
  { value: "sold", label: "Verkauft" },
  { value: "rejected", label: "Kein Bedarf" },
  { value: "not_relevant", label: "Nicht angetroffen" },
  { value: "keine_zeit", label: "Keine Zeit" },
  { value: "nicht_besucht", label: "Nicht besucht" },
] as const;

// Anis (2026-08-14): "dodati wiedervorlage u filtere u feedbacku. iako nije
// pravi status, da li se i po tome moze filterisati" - Wiedervorlage isn't a
// sales_feedback.outcome value (§14 item 21, its own wiedervorlage_date/
// _done pair), so it's a separate filter, not another OUTCOME_OPTIONS entry.
const WIEDERVORLAGE_OPTIONS = [
  { value: "any", label: "Mit Wiedervorlage" },
  { value: "open", label: "Offen (fällig)" },
  { value: "done", label: "Erledigt" },
] as const;

export default async function FeedbackListPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; von?: string; bis?: string; outcome?: string; wv?: string; page?: string }>;
}) {
  const {
    agent: agentFilter,
    von: vonFilter,
    bis: bisFilter,
    outcome: outcomeFilter,
    wv: wvFilter,
    page: pageParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { user, profile } = await getCurrentUser();
  const isAdmin = profile?.role === "admin";
  const supabase = await createClient();

  // Anis (2026-08-08): the page/data itself has always been team-shared
  // (sales_feedback's own RLS), but non-admin agents were seeing everyone's
  // feedback here too - the ask was to see their own in one place ("umjesto
  // od firme do firme"), not the whole team's. Force-scope to self for
  // non-admins (ignore any ?agent= param they might pass) - admins keep the
  // full picker, defaulting to "Alle" as before.
  const effectiveAgentFilter = isAdmin ? agentFilter : user?.id;

  let feedbackBuilder = supabase
    .from("sales_feedback")
    .select(
      "id, agent_id, company_id, outcome, qty, value_net, objection, comment, created_at, product_id, wiedervorlage_date, wiedervorlage_done, companies(name), products(name), profiles(full_name, agents(id))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (effectiveAgentFilter) feedbackBuilder = feedbackBuilder.eq("agent_id", effectiveAgentFilter);
  if (outcomeFilter) feedbackBuilder = feedbackBuilder.eq("outcome", outcomeFilter);
  if (wvFilter === "any") feedbackBuilder = feedbackBuilder.not("wiedervorlage_date", "is", null);
  else if (wvFilter === "open") feedbackBuilder = feedbackBuilder.not("wiedervorlage_date", "is", null).eq("wiedervorlage_done", false);
  else if (wvFilter === "done") feedbackBuilder = feedbackBuilder.eq("wiedervorlage_done", true);
  // Alan's pilot feedback (2026-08-08): "Feedback (tag) cijeli mjesec od-do
  // da se moze odabrati" - was single-day only, now a Von/Bis range (either
  // side optional, so "seit X" / "bis X" work too, not just a closed range).
  if (vonFilter) feedbackBuilder = feedbackBuilder.gte("created_at", `${vonFilter}T00:00:00.000Z`);
  if (bisFilter) feedbackBuilder = feedbackBuilder.lte("created_at", `${bisFilter}T23:59:59.999Z`);

  const [{ data: agentOptions }, { data: feedbackRows, count }] = await Promise.all([
    isAdmin
      ? supabase.from("agents").select("id, full_name, profile_id").not("profile_id", "is", null).order("full_name")
      : Promise.resolve({ data: null }),
    feedbackBuilder,
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(agentFilter || vonFilter || bisFilter || outcomeFilter || wvFilter);

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (agentFilter) params.set("agent", agentFilter);
    if (vonFilter) params.set("von", vonFilter);
    if (bisFilter) params.set("bis", bisFilter);
    if (outcomeFilter) params.set("outcome", outcomeFilter);
    if (wvFilter) params.set("wv", wvFilter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/feedback?${qs}` : "/feedback";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Alle erfassten Verkaufsergebnisse - team-weit sichtbar (Flywheel)."
            : "Deine erfassten Verkaufsergebnisse - alles an einem Ort statt von Firma zu Firma."}
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form action="/feedback" className="flex flex-wrap items-end gap-3">
            {isAdmin ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="agent">Agent</Label>
                <select id="agent" name="agent" defaultValue={agentFilter ?? ""} className={selectClassName}>
                  <option value="">Alle</option>
                  {(agentOptions ?? []).map((a) => (
                    <option key={a.id} value={a.profile_id!}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="outcome">Ergebnis</Label>
              <select id="outcome" name="outcome" defaultValue={outcomeFilter ?? ""} className={selectClassName}>
                <option value="">Alle</option>
                {OUTCOME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wv">Wiedervorlage</Label>
              <select id="wv" name="wv" defaultValue={wvFilter ?? ""} className={selectClassName}>
                <option value="">Alle</option>
                {WIEDERVORLAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
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
              <Link href="/feedback" className="pb-1.5 text-sm text-muted-foreground hover:underline">
                Zurücksetzen
              </Link>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {total} Feedback{total === 1 ? "" : "s"}
            {hasFilter ? " (gefiltert)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!feedbackRows || feedbackRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Feedback-Einträge gefunden.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {feedbackRows.map((f) => {
                const fp = f.profiles as { full_name: string | null; agents: { id: string }[] } | null;
                const linkedAgentId = fp?.agents?.[0]?.id;
                return (
                  <FeedbackHistoryItem
                    key={f.id}
                    id={f.id}
                    outcome={f.outcome}
                    qty={f.qty}
                    valueNet={f.value_net}
                    objection={f.objection}
                    comment={f.comment}
                    createdAt={f.created_at}
                    productId={f.product_id}
                    productName={(f.products as { name: string } | null)?.name ?? null}
                    agentName={fp?.full_name ?? "-"}
                    adminAgentLink={isAdmin && linkedAgentId ? `/admin/team/${linkedAgentId}` : null}
                    canEdit={f.agent_id === user?.id || isAdmin}
                    companyId={f.company_id}
                    companyName={(f.companies as { name: string } | null)?.name ?? "-"}
                    wiedervorlageDate={f.wiedervorlage_date}
                    wiedervorlageDone={f.wiedervorlage_done}
                  />
                );
              })}
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
