// M5 — Places resolver (CLAUDE.md §9/§13). Resolves a company (name +
// address from the VIS import) to a Google Places entry via Text Search
// (New), storing website/phone/rating/reviews (≤5, per §9's honesty rule)
// on company_enrichment. Multiple plausible matches are queued as
// `places_ambiguous` for admin review rather than guessed — §4A's "don't
// fire without data" principle applies to ambiguous matches too.
//
// Usage: node scripts/enrich-places.mjs <companyId> [companyId...]
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

async function searchPlace(company) {
  const textQuery = [company.name, company.strasse, company.plz, company.ort].filter(Boolean).join(", ");
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
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

function pickResolution(places, company) {
  if (places.length === 0) return { status: "no_match" };
  if (places.length === 1) return { status: "resolved", place: places[0] };
  const plzMatches = company.plz
    ? places.filter((p) => p.formattedAddress?.includes(company.plz))
    : [];
  if (plzMatches.length === 1) return { status: "resolved", place: plzMatches[0] };
  return { status: "ambiguous", candidates: places };
}

async function enrichOne(companyId) {
  const { data: company, error } = await admin
    .from("companies")
    .select("id, name, strasse, plz, ort")
    .eq("id", companyId)
    .single();
  if (error || !company) {
    console.error(`${companyId}: company not found`, error);
    return;
  }

  const places = await searchPlace(company);
  const resolution = pickResolution(places, company);

  const record = {
    company_id: company.id,
    places_resolved_at: new Date().toISOString(),
    places_ambiguous: resolution.status === "ambiguous",
    places_candidates: resolution.status === "ambiguous" ? resolution.candidates : null,
  };

  if (resolution.status === "resolved") {
    const p = resolution.place;
    record.places_place_id = p.id;
    record.places_name = p.displayName?.text ?? null;
    record.places_address = p.formattedAddress ?? null;
    record.places_website = p.websiteUri ?? null;
    record.places_phone = p.nationalPhoneNumber ?? null;
    record.places_rating = p.rating ?? null;
    record.places_review_count = p.userRatingCount ?? null;
    record.places_reviews = (p.reviews ?? []).slice(0, 5).map((r) => ({
      rating: r.rating ?? null,
      text: r.text?.text ?? null,
      published_at: r.publishTime ?? null,
    }));
  }

  const { error: upsertErr } = await admin
    .from("company_enrichment")
    .upsert(record, { onConflict: "company_id" });
  if (upsertErr) {
    console.error(`${company.name}: DB write failed`, upsertErr);
    return;
  }

  if (resolution.status === "no_match") {
    console.log(`${company.name}: no Places match found`);
  } else if (resolution.status === "ambiguous") {
    console.log(`${company.name}: AMBIGUOUS (${resolution.candidates.length} candidates) — queued for admin review`);
  } else {
    console.log(
      `${company.name}: resolved -> "${record.places_name}" (${record.places_review_count ?? 0} reviews, ` +
        `website: ${record.places_website ?? "none"})`,
    );
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: node scripts/enrich-places.mjs <companyId> [companyId...]");
    process.exit(1);
  }
  for (const id of ids) {
    await enrichOne(id);
  }
}

main();
