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

export function pickResolution(places, company) {
  if (places.length === 0) return { status: "no_match" };
  if (places.length === 1) return { status: "resolved", place: places[0] };
  const plzMatches = company.plz ? places.filter((p) => p.formattedAddress?.includes(company.plz)) : [];
  if (plzMatches.length === 1) return { status: "resolved", place: plzMatches[0] };
  return { status: "ambiguous", candidates: places };
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
  }

  const { error } = await admin.from("company_enrichment").upsert(record, { onConflict: "company_id" });
  if (error) throw error;

  return { status: resolution.status, record };
}
