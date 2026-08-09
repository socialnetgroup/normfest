import { NextResponse } from "next/server";

import { generateFocusListFlyer } from "@/lib/flyer/generate-focus-flyer.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Fokus flyer generator (2026-08-09) - admin-triggered, same auth shape as
// /api/admin/vis-import: session-gated via the user's own SSR client, then
// the actual generation + storage write runs under the service-role client
// (reads every product/image in the list regardless of RLS, same as the
// VIS import's "a full refresh legitimately touches rows RLS isn't meant to
// gate for admins" reasoning). Image downloads (one Storage round-trip per
// unique product photo) can make a large list take a while - bumped from 60s
// (2026-08-09, AI hero/category art): real gpt-image-1.5 calls for a hero +
// up to ~8 category accents run partly in parallel but can still take
// 30-90s total, especially with a Tier 1 OpenAI rate-limit retry.
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const admin = createAdminClient();
  let pdfBuffer;
  try {
    pdfBuffer = await generateFocusListFlyer(admin, id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const path = `generated/${id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from("focus-list-files")
    .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { error: updateErr } = await admin.from("focus_lists").update({ pdf_path: path }).eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ path, bytes: pdfBuffer.length });
}
