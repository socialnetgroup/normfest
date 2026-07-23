// M5 — website fetch/distill (CLAUDE.md §9). Fetches the company's
// resolved Places website, strips HTML down to readable text, truncates
// to a sane size for the LLM ANALYZE step. Simple regex-based strip is
// enough here — this feeds an LLM summary step next, not a renderer.
//
// Usage: node scripts/enrich-website.mjs <companyId> [companyId...]
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_CHARS = 6000;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function fetchWebsiteText(url) {
  // Some sites block obvious bot UAs (Cloudflare etc.) outright — a
  // realistic browser UA gets through for the ones that just do basic
  // filtering. Sites with a real JS challenge will still 403; that's a
  // genuine fetch limitation, not a bug — website_text stays null and the
  // ANALYZE step just works from reviews alone for those companies.
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return htmlToText(html).slice(0, MAX_CHARS);
}

async function enrichOne(companyId) {
  const { data: enrichment, error } = await admin
    .from("company_enrichment")
    .select("company_id, places_name, places_website")
    .eq("company_id", companyId)
    .single();
  if (error || !enrichment) {
    console.error(`${companyId}: no company_enrichment row yet — run enrich-places.mjs first`);
    return;
  }
  if (!enrichment.places_website) {
    console.log(`${enrichment.places_name ?? companyId}: no website on file, skipping`);
    return;
  }

  let text;
  try {
    text = await fetchWebsiteText(enrichment.places_website);
  } catch (err) {
    console.error(`${enrichment.places_name}: fetch failed —`, err.message);
    return;
  }

  const { error: updateErr } = await admin
    .from("company_enrichment")
    .update({ website_text: text, website_fetched_at: new Date().toISOString() })
    .eq("company_id", companyId);
  if (updateErr) {
    console.error(`${enrichment.places_name}: DB write failed`, updateErr);
    return;
  }
  console.log(`${enrichment.places_name}: fetched ${text.length} chars from ${enrichment.places_website}`);
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: node scripts/enrich-website.mjs <companyId> [companyId...]");
    process.exit(1);
  }
  for (const id of ids) {
    await enrichOne(id);
  }
}

main();
