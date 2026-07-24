"use client";

import { MessageCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChatAssistant } from "@/components/chat-assistant";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const FIRMEN_ID_RE = /^\/firmen\/([0-9a-f-]{36})$/i;

/** Notion-style always-on assistant: a floating bottom-right bubble that
 * expands into the same ChatAssistant used on the full /assistent page, so
 * agents don't have to navigate away to ask a quick question. Auto-detects
 * company context when parked on a /firmen/[id] page, same as the "Im
 * Assistenten fragen" link elsewhere. */
export function FloatingAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<{ id: string; name: string } | null>(null);

  const currentId = useMemo(() => pathname.match(FIRMEN_ID_RE)?.[1] ?? null, [pathname]);
  const companyContext = currentId && fetched?.id === currentId ? fetched : null;

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    createClient()
      .from("companies")
      .select("id, name")
      .eq("id", currentId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setFetched(data);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  if (pathname === "/assistent") return null;

  return (
    <>
      {open ? (
        <div className="fixed right-5 bottom-5 z-50 flex h-[min(640px,calc(100vh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-foreground/10">
          <div className="flex shrink-0 items-center justify-between border-b bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-primary" />
              <span className="font-heading text-sm font-semibold">Assistent</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Schließen"
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ChatAssistant companyContext={companyContext} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Assistent öffnen"
          className={cn(
            "fixed right-5 bottom-5 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
          )}
        >
          <MessageCircle className="size-6" />
        </button>
      )}
    </>
  );
}
