"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function FocusListActivateButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function activate() {
    setPending(true);
    const supabase = createClient();
    // idx_focus_lists_single_active enforces only one active row -- deactivate the
    // rest first so the update below doesn't hit the unique constraint.
    await supabase.from("focus_lists").update({ active: false }).eq("active", true);
    await supabase.from("focus_lists").update({ active: true }).eq("id", listId);
    setPending(false);
    router.refresh();
  }

  return (
    <Button type="button" size="xs" variant="outline" onClick={activate} disabled={pending}>
      {pending ? "..." : "Aktivieren"}
    </Button>
  );
}
