"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";

export function DateJumpPicker({ date, max }: { date: string; max: string }) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted">
      <CalendarDays className="size-3.5 shrink-0" />
      <Input
        type="date"
        value={date}
        max={max}
        onChange={(e) => {
          if (e.target.value) router.push(`/admin/team/tag/${e.target.value}`);
        }}
        className="h-auto w-auto border-0 p-0 text-sm focus-visible:ring-0"
        aria-label="Zu Datum springen"
      />
    </label>
  );
}
