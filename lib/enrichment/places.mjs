// M5 Places resolver core logic (CLAUDE.md §9/§13), shared between the
// CLI scripts (scripts/enrich-places.mjs) and the on-demand API route
// (app/api/enrich/route.ts) — plain .mjs (not .ts) so both a bare `node`
// process and the Next.js TS build can import it without a transpile step.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.reviews.text",
  "places.reviews.rating",
  "places.reviews.publishTime",
].join(",");

export async function searchPlace(company, apiKey) {
  const textQuery = [company.name, company.strasse, company.plz, company.ort].filter(Boolean).join(", ");
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, languageCode: "de" }),
  });
  if (!res.ok) {
    throw new Error(`Places API ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.places ?? [];
}

// Street + house number + postal code, ignoring city/district-name
// suffixes - Google sometimes appends a district to the city for one
// listing but not another for the exact same building (e.g. "34385 Bad
// Karlshafen" vs "34385 Bad Karlshafen-Diemelhöhe" for the same address,
// confirmed live 2026-07-25: a company's main Places profile + a separate
// profile for an EV charging station on the same premises). Same
// street+number+PLZ is high-confidence "same physical place", safe to
// auto-merge; a genuine ambiguous case (different addresses) still falls
// through to manual review.
function addressKey(formattedAddress) {
  if (!formattedAddress) return null;
  const street = formattedAddress.split(",")[0]?.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  const plzMatch = formattedAddress.match(/\b\d{5}\b/);
  if (!street || !plzMatch) return null;
  return `${street}|${plzMatch[0]}`;
}

// Name-similarity scoring (2026-08-09, added after the whole-book rollout
// showed most ambiguous cases are unrelated businesses matching a loose text
// search, not duplicate listings of the same business - address-based
// narrowing alone can't tell those apart, but the company's own name almost
// always can). Legal-form and generic Kfz-industry words are near-universal
// in this dataset and would inflate the overlap between two completely
// unrelated shops if not filtered - the goal is to score the DISTINGUISHING
// part of the name. Shared by the live resolver (pickResolution, below),
// scripts/rescan-ambiguous-by-name.mjs, and the admin review UI
// (components/ambiguous-candidate-picker.tsx) so all three can never drift
// apart on what counts as a match (§3.2.6 "never silently mixed").
const NAME_MATCH_STOPWORDS = new Set([
  "gmbh", "co", "kg", "ohg", "ek", "ug", "ag", "gbr", "mbh", "und", "der",
  "die", "das", "von", "im", "in", "auto", "autos", "autohaus", "kfz",
  "werkstatt", "meisterbetrieb", "service", "servicecenter", "center",
  "technik", "handel", "vertrieb", "reparatur", "fahrzeug", "fahrzeuge",
  "kraftfahrzeuge", "e", "k", "inh",
]);

function normalizeCompanyName(name) {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NAME_MATCH_STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Word-overlap similarity (0-1) between a real company name and a Places candidate's name. */
export function scoreNameMatch(companyName, candidateName) {
  return jaccard(normalizeCompanyName(companyName), normalizeCompanyName(candidateName));
}

export const NAME_MATCH_DECISIVE_THRESHOLD = 0.5;
export const NAME_MATCH_DECISIVE_MARGIN = 2;

/** Ranks candidates by name match against the real company name, best first. */
export function rankByNameMatch(places, companyName) {
  return places
    .map((place) => ({ place, score: scoreNameMatch(companyName, place.displayName?.text) }))
    .sort((a, b) => b.score - a.score);
}

function decisiveNameMatch(places, companyName) {
  if (!companyName || places.length < 2) return null;
  const ranked = rankByNameMatch(places, companyName);
  const [top, runnerUp] = ranked;
  const runnerUpScore = runnerUp?.score ?? 0;
  const decisive =
    top.score >= NAME_MATCH_DECISIVE_THRESHOLD &&
    (runnerUpScore === 0 || top.score >= runnerUpScore * NAME_MATCH_DECISIVE_MARGIN);
  return decisive ? top.place : null;
}

export function pickResolution(places, company) {
  if (places.length === 0) return { status: "no_match" };
  if (places.length === 1) return { status: "resolved", place: places[0] };
  const plzMatches = company.plz ? places.filter((p) => p.formattedAddress?.includes(company.plz)) : [];
  if (plzMatches.length === 1) return { status: "resolved", place: plzMatches[0] };

  const keys = places.map((p) => addressKey(p.formattedAddress));
  if (keys.every((k) => k && k === keys[0])) {
    return { status: "resolved_merged", places };
  }

  // Real cause found 2026-08-09 (whole-book rollout, ~1,291 ambiguous
  // companies): most candidates here are unrelated businesses that matched
  // a loose text search, not duplicate listings - a decisive name match
  // against the real company name resolves a real ~19% of those
  // automatically without ever hitting the manual queue.
  const nameMatch = decisiveNameMatch(places, company.name);
  if (nameMatch) return { status: "resolved", place: nameMatch };

  return { status: "ambiguous", candidates: places };
}

// Merges multiple Places candidates confirmed to be the same physical
// location into one company_enrichment record - every review stays a real,
// individually-dated quote, just tagged with which listing it came from
// (source_listing) so it's still traceable, never blended into a single
// fabricated "summary" quote.
export function mergeCandidates(selected) {
  const primary = selected.reduce((best, c) => ((c.userRatingCount ?? 0) > (best.userRatingCount ?? 0) ? c : best));
  const reviews = selected.flatMap((c) =>
    (c.reviews ?? []).slice(0, 5).map((r) => ({
      rating: r.rating ?? null,
      text: r.text?.text ?? null,
      published_at: r.publishTime ?? null,
      source_listing: c.displayName?.text ?? null,
    })),
  );
  return {
    places_place_id: primary.id,
    places_name: primary.displayName?.text ?? null,
    places_address: primary.formattedAddress ?? null,
    places_website: primary.websiteUri ?? selected.find((c) => c.websiteUri)?.websiteUri ?? null,
    places_phone:
      primary.nationalPhoneNumber ?? selected.find((c) => c.nationalPhoneNumber)?.nationalPhoneNumber ?? null,
    places_rating: primary.rating ?? null,
    places_review_count: selected.reduce((sum, c) => sum + (c.userRatingCount ?? 0), 0),
    places_reviews: reviews,
    places_ambiguous: false,
    places_candidates: null,
    places_resolved_at: new Date().toISOString(),
  };
}

export function placeToRecord(place) {
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
  };
}

/** Resolves one company's Places entry and upserts company_enrichment. Returns { status, record }. */
export async function resolvePlaceForCompany(admin, company, apiKey) {
  const places = await searchPlace(company, apiKey);
  const resolution = pickResolution(places, company);

  const record = {
    company_id: company.id,
    places_resolved_at: new Date().toISOString(),
    places_ambiguous: resolution.status === "ambiguous",
    places_candidates: resolution.status === "ambiguous" ? resolution.candidates : null,
  };
  if (resolution.status === "resolved") {
    Object.assign(record, placeToRecord(resolution.place));
  } else if (resolution.status === "resolved_merged") {
    Object.assign(record, mergeCandidates(resolution.places));
  }

  const { error } = await admin.from("company_enrichment").upsert(record, { onConflict: "company_id" });
  if (error) throw error;

  return { status: resolution.status, record };
}
