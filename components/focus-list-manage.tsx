"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export function FocusListManage({ listId, name }: { listId: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    setPending(true);
    const supabase = createClient();
    await supabase.from("focus_lists").update({ name: trimmed }).eq("id", listId);
    setPending(false);
    setEditing(false);
    router.refresh();
  }

  async function deleteList() {
    if (!confirm(`Fokusliste "${name}" wirklich löschen? Das entfernt auch alle Firmen/Produkte in dieser Liste.`))
      return;
    setPending(true);
    const supabase = createClient();
    await supabase.from("focus_lists").delete().eq("id", listId);
    setPending(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-56 text-sm"
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
            setValue(name);
          }}
          disabled={pending}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon-xs" variant="ghost" onClick={() => setEditing(true)} aria-label="Umbenennen">
        <Pencil className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={deleteList}
        disabled={pending}
        aria-label="Liste löschen"
        className="hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
