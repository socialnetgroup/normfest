"use client";

import { Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

// Fokus flyer generator (2026-08-09) - triggers the styled-PDF generation
// (lib/flyer/generate-focus-flyer.mjs) via the admin API route, then
// refreshes so the page picks up the new pdf_path and shows the real
// "Flyer öffnen" link. No confirm-gate needed (regenerating just overwrites
// the same generated/<id>.pdf, not a destructive action on real data).
export function FocusListFlyerGenerateButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/fokus/${listId}/flyer`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fehler beim Erstellen des Flyers");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending} className="w-fit gap-2">
        <Wand2 className="size-4" />
        {pending ? "Flyer wird erstellt…" : "Flyer generieren"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
