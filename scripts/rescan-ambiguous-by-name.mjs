// Zero-API-cost auto-resolve pass for the ambiguous Places queue
// (2026-08-09), Anis: after the whole-book Places rollout grew the queue
// from 55 to 1,291, direct inspection showed the existing auto-resolve
// rules (exact PLZ match, same address) don't apply to almost any of them -
// zero rows shared an address (scripts/rescan-ambiguous-same-address.mjs
// found 0/1291). Real cause: for many companies, the raw Places text search
// returned several unrelated businesses in the same city/area (e.g. "KFZ
// Style Hamm" got 12 candidates across 6 different streets/3 postal codes)
// rather than 2 listings of the same real business - the resolver never
// checked candidate NAME similarity, only address, so all of those got
// dumped into the manual queue even when one candidate's name obviously
// matches the real company.
//
// This re-scores already-stored places_candidates (no new Places API calls -
// same "free, safe to run any time" shape as the address-merge script) using
// the same normalize/jaccard word-overlap approach already proven elsewhere
// in this app (scripts/detect-catalog-duplicates.mjs,
// scripts/fill-representative-images.mjs). Auto-resolves only when the top
// candidate's name match is DECISIVE (score >= 0.5 AND at least double the
// runner-up's score) - conservative on purpose, since a wrong auto-pick here
// means showing an agent someone else's Google reviews as if they were the
// real company's. Anything else stays in the manual queue.
//
// Usage: node scripts/rescan-ambiguous-by-name.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SCORE_THRESHOLD = 0.5;
const MARGIN_MULTIPLIER = 2;

// Legal-form and generic Kfz-industry words are near-universal in this
// dataset ("Autohaus", "KFZ", "GmbH"...) and would inflate the overlap score
// between two completely unrelated shops if not filtered - the whole point
// is to find the DISTINGUISHING part of the name.
const STOPWORDS = new Set([
  "gmbh", "co", "kg", "ohg", "ek", "ug", "ag", "gbr", "mbh", "und", "der",
  "die", "das", "von", "im", "in", "auto", "autos", "autohaus", "kfz",
  "werkstatt", "meisterbetrieb", "service", "servicecenter", "center",
  "technik", "handel", "vertrieb", "reparatur", "fahrzeug", "fahrzeuge",
  "kraftfahrzeuge", "e", "k", "inh",
]);

function normalize(name) {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function fetchAllAmbiguous() {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("company_enrichment")
      .select("id, company_id, places_candidates, companies(name)")
      .eq("places_ambiguous", true)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function mergeSingle(place) {
  return {
    places_place_id: place.id,
    places_name: place.displayName?.text ?? null,
    places_address: place.formattedAddress ?? null,
    places_website: place.websiteUri ?? null,
    places_phone: place.nationalPhoneNumber ?? null,
    places_rating: place.rating ?? null,
    places_review_count: place.userRatingCount ?? null,
    places_reviews: (place.reviews ?? []).slice(0, 5).map((r) => ({
      rating: r.rating ?? null,
      text: r.text?.text ?? null,
      published_at: r.publishTime ?? null,
    })),
    places_ambiguous: false,
    places_candidates: null,
    places_resolved_at: new Date().toISOString(),
  };
}

async function main() {
  const rows = await fetchAllAmbiguous();
  console.log(`${rows.length} ambiguous Einträge werden nach Namensähnlichkeit geprüft...\n`);

  let resolved = 0;
  let staysAmbiguous = 0;

  for (const row of rows) {
    const companyName = row.companies?.name;
    const candidates = row.places_candidates ?? [];
    if (!companyName || candidates.length === 0) {
      staysAmbiguous++;
      continue;
    }

    const companyTokens = normalize(companyName);
    const scored = candidates
      .map((c) => ({ place: c, score: jaccard(companyTokens, normalize(c.displayName?.text)) }))
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    const runnerUp = scored[1]?.score ?? 0;
    const decisive = top.score >= SCORE_THRESHOLD && (runnerUp === 0 || top.score >= runnerUp * MARGIN_MULTIPLIER);

    if (!decisive) {
      staysAmbiguous++;
      continue;
    }

    resolved++;
    console.log(
      `  [Name-Match ${top.score.toFixed(2)} vs. ${runnerUp.toFixed(2)}] "${companyName}" -> "${top.place.displayName?.text}" (${top.place.formattedAddress})`,
    );

    if (!DRY_RUN) {
      const { error } = await admin.from("company_enrichment").update(mergeSingle(top.place)).eq("id", row.id);
      if (error) console.log(`    Fehler: ${error.message}`);
    }
  }

  console.log(`\nAufgelöst (eindeutiger Namens-Match): ${resolved}`);
  console.log(`Bleibt echt mehrdeutig: ${staysAmbiguous}`);
  if (DRY_RUN) console.log("\n--dry-run: keine Schreibvorgänge.");
}

main();
