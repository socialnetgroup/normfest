"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { expectedHoursForDate, NOTE_PRESETS } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const hoursFmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export type AttendanceDay = {
  date: string;
  hoursWorked: number;
  lostHours: number;
  note: string | null;
};

function dayStatusClass(expected: number, entry: AttendanceDay | undefined) {
  if (expected === 0) return "bg-muted/10 text-muted-foreground/50"; // weekend
  if (!entry || entry.hoursWorked === 0) return "bg-destructive/10 text-destructive";
  if (entry.hoursWorked < expected) return "bg-warning/15 text-warning-foreground";
  return "bg-success/15 text-success-foreground";
}

/** One agent's monthly attendance grid + inline day editor (Anwesenheit,
 * CLAUDE.md §14) - modeled on components/team/month-calendar.tsx's
 * calendar-grid/day-detail shape, but editable since attendance is TL-typed
 * directly rather than imported from an Excel export. */
export function AttendanceMonthCalendar({ agentId, month, days }: { agentId: string; month: string; days: AttendanceDay[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formHours, setFormHours] = useState("");
  const [formLost, setFormLost] = useState("");
  const [formNote, setFormNote] = useState("");

  const byDate = new Map(days.map((d) => [d.date, d]));
  const [year, m] = month.split("-").map(Number);
  const firstOfMonth = new Date(year, m - 1, 1);
  const daysInMonth = new Date(year, m, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;

  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  function selectDay(date: string) {
    if (date === selected) {
      setSelected(null);
      return;
    }
    setSelected(date);
    setErrorMessage(null);
    const entry = byDate.get(date);
    setFormHours(entry ? String(entry.hoursWorked) : String(expectedHoursForDate(date)));
    setFormLost(entry?.lostHours ? String(entry.lostHours) : "");
    setFormNote(entry?.note ?? "");
  }

  async function save() {
    if (!selected) return;
    setPending(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("agent_attendance").upsert(
      {
        agent_id: agentId,
        date: selected,
        hours_worked: formHours ? Number(formHours) : 0,
        lost_hours: formLost ? Number(formLost) : 0,
        note: formNote || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,date" },
    );
    setPending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.refresh();
  }

  const selectedExpected = selected ? expectedHoursForDate(selected) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) =>
          date === null ? (
            <div key={`blank-${i}`} />
          ) : (
            <button
              key={date}
              type="button"
              onClick={() => selectDay(date)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md border text-xs transition-colors",
                date === selected ? "border-primary ring-1 ring-primary" : "border-transparent hover:border-border",
                dayStatusClass(expectedHoursForDate(date), byDate.get(date)),
              )}
            >
              <span className="tabular-nums">{Number(date.slice(-2))}</span>
              {byDate.get(date)?.hoursWorked ? (
                <span className="tabular-nums">{hoursFmt.format(byDate.get(date)!.hoursWorked)}</span>
              ) : null}
            </button>
          ),
        )}
      </div>

      {selected ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="font-medium tabular-nums">{dateFmt.format(new Date(`${selected}T00:00:00Z`))}</span>
            <span className="text-xs text-muted-foreground">
              Soll: {selectedExpected > 0 ? `${hoursFmt.format(selectedExpected)} h` : "kein Arbeitstag"}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="hours-worked">Odrađeno (h)</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="hours-worked"
                  type="number"
                  min="0"
                  step="0.5"
                  value={formHours}
                  onChange={(e) => setFormHours(e.target.value)}
                  className="w-24"
                />
                <Button type="button" size="xs" variant="outline" onClick={() => setFormHours("8")}>
                  8h
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={() => setFormHours("7")}>
                  7h
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={() => setFormHours("0")}>
                  0h
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lost-hours">Nachzuholen (h)</Label>
              <Input
                id="lost-hours"
                type="number"
                min="0"
                step="0.5"
                value={formLost}
                onChange={(e) => setFormLost(e.target.value)}
                placeholder="0"
                className="w-24"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notiz</Label>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_PRESETS.map((n) => (
                <button type="button" key={n} onClick={() => setFormNote(n)}>
                  <Badge variant={formNote === n ? "default" : "secondary"}>{n}</Badge>
                </button>
              ))}
            </div>
            <Input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="z.B. Kasnio 2h, Arzttermin..."
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? "Speichern..." : "Speichern"}
            </Button>
            {errorMessage ? (
              <span className="text-sm text-destructive" role="alert">
                {errorMessage}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
