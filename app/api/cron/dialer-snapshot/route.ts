import { NextResponse } from "next/server";

import { buildDialerAgentSummaries, fetchDialerAgentStatuses } from "@/lib/dialer/status";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily dialer snapshot (Anis, 2026-08-06): "posto nemamo logove, da li te
// mogu zamoliti da napravis ti automatski nase logove dok se dev ne vrati...
// samo screenshot tj snap informacija na kraju radnog dana." Triggered by
// Vercel Cron (see vercel.json) once a day, before the dialer's own
// Live-Status numbers reset for the next day. Not user-invoked - secured via
// CRON_SECRET rather than a user session, same pattern Vercel's own docs
// recommend for cron routes.
//
// Hardened 2026-08-18 after a real, unexplained gap (17.08. missing, no
// Vercel log access from this environment to diagnose why) - Anis: "ojačaj
// svakako". Three layers:
//  1. Retry the dialer fetch itself (transient network hiccups talking to
//     socialnet.dialer.ba) before giving up.
//  2. A second daily cron entry an hour later (vercel.json) as a safety net
//     against a whole-invocation failure (deploy in flight, cold start,
//     etc.) - safe because this route always upserts on snapshot_date, so a
//     second successful run just refreshes the same day with fresher data.
//  3. Every invocation - success or failure - writes a row to
//     dialer_snapshot_log, so a future gap is diagnosable directly from the
//     DB instead of needing Vercel dashboard access this environment doesn't
//     have.
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDialerWithRetry(maxAttempts = 3) {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await fetchDialerAgentStatuses();
    if (!error && data) return { data, error: null, attemptsUsed: attempt };
    lastError = error;
    if (attempt < maxAttempts) await sleep(attempt * 3000);
  }
  return { data: null, error: lastError, attemptsUsed: maxAttempts };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const todayStr = new Date().toISOString().slice(0, 10);

  async function logAttempt(success: boolean, error: string | null, agentCount: number | null, attemptsUsed: number) {
    await admin
      .from("dialer_snapshot_log")
      .insert({ snapshot_date: todayStr, success, error, agent_count: agentCount, attempts_used: attemptsUsed });
  }

  const { data: dialerRows, error: fetchError, attemptsUsed } = await fetchDialerWithRetry();
  const [{ data: agents }, { data: perfRows }, { data: soldRows }] = await Promise.all([
    admin.from("agents").select("id, full_name, profile_id").eq("active", true),
    admin.from("agent_daily_performance").select("agent_id, sales_count").eq("date", todayStr),
    // salePositions (2026-08-18): real line-item count, separate from the
    // now-batch-aware sales_count above - see lib/dialer/status.ts.
    admin.from("sales_feedback").select("agent_id").eq("outcome", "sold").gte("created_at", `${todayStr}T00:00:00Z`),
  ]);

  if (fetchError || !dialerRows) {
    await logAttempt(false, fetchError ?? "no dialer data", null, attemptsUsed);
    return NextResponse.json({ error: fetchError ?? "no dialer data", attemptsUsed }, { status: 502 });
  }

  const salesByAgentId = new Map((perfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
  const agentIdByProfileId = new Map(
    (agents ?? []).filter((a) => a.profile_id).map((a) => [a.profile_id as string, a.id]),
  );
  const positionsByAgentId = new Map<string, number>();
  for (const row of soldRows ?? []) {
    const agentId = agentIdByProfileId.get(row.agent_id);
    if (!agentId) continue;
    positionsByAgentId.set(agentId, (positionsByAgentId.get(agentId) ?? 0) + 1);
  }
  // Javilo se (procjena) (2026-08-18) is now computed inside
  // buildDialerAgentSummaries directly from real agents.php fields - no
  // separate CDR fetch needed for the daily snapshot either.
  const summaries = buildDialerAgentSummaries(dialerRows, agents ?? [], salesByAgentId, positionsByAgentId);

  const { error: upsertError } = await admin
    .from("dialer_daily_snapshots")
    .upsert({ snapshot_date: todayStr, captured_at: new Date().toISOString(), agents: summaries }, { onConflict: "snapshot_date" });

  if (upsertError) {
    await logAttempt(false, upsertError.message, summaries.length, attemptsUsed);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // Alan's pilot feedback (2026-08-06 follow-up): "Anrufe" is now removed
  // from the Dashboard's manual counter - the real per-day call count should
  // come from the dialer instead of an agent remembering to click "Anruf
  // zählen". Partial upsert only ever sets calls_count (revenue/sales_count
  // have their own NOT NULL defaults so a first-insert-of-the-day doesn't
  // fail, and an existing row's revenue/sales_count/source_file from
  // fn_log_sale/the Team Dashboard import are left untouched since they're
  // not in this payload - source_file deliberately omitted so an UPDATE
  // never clobbers that row's real provenance, same "only the listed columns
  // get updated" behavior already relied on by fn_log_call/fn_log_sale). A
  // later monthly Team Dashboard Excel re-import can still overwrite this
  // for past dates if that file's own "Anzahl Anrufe" column disagrees -
  // same accepted source-of-truth trade-off as the existing telefon/website
  // VIS-wins pattern (§14 item 11).
  const callsRows = summaries.map((s) => ({
    agent_id: s.agentId,
    date: todayStr,
    calls_count: s.totalCalls,
  }));
  if (callsRows.length > 0) {
    const { error: callsError } = await admin
      .from("agent_daily_performance")
      .upsert(callsRows, { onConflict: "agent_id,date" });
    if (callsError) {
      await logAttempt(false, callsError.message, summaries.length, attemptsUsed);
      return NextResponse.json({ error: callsError.message }, { status: 500 });
    }
  }

  await logAttempt(true, null, summaries.length, attemptsUsed);
  return NextResponse.json({ snapshot_date: todayStr, agent_count: summaries.length, calls_synced: callsRows.length, attemptsUsed });
}
