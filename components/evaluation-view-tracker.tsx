"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/** Marks every currently-unread evaluation as viewed once /bewertungen has
 * rendered them (2026-08-19) - same "open the inbox, it's read" semantics
 * as everywhere else in this app that surfaces a "Neu"/unread state.
 * fn_mark_evaluation_viewed is idempotent (coalesce, first call wins), so
 * firing it again on a re-mount is harmless. The sidebar's unread badge
 * picks up the change on the next navigation (its own server-rendered
 * count), not instantly on this page - deliberate, avoids a jumpy in-page
 * badge flip while the agent is still reading. */
export function EvaluationViewTracker({ unreadIds }: { unreadIds: string[] }) {
  useEffect(() => {
    if (unreadIds.length === 0) return;
    const supabase = createClient();
    for (const id of unreadIds) {
      supabase.rpc("fn_mark_evaluation_viewed", { p_id: id }).then(({ error }) => {
        if (error) console.error("[bewertungen] fn_mark_evaluation_viewed failed:", error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadIds.join(",")]);

  return null;
}
