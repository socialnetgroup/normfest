import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { analyzeCompanyEnrichment } from "@/lib/enrichment/analyze.mjs";
import { fetchWebsiteForCompany } from "@/lib/enrichment/website.mjs";
import { resolvePlaceForCompany } from "@/lib/enrichment/places.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// M5 on-demand enrichment (CLAUDE.md §9/§13): runs Places -> website ->
// LLM ANALYZE synchronously for one company. Admin-only — the pipeline
// otherwise only runs via scripts/enrich-*.mjs from a dev session.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { companyId } = await request.json();
  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .select("id, name, strasse, plz, ort, branche_name")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }

  try {
    const placesResult = await resolvePlaceForCompany(admin, company, process.env.GOOGLE_PLACES_API_KEY!);
    const placesWebsite = (placesResult.record as { places_website?: string | null }).places_website;

    let websiteResult = null;
    if (placesResult.status === "resolved" && placesWebsite) {
      try {
        websiteResult = await fetchWebsiteForCompany(admin, companyId);
      } catch (err) {
        websiteResult = { fetched: false, error: (err as Error).message };
      }
    }

    let analysisResult = null;
    if (placesResult.status === "resolved") {
      const anthropic = new Anthropic();
      analysisResult = await analyzeCompanyEnrichment(admin, anthropic, companyId);
    }

    return NextResponse.json({ places: placesResult, website: websiteResult, analysis: analysisResult });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
