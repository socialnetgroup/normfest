// M5 website fetch/distill core logic, shared between scripts/enrich-website.mjs
// and the on-demand API route.
const MAX_CHARS = 6000;

export function htmlToText(html) {
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

export async function fetchWebsiteText(url) {
  // Bare/bot-labeled UAs get blocked or time out on real sites tested; a
  // realistic browser UA gets through the basic filters. Sites with a real
  // JS challenge will still 403 — that's a genuine fetch limitation, not a
  // bug (caller should treat it as "no website text", not fatal).
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

/** Fetches and stores website_text for one company's enrichment row. Returns { fetched: boolean, text? } */
export async function fetchWebsiteForCompany(admin, companyId) {
  const { data: enrichment, error } = await admin
    .from("company_enrichment")
    .select("company_id, places_website")
    .eq("company_id", companyId)
    .single();
  if (error || !enrichment) throw error ?? new Error("no company_enrichment row");
  if (!enrichment.places_website) return { fetched: false, reason: "no_website" };

  const text = await fetchWebsiteText(enrichment.places_website);

  const { error: updateErr } = await admin
    .from("company_enrichment")
    .update({ website_text: text, website_fetched_at: new Date().toISOString() })
    .eq("company_id", companyId);
  if (updateErr) throw updateErr;

  return { fetched: true, text };
}
