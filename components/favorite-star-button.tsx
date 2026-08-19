"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/** Favoritenliste star toggle (2026-08-19, Anis: "Could we make an
 * Favoritenliste... star them"). Optimistic: flips the icon immediately,
 * then syncs company_favorites in the background - same real interaction
 * shape as SignalDismissButton, just insert/delete instead of one RPC.
 * Never fails silently into a stuck state: a failed write reverts the
 * optimistic flip. */
export function FavoriteStarButton({
  companyId,
  agentId,
  initialFavorited,
}: {
  companyId: string;
  agentId: string;
  initialFavorited: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);

  async function toggle() {
    const next = !favorited;
    setFavorited(next);
    setPending(true);
    const supabase = createClient();
    const { error } = next
      ? await supabase.from("company_favorites").insert({ agent_id: agentId, company_id: companyId })
      : await supabase.from("company_favorites").delete().eq("agent_id", agentId).eq("company_id", companyId);
    if (error) setFavorited(!next);
    else router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      disabled={pending}
      aria-label={favorited ? "Von Favoritenliste entfernen" : "Zur Favoritenliste hinzufügen"}
      title={favorited ? "Von Favoritenliste entfernen" : "Zur Favoritenliste hinzufügen"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full p-1.5 transition-colors disabled:opacity-50",
        // Anis (2026-08-19): text-warning-text read as "too dark/bronze" -
        // a genuine gold sits between --warning (too pale to read, the
        // original bug) and --warning-text (tuned dark for table text, not
        // an icon fill). A one-off arbitrary value here rather than a new
        // shared token, since this is this button's own taste call, not a
        // reusable semantic color.
        favorited
          ? "text-[oklch(0.72_0.16_78)] hover:bg-warning/15"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", favorited && "fill-current")} />
    </button>
  );
}
