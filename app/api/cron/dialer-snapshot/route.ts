import { NextResponse } from "next/server";

import { buildPhoneSuffixMap, matchCallsToCompanies } from "@/lib/dialer/company-calls";
import {
  applyRealReachedToSummaries,
  buildDialerAgentSummaries,
  computeRealReachedByAgent,
  fetchDialerAgentStatuses,
  fetchDialerCallLog,
  mapExtensionsToAgentIds,
} from "@/lib/dialer/status";
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
  let summaries = buildDialerAgentSummaries(dialerRows, agents ?? [], salesByAgentId, positionsByAgentId);

  // Real "Erreicht" for the stored snapshot itself, not just the live page
  // (Anis, 2026-08-21: "in snapshots vom dialer nicht mehr (geschätzt) bei
  // Erreicht, denn wir ziehen jetzt echte statuse aus dem dialer"). The
  // synthetic talk/(talk+dispo)×totalCalls estimate (§14 items 100/101) was
  // only ever a stand-in for when no real per-call status data existed - at
  // cron time, today's real CDR is still fully available (metrike.php's
  // same-day-only retention, §14 item 122, means "today" is always in
  // range), so the snapshot can carry the same real classification the live
  // Dialer table already uses (§14 item 129) instead of baking the estimate
  // in permanently. `callLog` is fetched once here and reused below for the
  // company_daily_calls sync too, rather than fetching twice.
  const { data: callLog, error: callLogError } = await fetchDialerCallLog(
    new Date(`${todayStr}T00:00:00`),
    new Date(),
    20000,
  );
  if (callLogError || !callLog) {
    console.error("[dialer-snapshot] real-reached classification skipped, using synthetic estimate:", callLogError);
  } else {
    const extensionToAgentId = mapExtensionsToAgentIds(dialerRows, agents ?? []);
    const realReachedByAgentId = computeRealReachedByAgent(callLog, extensionToAgentId);
    summaries = applyRealReachedToSummaries(summaries, realReachedByAgentId);
  }

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

  // "Koliko puta je neka firma nazvana?" (Anis, 2026-08-19) - real
  // per-company call counts for the Firmenprofil's Aktivität card, matched
  // from today's CDR (metrike.php) to companies by phone number
  // (lib/dialer/company-calls.ts). Reuses the same `callLog` already
  // fetched above for the snapshot's real-reached classification, instead
  // of fetching metrike.php a second time. Best-effort: a failure here
  // shouldn't fail the whole cron run (the Live-Status snapshot above is
  // the primary, already-logged concern) - logged to console only, not to
  // dialer_snapshot_log, so it doesn't mask a real Live-Status failure.
  let companyCallsSynced = 0;
  try {
    if (callLogError || !callLog) {
      console.error("[dialer-snapshot] company-call sync skipped:", callLogError);
    } else {
      let companies: { id: string; telefon: string | null; telefon_2: string | null; telefon_3: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from("companies")
          .select("id, telefon, telefon_2, telefon_3")
          .range(from, from + 999);
        if (error || !data) break;
        companies = companies.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const suffixMap = buildPhoneSuffixMap(companies);
      const { rows } = matchCallsToCompanies(callLog, suffixMap);
      if (rows.length > 0) {
        const { error: callsUpsertError } = await admin
          .from("company_daily_calls")
          .upsert(rows, { onConflict: "company_id,call_date" });
        if (callsUpsertError) {
          console.error("[dialer-snapshot] company_daily_calls upsert failed:", callsUpsertError.message);
        } else {
          companyCallsSynced = rows.length;
        }
      }
    }
  } catch (e) {
    console.error("[dialer-snapshot] company-call sync threw:", e instanceof Error ? e.message : e);
  }

  await logAttempt(true, null, summaries.length, attemptsUsed);
  return NextResponse.json({
    snapshot_date: todayStr,
    agent_count: summaries.length,
    calls_synced: callsRows.length,
    company_calls_synced: companyCallsSynced,
    attemptsUsed,
  });
}
