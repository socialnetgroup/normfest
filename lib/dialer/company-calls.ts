// Matches dialer CDR rows (metrike.php, via fetchDialerCallLog in
// lib/dialer/status.ts) to real companies by phone number, so
// "how many times has this company been called" can be answered from data
// we already pull (Anis, 2026-08-19). The dialer's phone_number format and
// VIS-sourced telefon/telefon_2/telefon_3 don't always agree on a leading 0
// or country code (real pattern already noted while decoding recording
// filenames, §14 item 27's dialer memory) - matching on the last 8 digits
// is robust to that without needing to guess the exact normalization rule.

/** Strips everything but digits and keeps the last 8 - too short a suffix
 * (<6 real digits) is refused rather than matched, since a short suffix is
 * far more likely to collide with an unrelated number. */
function normalizePhoneSuffix(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.slice(-8);
}

export type CompanyForPhoneMatch = {
  id: string;
  telefon: string | null;
  telefon_2: string | null;
  telefon_3: string | null;
};

/** Builds suffix -> company_id[] once per run - a suffix mapping to more
 * than one company is real (short/reused numbers happen), so callers must
 * treat a multi-company suffix as ambiguous, not pick one. */
export function buildPhoneSuffixMap(companies: CompanyForPhoneMatch[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of companies) {
    for (const phone of [c.telefon, c.telefon_2, c.telefon_3]) {
      const suffix = normalizePhoneSuffix(phone);
      if (!suffix) continue;
      const list = map.get(suffix);
      if (list) {
        if (!list.includes(c.id)) list.push(c.id);
      } else {
        map.set(suffix, [c.id]);
      }
    }
  }
  return map;
}

export type CallForMatch = { phoneNumber: string; startTime: string; endTime: string };

export type CompanyDailyCallRow = { company_id: string; call_date: string; call_count: number };

export type MatchCallsResult = {
  rows: CompanyDailyCallRow[];
  matched: number;
  skippedAmbiguous: number;
  skippedNoMatch: number;
};

/** Matches a batch of CDR rows to companies via the suffix map, aggregating
 * into per (company, day) counts. A suffix matching 0 or 2+ companies is
 * skipped - never attribute a real call to the wrong company just to fill
 * in a number (§3.2.6's "never fabricate" discipline applies here too). */
export function matchCallsToCompanies(calls: CallForMatch[], suffixMap: Map<string, string[]>): MatchCallsResult {
  const counts = new Map<string, number>(); // key: `${companyId}|${callDate}`
  let matched = 0;
  let skippedAmbiguous = 0;
  let skippedNoMatch = 0;

  for (const call of calls) {
    const suffix = normalizePhoneSuffix(call.phoneNumber);
    if (!suffix) {
      skippedNoMatch++;
      continue;
    }
    const companies = suffixMap.get(suffix);
    if (!companies || companies.length === 0) {
      skippedNoMatch++;
      continue;
    }
    if (companies.length > 1) {
      skippedAmbiguous++;
      continue;
    }
    const companyId = companies[0];
    const callDate = (call.endTime || call.startTime || "").slice(0, 10);
    if (!callDate) {
      skippedNoMatch++;
      continue;
    }
    const key = `${companyId}|${callDate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    matched++;
  }

  const rows: CompanyDailyCallRow[] = Array.from(counts.entries()).map(([key, count]) => {
    const [companyId, callDate] = key.split("|");
    return { company_id: companyId, call_date: callDate, call_count: count };
  });

  return { rows, matched, skippedAmbiguous, skippedNoMatch };
}
