"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const INTERVAL_MS = 30_000;

/** Pings fn_heartbeat() on mount, on every route change, and every 30s while
 * the tab stays open - own row only (security definer RPC scoped to
 * auth.uid()), no admin gate needed since it's a self-write. Real scope is
 * "which screen is this agent on right now", not full activity surveillance -
 * see CLAUDE.md discussion 2026-07-30. */
export function HeartbeatPing() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.rpc("fn_heartbeat", { p_path: pathname });
    };
    ping();
    const id = setInterval(ping, INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [pathname]);

  return null;
}
