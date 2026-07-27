import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnthropicClient, getModel } from "@/lib/ai/provider.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const reportRequestSchema = z.object({ agentId: z.string().uuid() });

// "Sistem kontrolinga" pilot (2026-07-27, Alan Sacic): a periodic AI-narrated
// controlling report over real data that already exists - agent_daily_performance
// (Team Dashboard imports) and agent_evaluations (QA-Bewertungen scores).
// Deliberately does NOT touch sales_feedback: agents don't have profile
// (login) accounts yet (§4.11), so there is no real per-agent feedback data
// to draw from for this pilot - the report says so honestly instead of
// silently showing zero. Admin-only, same as the other admin-triggered AI
// features (/api/enrich). Cheap tier (bulk/Haiku) per §3.2.9 - benchmark
// cheap first, upgrade only on measured failure - since the input here is
// already clean structured numbers, not messy text needing quote-fidelity
// reasoning the way enrichment ANALYZE does.
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = reportRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "agentId (uuid) required" }, { status: 400 });
  }
  const { agentId } = parsed.data;

  const admin = createAdminClient();

  const { data: agent } = await admin.from("agents").select("id, full_name, gebiet").eq("id", agentId).single();
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 30);
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const periodEndStr = periodEnd.toISOString().slice(0, 10);

  const [{ data: perfRows }, { data: evalRows }] = await Promise.all([
    admin
      .from("agent_daily_performance")
      .select("date, revenue, sales_count, calls_count, conversion_rate, day_off")
      .eq("agent_id", agentId)
      .gte("date", periodStartStr)
      .lte("date", periodEndStr)
      .order("date"),
    admin
      .from("agent_evaluations")
      .select("call_date, f1_score, f2_score, f3_score, f4_score, f5_score, total_score, comment")
      .eq("agent_id", agentId)
      .order("call_date", { ascending: false })
      .limit(10),
  ]);

  const worked = (perfRows ?? []).filter((r) => !r.day_off);
  const daysWorked = worked.length;
  const totalRevenue = worked.reduce((sum, r) => sum + r.revenue, 0);
  const totalSales = worked.reduce((sum, r) => sum + r.sales_count, 0);
  const totalCalls = worked.reduce((sum, r) => sum + (r.calls_count ?? 0), 0);
  const conversionRate = totalCalls > 0 ? totalSales / totalCalls : null;
  const evalAvg =
    evalRows && evalRows.length > 0
      ? evalRows.reduce((sum, e) => sum + e.total_score, 0) / evalRows.length
      : null;

  const statsSnapshot = {
    period_start: periodStartStr,
    period_end: periodEndStr,
    days_worked: daysWorked,
    total_revenue: totalRevenue,
    total_sales: totalSales,
    total_calls: totalCalls,
    conversion_rate: conversionRate,
    qa_evaluations_count: evalRows?.length ?? 0,
    qa_evaluations_avg_score: evalAvg,
    qa_evaluations: evalRows ?? [],
    note: "sales_feedback nicht enthalten - Agent hat noch kein Login-Konto (profiles), daher keine echten Feedback-Daten für diesen Piloten.",
  };

  const prompt = `Du bist ein Sales-Coaching-Assistent für ein Kfz-Verbrauchsmaterial-Telesales-Team. Erstelle einen kurzen Kontrolling-Bericht (Bosnisch, 4-6 Sätze) für den Agenten "${agent.full_name}" (Gebiet ${agent.gebiet}) für den Zeitraum ${periodStartStr} bis ${periodEndStr}.

WICHTIG: Nutze AUSSCHLIESSLICH die unten gegebenen echten Zahlen. Erfinde nichts. Wenn eine Zahl fehlt oder null ist, sag das ehrlich statt zu raten.

Echte Daten:
- Gearbeitete Tage: ${daysWorked}
- Umsatz gesamt: ${totalRevenue.toFixed(2)} KM
- Verkäufe gesamt: ${totalSales}
- Anrufe gesamt: ${totalCalls || "nicht erfasst"}
- Conversion Rate: ${conversionRate !== null ? (conversionRate * 100).toFixed(1) + "%" : "nicht berechenbar (keine Anrufdaten)"}
- QA-Bewertungen (letzte ${evalRows?.length ?? 0}): ${
    evalAvg !== null ? `Durchschnitt ${evalAvg.toFixed(1)}/10` : "keine Bewertungen vorhanden"
  }
- Hinweis: Feedback-Erfassung (sales_feedback) ist für diesen Agenten noch nicht verfügbar, da er noch kein Login-Konto im Tool hat - das ist ein bekannter Piloten-Status, keine Lücke.

Struktur: kurzer Überblick über die Zahlen, dann 1-2 konkrete, konstruktive Beobachtungen falls die Daten das hergeben, sonst ehrlich sagen dass die Datenbasis noch zu dünn für eine Einschätzung ist.`;

  const anthropic = getAnthropicClient();
  let summary: string;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const response = await anthropic.messages.create({
      model: getModel("bulk"),
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    summary = textBlock && "text" in textBlock ? textBlock.text : "";
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    if (!summary) throw new Error("empty response");
  } catch (err) {
    return NextResponse.json(
      { error: `AI-Bericht fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const { data: inserted, error: insertErr } = await admin
    .from("agent_ai_reports")
    .insert({
      agent_id: agentId,
      generated_by: user.id,
      period_start: periodStartStr,
      period_end: periodEndStr,
      summary,
      stats_snapshot: statsSnapshot,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    })
    .select()
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ report: inserted });
}
