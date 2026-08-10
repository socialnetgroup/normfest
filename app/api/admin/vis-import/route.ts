import { NextResponse } from "next/server";

import { parseVisWorkbook, writeCompanies, softDeleteMissingCompanies } from "@/lib/vis-import/core.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// §14 item 9 — self-serve VIS-list re-import. Admin-only, same shape as the
// existing /api/enrich route: session-gated via the user's own SSR client,
// then the actual read/write runs under the service-role client (bypasses
// RLS, same as scripts/import-vis.mjs — a full VIS refresh legitimately
// touches every company row, not something RLS is meant to gate for admins).
// Large uploads (the real file is ~4MB) can take a while to upsert in
// batches of 1000 — give it room on platforms that support longer functions.
export const maxDuration = 300;

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file (VIS-Liste .xlsx) required" }, { status: 400 });
  }

  let records, skipped;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    ({ records, skipped } = parseVisWorkbook(buffer));
  } catch (err) {
    return NextResponse.json({ error: `Datei konnte nicht gelesen werden: ${(err as Error).message}` }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json(
      { error: "Keine gültigen Zeilen gefunden — falsches Format oder falsche Datei?" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  try {
    const written = await writeCompanies(admin, records);
    // Soft-delete companies missing from this fresh export (2026-08-10) -
    // VIS is the source of truth, and a company simply being absent from a
    // fresh file (e.g. an agent asked Normfest to remove it - "not
    // interested"/"closed") is the only real removal signal VIS gives us.
    // Never a hard delete - see softDeleteMissingCompanies' own comment.
    const presentKundennummern = new Set(records.map((r) => r.kundennummer));
    const softDeleted = await softDeleteMissingCompanies(admin, presentKundennummern);
    return NextResponse.json({
      parsed: records.length,
      written,
      skippedCount: skipped.length,
      skippedSample: skipped.slice(0, 20),
      softDeletedCount: softDeleted.length,
      softDeleted,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
