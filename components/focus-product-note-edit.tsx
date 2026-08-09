"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// Anis (2026-08-09): "ich muss irgendwo, vor dem erstellen des flyers, die
// moglichkeit haben, preise einzufugen/oder wegzulassen" - the flyer
// generator extracts its big price display from this same `note` string
// (regex over "X,XX €"), so editing it here directly controls what price
// (if any) shows on the next-generated flyer. Clearing the field to empty
// omits the price entirely - extractPrice() just returns null and the
// price/divider section is skipped for that card.
export function FocusProductNoteEdit({ id, note }: { id: string; note: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = value.trim();
    setPending(true);
    const supabase = createClient();
    await supabase
      .from("focus_list_products")
      .update({ note: trimmed || null })
      .eq("id", id);
    setPending(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="z.B. 9,99 €/Stk."
          className="h-7 w-52 text-sm"
          disabled={pending}
          autoFocus
        />
        <Button type="button" size="icon-xs" variant="ghost" onClick={save} disabled={pending}>
          <Check className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setValue(note ?? "");
          }}
          disabled={pending}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-0.5 inline-flex items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground"
    >
      {note ? note : <span className="italic">Kein Preis/Notiz - klicken zum Hinzufügen</span>}
      <Pencil className="size-3 shrink-0 opacity-60" />
    </button>
  );
}
