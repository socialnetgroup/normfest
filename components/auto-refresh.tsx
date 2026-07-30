"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Periodically re-fetches this Server Component's data via router.refresh()
 * - no full page reload, no client-side state loss, just re-runs the page's
 * server-side queries. Used on the Dashboard to keep the login-status/
 * heartbeat display in sync without a manual reload. */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
