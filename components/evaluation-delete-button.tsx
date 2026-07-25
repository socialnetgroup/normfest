"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Bewertung für ${agentName} wirklich löschen?`)) return;
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
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      onClick={remove}
      disabled={pending}
      aria-label="Bewertung löschen"
      className="hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
