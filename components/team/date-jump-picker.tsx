"use client";

import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";

export function DateJumpPicker({ date, max }: { date: string; max: string }) {
  const router = useRouter();

  return (
    <Input
      type="date"
      value={date}
      max={max}
      onChange={(e) => {
        if (e.target.value) router.push(`/admin/team/tag/${e.target.value}`);
      }}
      className="w-auto"
      aria-label="Zu Datum springen"
    />
  );
}
