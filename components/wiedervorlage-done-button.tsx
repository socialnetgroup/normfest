"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function WiedervorlageDoneButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function markDone() {
    setPending(true);
    const supabase = createClient();
    await supabase.rpc("fn_set_wiedervorlage_done", { p_id: id, p_done: true });
    setPending(false);
    router.refresh();
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={markDone} disabled={pending}>
      {pending ? "..." : "Erledigt"}
    </Button>
  );
}
