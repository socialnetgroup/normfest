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

export function pickResolution(places, company) {
  if (places.length === 0) return { status: "no_match" };
  if (places.length === 1) return { status: "resolved", place: places[0] };
  const plzMatches = company.plz ? places.filter((p) => p.formattedAddress?.includes(company.plz)) : [];
  if (plzMatches.length === 1) return { status: "resolved", place: plzMatches[0] };

  const keys = places.map((p) => addressKey(p.formattedAddress));
  if (keys.every((k) => k && k === keys[0])) {
    return { status: "resolved_merged", places };
  }

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
