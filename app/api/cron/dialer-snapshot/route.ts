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
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const todayStr = new Date().toISOString().slice(0, 10);

  const [{ data: dialerRows, error: fetchError }, { data: agents }, { data: perfRows }] = await Promise.all([
    fetchDialerAgentStatuses(),
    admin.from("agents").select("id, full_name").eq("active", true),
    admin.from("agent_daily_performance").select("agent_id, sales_count").eq("date", todayStr),
  ]);

  if (fetchError || !dialerRows) {
    return NextResponse.json({ error: fetchError ?? "no dialer data" }, { status: 502 });
  }

  const salesByAgentId = new Map((perfRows ?? []).map((r) => [r.agent_id, r.sales_count]));
  const summaries = buildDialerAgentSummaries(dialerRows, agents ?? [], salesByAgentId);

  const { error: upsertError } = await admin
    .from("dialer_daily_snapshots")
    .upsert({ snapshot_date: todayStr, captured_at: new Date().toISOString(), agents: summaries }, { onConflict: "snapshot_date" });

  if (upsertError) {
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
      return NextResponse.json({ error: callsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ snapshot_date: todayStr, agent_count: summaries.length, calls_synced: callsRows.length });
}
