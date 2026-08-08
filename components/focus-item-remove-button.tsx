"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmButton } from "@/components/confirm-button";
import { createClient } from "@/lib/supabase/client";

export function FocusItemRemoveButton({
  table,
  id,
}: {
  table: "focus_list_items" | "focus_list_products";
  id: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const supabase = createClient();
    await supabase.from(table).delete().eq("id", id);
    setPending(false);
    router.refresh();
  }

  return (
    <ConfirmButton
      size="icon-xs"
      variant="ghost"
      onConfirm={remove}
      disabled={pending}
      aria-label="Entfernen (zweimal klicken zum Bestätigen)"
      className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-3.5" />
    </ConfirmButton>
  );
}
