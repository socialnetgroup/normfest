import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

import { datesInMonth, expectedHoursForDate, totalExpectedHours } from "@/lib/attendance";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Anwesenheit Excel export - Anis, "Dodaj mogucnosti eksel exporta u
// anwesenheit da se moze poslati nekom dalje ko trazi" (so the TL can hand
// the numbers to whoever asks - Sanin, an agent disputing a Saldo, payroll).
// Two modes off the same route, same admin-gating shape as
// /api/admin/vis-import: ?agentId=<id> exports one agent's full day-by-day
// log across every month they have entries in (closest to the original
// NORMFEST Arbeitszeit.xlsx reference shape); ?month=YYYY-MM (default:
// current month) exports the cross-agent summary table shown on
// /admin/anwesenheit. Built server-side (not a client-side xlsx bundle -
// no prior precedent for that in this app; xlsx has only ever run in Node
// scripts/API routes here) and streamed back as a real .xlsx download.
export async function GET(request: Request) {
  const { user, profile } = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const todayStr = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  if (agentId) {
    const [{ data: agent }, { data: rows, error }] = await Promise.all([
      supabase.from("agents").select("full_name").eq("id", agentId).single(),
      supabase
        .from("agent_attendance")
        .select("date, hours_worked, lost_hours, note")
        .eq("agent_id", agentId)
        .order("date"),
    ]);
    if (!agent) return NextResponse.json({ error: "Agent nicht gefunden" }, { status: 404 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const aoa = [["Datum", "Odrađeno (h)", "Soll (h)", "Nachzuholen (h)", "Notiz"]];
    for (const r of rows ?? []) {
      aoa.push([r.date, String(r.hours_worked), String(expectedHoursForDate(r.date)), String(r.lost_hours), r.note ?? ""]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, ws, "Anwesenheit");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Anwesenheit ${agent.full_name}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const month = searchParams.get("month") ?? todayStr.slice(0, 7);
  const monthDates = datesInMonth(month);
  const expectedTotal = totalExpectedHours(monthDates, todayStr);

  const [{ data: agents }, { data: rows }] = await Promise.all([
    supabase.from("agents").select("id, full_name").eq("active", true).order("full_name"),
    supabase
      .from("agent_attendance")
      .select("agent_id, date, hours_worked, lost_hours, note")
      .gte("date", monthDates[0])
      .lte("date", monthDates[monthDates.length - 1]),
  ]);

  const byAgent = new Map<string, { worked: number; lost: number; urlaubTage: number }>();
  const rowsByAgent = new Map<string, Map<string, { hours_worked: number; lost_hours: number; note: string | null }>>();
  for (const r of rows ?? []) {
    const entry = byAgent.get(r.agent_id) ?? { worked: 0, lost: 0, urlaubTage: 0 };
    entry.worked += r.hours_worked;
    entry.lost += r.lost_hours;
    if (r.note?.toLowerCase().includes("urlaub")) entry.urlaubTage += 1;
    byAgent.set(r.agent_id, entry);

    if (!rowsByAgent.has(r.agent_id)) rowsByAgent.set(r.agent_id, new Map());
    rowsByAgent.get(r.agent_id)!.set(r.date, { hours_worked: r.hours_worked, lost_hours: r.lost_hours, note: r.note });
  }

  const overviewAoa = [["Agent", "Odrađeno (h)", "Soll (h)", "Saldo (h)", "Nachzuholen (h)", "Urlaub-Tage"]];
  for (const a of agents ?? []) {
    const entry = byAgent.get(a.id) ?? { worked: 0, lost: 0, urlaubTage: 0 };
    overviewAoa.push([
      a.full_name,
      String(entry.worked),
      String(expectedTotal),
      String(entry.worked - expectedTotal),
      String(entry.lost),
      String(entry.urlaubTage),
    ]);
  }

  const wb = XLSX.utils.book_new();
  const overviewWs = XLSX.utils.aoa_to_sheet(overviewAoa);
  overviewWs["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, overviewWs, "Übersicht");

  // One sheet per active agent with a real per-day row for every calendar
  // day in the month (not just days with an entry) - Anis: "different
  // additional sheets for each employee to have dailed view too". Sheet
  // names are Excel-limited to 31 chars and can't contain \/?*[] - strip
  // those and truncate; dedupe against a real collision by suffixing a
  // running counter (agent full names could theoretically repeat/truncate
  // to the same string, even though no two real agents share a name today).
  const usedSheetNames = new Set(["Übersicht"]);
  for (const a of agents ?? []) {
    let name = a.full_name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Agent";
    while (usedSheetNames.has(name)) name = `${name.slice(0, 28)} (2)`;
    usedSheetNames.add(name);

    const agentRows = rowsByAgent.get(a.id) ?? new Map();
    const dailyAoa = [["Datum", "Odrađeno (h)", "Soll (h)", "Nachzuholen (h)", "Notiz"]];
    for (const date of monthDates) {
      if (date > todayStr) continue; // don't show future days as 0h deficits
      const entry = agentRows.get(date);
      dailyAoa.push([
        date,
        String(entry?.hours_worked ?? 0),
        String(expectedHoursForDate(date)),
        String(entry?.lost_hours ?? 0),
        entry?.note ?? "",
      ]);
    }
    const dailyWs = XLSX.utils.aoa_to_sheet(dailyAoa);
    dailyWs["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, dailyWs, name);
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Anwesenheit ${month}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
