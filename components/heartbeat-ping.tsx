"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const INTERVAL_MS = 30_000;

/** Pings fn_heartbeat() on mount, on every route change, on window/tab
 * refocus, and every 30s while the page is open - own row only (security
 * definer RPC scoped to auth.uid()), no admin gate needed since it's a
 * self-write. Real scope is "which screen is this agent on right now", not
 * full activity surveillance - see CLAUDE.md discussion 2026-07-30.
 *
 * Hardened 2026-08-14 after a real investigation found nearly every agent's
 * status stuck (8 of 10 had NEVER recorded a single heartbeat, 2 were stuck
 * at their very first-ever ping from weeks earlier) despite clearly using
 * the app daily. Root-caused live: the RPC and the effect both work
 * correctly - proven directly, a forced document.visibilityState="visible"
 * dispatch produced a real successful call (status 204). The scheduled
 * ping was previously gated on `document.visibilityState === "visible"`,
 * which only reflects whether THIS tab is the frontmost tab in a
 * non-minimized browser window - real agents constantly alt-tab to other
 * tools (the ViciDial dialer, Speedy CRM, email), so the tab spends a lot
 * of real time backgrounded, and every scheduled tick landing during that
 * window was silently skipped rather than just deferred. The interval ping
 * no longer checks visibility at all - it's a single cheap RPC call, not
 * expensive polling, so there's no real cost to sending it from a
 * backgrounded tab, and "tool still open" is a reasonable enough signal on
 * its own. Kept + added redundant immediate-ping triggers (visibilitychange
 * AND window focus) so returning to the tab refreshes status without
 * waiting up to 30s. Errors are now logged instead of silently swallowed
 * (the previous bare `void supabase.rpc(...)` made this exact class of bug
 * invisible - a real failure would never have surfaced). */
export function HeartbeatPing() {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const ping = () => {
      supabase
        .rpc("fn_heartbeat", { p_path: pathname })
        .then(({ error }) => {
          if (error) console.error("[heartbeat] fn_heartbeat failed:", error);
        });
    };
    ping();
    const id = setInterval(ping, INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);
    window.addEventListener("focus", ping);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
      window.removeEventListener("focus", ping);
    };
  }, [pathname]);

  return null;
}
