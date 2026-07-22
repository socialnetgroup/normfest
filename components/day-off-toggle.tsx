"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function DayOffToggle({
  agentId,
  date,
  dayOff,
}: {
  agentId: string;
  date: string;
  dayOff: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_set_day_off", {
      p_agent_id: agentId,
      p_date: date,
      p_off: !dayOff,
    });
    setPending(false);
    if (!error) router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="xs" onClick={toggle} disabled={pending}>
      {dayOff ? "Arbeitet nicht" : "Als frei markieren"}
    </Button>
  );
}
