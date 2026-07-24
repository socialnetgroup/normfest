"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function RefreshSignalsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function refresh() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_refresh_signals");
    setPending(false);
    if (!error) router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="xs" onClick={refresh} disabled={pending}>
      {pending ? "Aktualisiert..." : "Signale aktualisieren"}
    </Button>
  );
}
