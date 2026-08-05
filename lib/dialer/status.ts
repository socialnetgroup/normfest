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

type RawDialerRow = {
  user: string;
  full_name: string;
  status: string;
  vrijeme: string;
  campaignID: string;
  sales: string;
  totalCalls: string;
  konverzija: string;
  pauseTime: string;
  waitTime: string;
  dispoTime: string;
  deadTime: string;
  talkTime: string;
  totalTime: string;
  activeTime: string;
  inactiveTime: string;
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
    const data: DialerAgentStatus[] = raw.map((r) => ({
      extension: r.user,
      fullName: r.full_name,
      status: r.status,
      timeInStatus: r.vrijeme,
      campaignId: r.campaignID,
      sales: Number(r.sales ?? 0),
      totalCalls: Number(r.totalCalls ?? 0),
      conversionRate: r.konverzija,
      pauseTime: r.pauseTime,
      waitTime: r.waitTime,
      dispoTime: r.dispoTime,
      deadTime: r.deadTime,
      talkTime: r.talkTime,
      totalTime: r.totalTime,
      activeTime: r.activeTime,
      inactiveTime: r.inactiveTime,
    }));
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Dialer nicht erreichbar" };
  }
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
