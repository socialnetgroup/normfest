// Real-time per-agent status from the existing ViciDial-based dialer
// (Anis, 2026-08-05: got this URL from the dialer dev, asked if it's a
// realtime-monitor API - confirmed live via a direct request: unauthenticated
// GET, JSON body mislabeled as text/html). Read-only - this does not start,
// control, or route any calls, and does not replace the dialer itself
// (CLAUDE.md §1: dialer stays system of record for telephony). Purely a
// live status mirror inside this app so admin doesn't need a separate tab
// open to see who's on a call right now.
const DIALER_AGENTS_URL = "http://socialnet.dialer.ba/agents.php";
const DIALER_METRIKE_URL = "http://socialnet.dialer.ba/metrike.php";

/** In-app heartbeat status (from fn_get_agent_login_status), as opposed to
 * DialerAgentStatus's real ViciDial call status - two separate data sources
 * merged into one table for report@ (2026-08-18, "status u alatu dodati
 * poslije statusa u dialeru i istu tabelu"). Exported here rather than
 * defined in the page component so DialerStatusTable can share the type
 * without importing from a page file. */
export type LoginStatus = "none" | "created" | "idle" | "online";

export type DialerAgentStatus = {
  extension: string;
  fullName: string;
  status: string;
  timeInStatus: string;
  campaignId: string;
  sales: number;
  totalCalls: number;
  conversionRate: string;
  pauseTime: string;
  waitTime: string;
  dispoTime: string;
  deadTime: string;
  talkTime: string;
  totalTime: string;
  activeTime: string;
  inactiveTime: string;
};

// Fields come back null for agents in some states (confirmed live, 2026-08-05:
// a logged-out/idle agent had status:null and campaignID:null while every
// other field was a normal string) - typed nullable throughout rather than
// trusting the one sample response this was built against, since that's
// exactly the assumption that crashed the whole page (status.toUpperCase()
// on a null status, in production, on a real agent's real current state).
type RawDialerRow = {
  user: string | null;
  full_name: string | null;
  status: string | null;
  vrijeme: string | null;
  campaignID: string | null;
  sales: string | null;
  totalCalls: string | null;
  konverzija: string | null;
  pauseTime: string | null;
  waitTime: string | null;
  dispoTime: string | null;
  deadTime: string | null;
  talkTime: string | null;
  totalTime: string | null;
  activeTime: string | null;
  inactiveTime: string | null;
};

export async function fetchDialerAgentStatuses(): Promise<{
  data: DialerAgentStatus[] | null;
  error: string | null;
}> {
  try {
    const res = await fetch(DIALER_AGENTS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { data: null, error: `Dialer antwortet mit HTTP ${res.status}` };
    }
    // Content-Type is mislabeled as text/html by the dialer even though the
    // body is JSON - parse the raw text ourselves rather than res.json().
    const raw = JSON.parse(await res.text()) as RawDialerRow[];
    const data: DialerAgentStatus[] = raw
      .filter((r) => r.user && r.full_name)
      .map((r) => ({
        extension: r.user as string,
        fullName: r.full_name as string,
        status: r.status ?? "OFFLINE",
        timeInStatus: r.vrijeme ?? "-",
        campaignId: r.campaignID ?? "-",
        sales: Number(r.sales ?? 0),
        totalCalls: Number(r.totalCalls ?? 0),
        conversionRate: r.konverzija ?? "-",
        pauseTime: r.pauseTime ?? "-",
        waitTime: r.waitTime ?? "-",
        dispoTime: r.dispoTime ?? "-",
        deadTime: r.deadTime ?? "-",
        talkTime: r.talkTime ?? "-",
        totalTime: r.totalTime ?? "-",
        activeTime: r.activeTime ?? "-",
        inactiveTime: r.inactiveTime ?? "-",
      }));
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Dialer nicht erreichbar" };
  }
}

export type DialerCallLogRow = {
  user: string;
  lengthInSec: number;
  status: string;
  startTime: string;
  endTime: string;
  phoneNumber: string;
  recording: string | null;
};

function toDialerDateTime(d: Date): string {
  // Dialer expects local "YYYY-MM-DD HH:MM:SS", not ISO/UTC - matches the
  // real format the dev's own example URL used (od=2026-08-06 11:30:00).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Real per-call log (CDR) from the dialer dev's metrike.php. A real
 * investigation (2026-08-18, §14 item 105) found the earlier "CDR
 * undercounts real calls" concern was a partial-day-window comparison
 * artifact, not a real gap - a full calendar day matches the live dialer's
 * own totalCalls within 0.6%. Real history only goes back to 2026-08-10
 * (nothing before that date exists on the dialer's side), and status codes
 * (CBHOLD, N, KV, NI, APNE, SALE, SN, DC, PARK, A, FG, ...) still have no
 * documented answered/not-answered meaning this app can rely on. 96.5% of
 * rows carry a real, working recording URL (verified via a real GET, not
 * just HEAD). Used by the QA-Bewertungen call picker (§14 item 109) to let
 * a TL browse and pick a real call to score, with its real recording
 * attached - not for any reachability/Dostupnost computation. */
export async function fetchDialerCallLog(
  from: Date,
  to: Date,
  timeoutMs = 10000,
): Promise<{ data: DialerCallLogRow[] | null; error: string | null }> {
  try {
    const url = `${DIALER_METRIKE_URL}?od=${encodeURIComponent(toDialerDateTime(from))}&do=${encodeURIComponent(toDialerDateTime(to))}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return { data: null, error: `Dialer antwortet mit HTTP ${res.status}` };
    }
    const raw = (await res.json()) as {
      user?: string;
      length_in_sec?: string;
      status?: string;
      start_time?: string;
      end_time?: string;
      phone_number?: string;
      recording?: string;
    }[];
    const data = raw
      .filter((r) => r.user)
      .map((r) => ({
        user: r.user as string,
        lengthInSec: Number(r.length_in_sec) || 0,
        status: r.status ?? "-",
        startTime: r.start_time ?? "",
        endTime: r.end_time ?? "",
        phoneNumber: r.phone_number ?? "",
        recording: r.recording || null,
      }));
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Dialer nicht erreichbar" };
  }
}

/** Real disposition-code classification (Anis, 2026-08-19: sent a screenshot
 * of the dialer's real "Hangup Again" status legend, answered 3 clarifying
 * questions, then corrected the set once more the same day: "Javilo se:
 * CALLBK, CBHOLD, NI, SALE, APNE, KK, FG, PARK, DOP / Nije se javilo: A, KV,
 * N, DC, DNC, ADM, SN - ovo je ispravno za sada ipak"). Replaces the earlier
 * synthetic talk/(talk+dispo)×totalCalls estimate with a real per-call
 * calculation - but ONLY usable for "today", since metrike.php's CDR
 * retention is same-day-only (confirmed live, §14 item 122). Historical
 * Verlauf snapshots and MonthCalendar's per-day view keep using the
 * synthetic estimate, since no real CDR exists for a past day.
 * Excluded entirely (neither reached nor not-reached, not counted in the
 * denominator either) - not named in either of Anis's two lists: KC
 * (Kontroll Call - internal QA dial, not a real customer call). */
const REACHED_STATUSES = new Set(["CALLBK", "CBHOLD", "NI", "SALE", "APNE", "KK", "FG", "PARK", "DOP"]);
const NOT_REACHED_STATUSES = new Set(["A", "KV", "N", "DC", "DNC", "ADM", "SN"]);

export function classifyCallStatus(status: string): "reached" | "not-reached" | "excluded" {
  const s = status.trim().toUpperCase();
  if (REACHED_STATUSES.has(s)) return "reached";
  if (NOT_REACHED_STATUSES.has(s)) return "not-reached";
  return "excluded";
}

/** Real per-agent reached/total counts from today's real CDR (metrike.php),
 * classified via classifyCallStatus. `total` only counts classified
 * (reached + not-reached) calls - only KC is excluded from both sides. */
export function computeRealReachedByAgent(
  calls: DialerCallLogRow[],
  extensionToAgentId: Map<string, { id: string }>,
): Map<string, { reached: number; total: number }> {
  const byAgent = new Map<string, { reached: number; total: number }>();
  for (const call of calls) {
    const agent = extensionToAgentId.get(call.user);
    if (!agent) continue;
    const cls = classifyCallStatus(call.status);
    if (cls === "excluded") continue;
    const entry = byAgent.get(agent.id) ?? { reached: 0, total: 0 };
    entry.total += 1;
    if (cls === "reached") entry.reached += 1;
    byAgent.set(agent.id, entry);
  }
  return byAgent;
}

/** Real per-(date, agent) call counts, preferring the immutable daily dialer
 * snapshot over agent_daily_performance.calls_count wherever a snapshot
 * exists for that date. Anis, 2026-08-20: "pozivi niski, pogledaj iz
 * snapshota historijski pa ubaci sta imamo" - checked directly and found
 * calls_count for 08-10 through 08-18 was significantly LOWER than the real
 * snapshot totals (e.g. 08-17: 100 stored vs. 724 real) for every date a
 * snapshot exists - the same class of overwrite already found and fixed for
 * just "yesterday" (§14 item 131), now confirmed to span most of the month:
 * a full-month Team Dashboard Excel re-import (§14 item 92) touches every
 * day's row, including days the 18:00 dialer-sync cron had already written
 * a real number into, and its own "Anzahl Anrufe" column is often lower/
 * blank for dates not yet fully entered at export time. Snapshots only
 * exist from 2026-08-10 on, so June/July and any snapshot-less August day
 * keep using the stored calls_count - there's no better real source for
 * those, not a bug. Keyed `${date}|${agentId}` so per-agent pages
 * (e.g. /tim) and per-day/team pages can both look up what they need. */
export function buildRealCallsByDateAgent(
  perfRows: { date: string; agent_id: string; calls_count: number | null }[],
  snapshotRows: { snapshot_date: string; agents: { agentId: string; totalCalls: number }[] | null }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of perfRows) {
    map.set(`${r.date}|${r.agent_id}`, r.calls_count ?? 0);
  }
  for (const snap of snapshotRows) {
    for (const a of snap.agents ?? []) {
      map.set(`${snap.snapshot_date}|${a.agentId}`, a.totalCalls ?? 0);
    }
  }
  return map;
}

/** Overrides reachedEstimate/reachedRate with the real, CDR-based numbers
 * for agents where real data is available (today only) - falls back to the
 * existing synthetic estimate for any agent missing from the real map (e.g.
 * the dialer fetch failed, or partial CDR data). Sets reachedIsReal per-row
 * so the UI never silently presents a synthetic number as if it were real,
 * or vice versa.
 *
 * Real, deliberate scaling (Anis, 2026-08-20: "% kod javio se nekako nisu
 * dobri"): metrike.php's CDR row count and agents.php's own live totalCalls
 * counter are two independently-polled sources that don't always agree
 * (confirmed live: e.g. Lejla Piric showed 148 CDR rows vs. 145 totalCalls -
 * a real ~2% drift, not a bug in either source). Showing the raw CDR
 * reached COUNT next to the "Pozivi" column (totalCalls) could then display
 * a reached count HIGHER than the calls total sitting right beside it,
 * which reads as obviously broken even though the underlying rate is real.
 * `reachedRate` stays the genuine real fraction from classified CDR data;
 * `reachedEstimate` (the displayed count) is that rate applied to the
 * agent's own totalCalls instead of the raw CDR count, so it can never
 * exceed - or look inconsistent with - the Pozivi number next to it. */
export function applyRealReachedToSummaries(
  summaries: DialerAgentSummary[],
  realReachedByAgentId: Map<string, { reached: number; total: number }>,
): DialerAgentSummary[] {
  return summaries.map((s) => {
    const real = realReachedByAgentId.get(s.agentId);
    if (!real || real.total === 0) return { ...s, reachedIsReal: false };
    const rate = real.reached / real.total;
    return {
      ...s,
      reachedEstimate: Math.round(rate * s.totalCalls),
      reachedRate: rate,
      reachedIsReal: true,
    };
  });
}

/** Dialer time fields come as "HH:MM:SS" (talk/pause/wait/dispo/dead) or
 * "HH:MM" (totalTime) or "HH:MM (xx,xx%)" (active/inactive) - strip any
 * trailing "(...)" and parse whichever colon-count shows up into seconds. */
export function parseDialerTimeToSeconds(s: string | null | undefined): number {
  if (!s || s === "-") return 0;
  const clean = s.split("(")[0].trim();
  const parts = clean.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}

/** Formats a second count back to "HH:MM:SS" for derived metrics like AHT. */
export function formatSecondsAsHms(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Re-derives the sales-sourced fields (realSales/conversion/salesPerHour) of
 * already-built summaries against a FRESH sales map, leaving every
 * dialer-sourced field (totalCalls, occupancy, time breakdowns) untouched.
 *
 * Used by the Verlauf (Tages-Snapshot) viewer: dialer_daily_snapshots stores
 * realSales frozen at whatever agent_daily_performance said at 18:00 capture
 * time, but Anis regularly imports/corrects the Team Dashboard Excel at
 * other times of day - so a stored snapshot's sales figures silently went
 * stale relative to the real, current source of truth (Anis, 2026-08-11:
 * confirmed live on the 08-10 snapshot - frozen realSales was 0 for most
 * agents, current agent_daily_performance.sales_count for that date was
 * already 1-6 after a later re-import; "sales match... everywhere" was the
 * explicit ask). totalCalls/time-breakdown fields stay frozen on purpose -
 * they're a genuine point-in-time dialer capture that can't be "corrected"
 * after the fact the way a spreadsheet-sourced sales count can. */
export function refreshSalesInSummaries(
  summaries: DialerAgentSummary[],
  salesByAgentId: Map<string, number>,
  positionsByAgentId: Map<string, number> = new Map(),
): DialerAgentSummary[] {
  return summaries.map((s) => {
    const realSales = salesByAgentId.get(s.agentId) ?? 0;
    const totalHours = parseDialerTimeToSeconds(s.totalTime) / 3600;
    return {
      ...s,
      realSales,
      salePositions: positionsByAgentId.get(s.agentId) ?? s.salePositions ?? 0,
      conversion: s.totalCalls > 0 ? realSales / s.totalCalls : 0,
      salesPerHour: totalHours > 0 ? realSales / totalHours : 0,
    };
  });
}

export type DialerAgentTotals = {
  totalCalls: number;
  callsPerHour: number;
  reachedEstimate: number;
  reachedRate: number;
  /** True when reachedEstimate/reachedRate come from real, per-call CDR
   * status-code classification (today only) rather than the synthetic
   * talk/(talk+dispo)×totalCalls estimate. §14 item added 2026-08-19. */
  reachedIsReal?: boolean;
  realSales: number;
  salePositions: number;
  conversion: number;
  salesPerHour: number;
  ahtSeconds: number;
  occupancy: number;
  talkSeconds: number;
  waitSeconds: number;
  dispoSeconds: number;
  pauseSeconds: number;
  pauseShare: number;
  deadSeconds: number;
  deadShare: number;
  totalSeconds: number;
  activeSeconds: number;
  inactiveSeconds: number;
  activeShare: number;
};

/** "Gesamt" row for DialerStatusTable - sums the count/time fields across
 * every agent shown, then recomputes the derived rates (Konversion,
 * Auslastung, AHT, ...) from those sums rather than averaging each row's
 * own already-derived rate (a straight average would let a low-volume
 * agent's outlier percentage skew the total as much as a high-volume one).
 * Anis, 2026-08-11: "add in dialer live and snapshots a Gesamt part... so I
 * can see the summary as well." */
export function computeDialerTotals(summaries: DialerAgentSummary[]): DialerAgentTotals {
  let totalCalls = 0;
  let realSales = 0;
  let salePositions = 0;
  let reachedSum = 0;
  let allRowsReal = summaries.length > 0;
  let talkSec = 0;
  let waitSec = 0;
  let dispoSec = 0;
  let pauseSec = 0;
  let deadSec = 0;
  let totalSec = 0;
  let activeSec = 0;
  let inactiveSec = 0;

  for (const s of summaries) {
    totalCalls += s.totalCalls;
    realSales += s.realSales;
    salePositions += s.salePositions;
    // Sum each row's own already-resolved reachedEstimate (real, per-call
    // CDR-based when available - see applyRealReachedToSummaries - or the
    // synthetic AHT-based fallback otherwise) rather than recomputing a
    // team-wide synthetic estimate from scratch, so the Gesamt row is
    // consistent with whatever method each individual row actually used.
    if (s.totalCalls > 0) {
      reachedSum += s.reachedEstimate;
      if (!s.reachedIsReal) allRowsReal = false;
    }
    talkSec += parseDialerTimeToSeconds(s.talkTime);
    waitSec += parseDialerTimeToSeconds(s.waitTime);
    dispoSec += parseDialerTimeToSeconds(s.dispoTime);
    pauseSec += parseDialerTimeToSeconds(s.pauseTime);
    deadSec += parseDialerTimeToSeconds(s.deadTime);
    totalSec += parseDialerTimeToSeconds(s.totalTime);
    activeSec += parseDialerTimeToSeconds(s.activeTime);
    inactiveSec += parseDialerTimeToSeconds(s.inactiveTime);
  }

  const totalHours = totalSec / 3600;
  const availableSec = talkSec + dispoSec + waitSec + deadSec;
  const activeInactiveSec = activeSec + inactiveSec;

  return {
    totalCalls,
    callsPerHour: totalHours > 0 ? totalCalls / totalHours : 0,
    reachedEstimate: reachedSum,
    reachedRate: totalCalls > 0 ? reachedSum / totalCalls : 0,
    reachedIsReal: allRowsReal,
    realSales,
    salePositions,
    conversion: totalCalls > 0 ? realSales / totalCalls : 0,
    salesPerHour: totalHours > 0 ? realSales / totalHours : 0,
    ahtSeconds: totalCalls > 0 ? (talkSec + dispoSec) / totalCalls : 0,
    occupancy: availableSec > 0 ? (talkSec + dispoSec) / availableSec : 0,
    talkSeconds: talkSec,
    waitSeconds: waitSec,
    dispoSeconds: dispoSec,
    pauseSeconds: pauseSec,
    pauseShare: totalSec > 0 ? pauseSec / totalSec : 0,
    deadSeconds: deadSec,
    deadShare: totalSec > 0 ? deadSec / totalSec : 0,
    totalSeconds: totalSec,
    activeSeconds: activeSec,
    inactiveSeconds: inactiveSec,
    activeShare: activeInactiveSec > 0 ? activeSec / activeInactiveSec : 0,
  };
}

function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Dialer full names carry no diacritics ("Alan Sacic" vs our "Alan Sačić") -
 * match by normalized comparison rather than requiring an exact string. */
export function matchDialerAgent<T extends { full_name: string }>(
  dialerFullName: string,
  agents: T[],
): T | null {
  const norm = stripDiacritics(dialerFullName);
  return agents.find((a) => stripDiacritics(a.full_name) === norm) ?? null;
}

/** Real dialer extension -> our agents.id, via a live agents.php fetch
 * (which lists every registered agent by extension + fullName, even a
 * currently logged-out one, confirmed live 2026-08-05/2026-08-18) matched
 * to our own real agents by name (same diacritic-normalized matching as
 * matchDialerAgent). Extensions are stable per agent (confirmed against a
 * real multi-day sample, §14 item 105), so this mapping is safe to use
 * against a past day's CDR rows too, not just today's live snapshot. */
export function mapExtensionsToAgentIds<T extends { id: string; full_name: string }>(
  dialerRows: DialerAgentStatus[],
  agents: T[],
): Map<string, T> {
  const byExtension = new Map<string, T>();
  for (const row of dialerRows) {
    const matched = matchDialerAgent(row.fullName, agents);
    if (matched) byExtension.set(row.extension, matched);
  }
  return byExtension;
}

export type DialerAgentSummary = {
  agentId: string;
  fullName: string;
  status: string;
  timeInStatus: string;
  totalCalls: number;
  realSales: number;
  /** Real line-item ("position") count from today's sold sales_feedback
   * rows, separate from realSales (real distinct sale count). Added
   * 2026-08-18, Anis: "to bi trebalo biti 1 prodaja 6 pozicija... u dialeru
   * oboje prikazati" - a multi-position sale (§14 item 69/80) is one real
   * sale (realSales) with several line items (salePositions); both are
   * shown separately in the Dialer table now instead of one number that
   * used to conflate them. */
  salePositions: number;
  /** Reached-calls estimate (2026-08-18, "proširiti OBIM - dostupnost", then
   * revised same day after the CDR mismatch: "koliko su pricali na osnovu
   * AHT-a") - talk/(talk+dispo) × totalCalls, computed purely from
   * already-trusted agents.php fields (see computeDialerTotals's own note).
   * `?? 0` at every read site since historical snapshots captured before
   * this field existed won't have it. */
  reachedEstimate: number;
  reachedRate: number;
  reachedIsReal?: boolean;
  conversion: number;
  callsPerHour: number;
  salesPerHour: number;
  ahtSeconds: number;
  occupancy: number;
  talkTime: string;
  waitTime: string;
  dispoTime: string;
  pauseTime: string;
  pauseShare: number;
  deadTime: string;
  deadShare: number;
  totalTime: string;
  activeTime: string;
  inactiveTime: string;
};

/** Known-agent filter + standard call-center KPI computation, shared between
 * the live /dialer page and the daily snapshot cron job so the two can never
 * silently drift apart (Anis, 2026-08-06: "dodaj sve ove podatke" on the live
 * page, then separately asked for a daily snapshot of the same data). */
export function buildDialerAgentSummaries(
  dialerRows: DialerAgentStatus[],
  agents: { id: string; full_name: string }[],
  salesByAgentId: Map<string, number>,
  positionsByAgentId: Map<string, number> = new Map(),
): DialerAgentSummary[] {
  return dialerRows
    .map((row) => ({ row, matched: matchDialerAgent(row.fullName, agents) }))
    .filter((r): r is { row: DialerAgentStatus; matched: (typeof agents)[number] } => r.matched !== null)
    .map(({ row, matched }) => {
      const realSales = salesByAgentId.get(matched.id) ?? 0;
      const salePositions = positionsByAgentId.get(matched.id) ?? 0;
      const conversion = row.totalCalls > 0 ? realSales / row.totalCalls : 0;

      const talkSec = parseDialerTimeToSeconds(row.talkTime);
      const waitSec = parseDialerTimeToSeconds(row.waitTime);
      const dispoSec = parseDialerTimeToSeconds(row.dispoTime);
      const pauseSec = parseDialerTimeToSeconds(row.pauseTime);
      const deadSec = parseDialerTimeToSeconds(row.deadTime);
      const totalSec = parseDialerTimeToSeconds(row.totalTime);
      const totalHours = totalSec / 3600;
      // Reached-calls estimate - see computeDialerTotals's own note. "-"
      // dispoTime (reconstructed/backfilled rows, §14 item 98) means the
      // handling split isn't real for this row - handled below by keeping
      // reachedRate at 0 rather than a false 100%.
      const handleSec = talkSec + dispoSec;
      const reachedRate = row.dispoTime !== "-" && handleSec > 0 ? talkSec / handleSec : 0;
      // Available time = everything except pause (standard call-center
      // formula: Occupancy = Handle Time / (Login Time - Break Time)).
      // First cut used talk+dispo+wait as the denominator, which excluded
      // deadTime entirely and made Occupancy read implausibly high (93-99%
      // for everyone) - Anis, 2026-08-06: "Auslastung sa 96% nejasna". Real
      // cause: this dialer's own waitTime is near-zero for every agent, so
      // (talk+dispo)/(talk+dispo+wait) collapses toward ~100% regardless of
      // how the day actually went - not a meaningful signal. availableSec
      // (talk+dispo+wait+dead = totalTime-pause) is the correct denominator.
      const availableSec = talkSec + dispoSec + waitSec + deadSec;

      return {
        agentId: matched.id,
        fullName: matched.full_name,
        status: row.status,
        timeInStatus: row.timeInStatus,
        totalCalls: row.totalCalls,
        realSales,
        salePositions,
        reachedEstimate: Math.round(row.totalCalls * reachedRate),
        reachedRate,
        conversion,
        callsPerHour: totalHours > 0 ? row.totalCalls / totalHours : 0,
        salesPerHour: totalHours > 0 ? realSales / totalHours : 0,
        ahtSeconds: row.totalCalls > 0 ? (talkSec + dispoSec) / row.totalCalls : 0,
        occupancy: availableSec > 0 ? (talkSec + dispoSec) / availableSec : 0,
        talkTime: row.talkTime,
        waitTime: row.waitTime,
        dispoTime: row.dispoTime,
        pauseTime: row.pauseTime,
        pauseShare: totalSec > 0 ? pauseSec / totalSec : 0,
        deadTime: row.deadTime,
        deadShare: totalSec > 0 ? deadSec / totalSec : 0,
        totalTime: row.totalTime,
        activeTime: row.activeTime,
        inactiveTime: row.inactiveTime,
      };
    });
}
