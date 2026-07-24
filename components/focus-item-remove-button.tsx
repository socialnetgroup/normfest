"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

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
    if (!confirm("Diesen Eintrag aus der Fokusliste entfernen?")) return;
    setPending(true);
    const supabase = createClient();
    await supabase.from(table).delete().eq("id", id);
    setPending(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      aria-label="Entfernen"
      className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
    >
      <X className="size-3.5" />
    </button>
  );
}
