// Real-time per-agent status from the existing ViciDial-based dialer
// (Anis, 2026-08-05: got this URL from the dialer dev, asked if it's a
// realtime-monitor API - confirmed live via a direct request: unauthenticated
// GET, JSON body mislabeled as text/html). Read-only - this does not start,
// control, or route any calls, and does not replace the dialer itself
// (CLAUDE.md §1: dialer stays system of record for telephony). Purely a
// live status mirror inside this app so admin doesn't need a separate tab
// open to see who's on a call right now.
const DIALER_AGENTS_URL = "http://socialnet.dialer.ba/agents.php";

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

export type DialerAgentSummary = {
  agentId: string;
  fullName: string;
  status: string;
  timeInStatus: string;
  totalCalls: number;
  realSales: number;
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
): DialerAgentSummary[] {
  return dialerRows
    .map((row) => ({ row, matched: matchDialerAgent(row.fullName, agents) }))
    .filter((r): r is { row: DialerAgentStatus; matched: (typeof agents)[number] } => r.matched !== null)
    .map(({ row, matched }) => {
      const realSales = salesByAgentId.get(matched.id) ?? 0;
      const conversion = row.totalCalls > 0 ? realSales / row.totalCalls : 0;

      const talkSec = parseDialerTimeToSeconds(row.talkTime);
      const waitSec = parseDialerTimeToSeconds(row.waitTime);
      const dispoSec = parseDialerTimeToSeconds(row.dispoTime);
      const pauseSec = parseDialerTimeToSeconds(row.pauseTime);
      const deadSec = parseDialerTimeToSeconds(row.deadTime);
      const totalSec = parseDialerTimeToSeconds(row.totalTime);
      const totalHours = totalSec / 3600;
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
