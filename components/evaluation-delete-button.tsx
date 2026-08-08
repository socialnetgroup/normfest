"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmButton } from "@/components/confirm-button";
import { createClient } from "@/lib/supabase/client";

export function EvaluationDeleteButton({
  id,
  agentName,
  redirectTo,
}: {
  id: string;
  agentName: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("agent_evaluations").delete().eq("id", id);
    setPending(false);
    if (redirectTo) {
      router.push(redirectTo);
    }
    router.refresh();
  }

  return (
    <ConfirmButton
      size="icon-xs"
      variant="ghost"
      onConfirm={remove}
      disabled={pending}
      aria-label={`Bewertung für ${agentName} löschen (zweimal klicken zum Bestätigen)`}
      className="hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-3.5" />
    </ConfirmButton>
  );
}
