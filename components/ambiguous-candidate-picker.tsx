"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { placeToRecord, mergeCandidates, scoreNameMatch } from "@/lib/enrichment/places.mjs";

const HIGHLIGHT_THRESHOLD = 0.8;

type Review = { rating?: number; text?: { text?: string }; publishTime?: string };
type Candidate = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: Review[];
};

export function AmbiguousCandidatePicker({
  companyId,
  companyName,
  candidates,
}: {
  companyId: string;
  companyName?: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function choose(candidate: Candidate | null) {
    setPending(candidate?.id ?? "none");
    const supabase = createClient();
    const record = candidate
      ? {
          ...placeToRecord(candidate),
          places_ambiguous: false,
          places_candidates: null,
          places_resolved_at: new Date().toISOString(),
        }
      : {
          places_ambiguous: false,
          places_candidates: null,
          places_resolved_at: new Date().toISOString(),
        };
    await supabase.from("company_enrichment").update(record).eq("company_id", companyId);
    setPending(null);
    router.refresh();
  }

  async function mergeSelected() {
    const selected = candidates.filter((c) => checked.has(c.id));
    if (selected.length < 2) return;
    setPending("merge");
    const supabase = createClient();
    await supabase.from("company_enrichment").update(mergeCandidates(selected)).eq("company_id", companyId);
    setPending(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((c) => {
        const score = companyName ? scoreNameMatch(companyName, c.displayName?.text) : 0;
        const highlighted = score >= HIGHLIGHT_THRESHOLD;
        return (
          <div
            key={c.id}
            className={
              "flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm" +
              (highlighted ? " border-success-foreground/40 bg-success/10" : "")
            }
          >
            <label className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
                className="size-4 shrink-0"
                aria-label={`${c.displayName?.text ?? "Kandidat"} für Zusammenführung auswählen`}
              />
              <span className="min-w-0">
                {highlighted ? (
                  <Badge variant="success" className="mr-1.5 align-middle">
                    Name-Match {Math.round(score * 100)}%
                  </Badge>
                ) : null}
                <span className="font-medium">{c.displayName?.text ?? "(ohne Namen)"}</span>{" "}
                <span className="text-muted-foreground">{c.formattedAddress}</span>
                {c.rating !== undefined ? (
                  <span className="text-muted-foreground"> · {c.rating}/5 ({c.userRatingCount ?? 0})</span>
                ) : null}
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              disabled={pending !== null}
              onClick={() => choose(c)}
            >
              {pending === c.id ? "..." : "Auswählen"}
            </Button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-start"
          disabled={pending !== null}
          onClick={() => choose(null)}
        >
          {pending === "none" ? "..." : "Keiner davon (kein Treffer)"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="self-start"
          disabled={pending !== null || checked.size < 2}
          onClick={mergeSelected}
          title="Bewertungen der ausgewählten Treffer zusammenführen - z.B. wenn dieselbe Firma zwei Google-Profile hat (Hauptprofil + Ladestation o.ä.)"
        >
          {pending === "merge" ? "..." : `Ausgewählte zusammenführen (${checked.size})`}
        </Button>
      </div>
    </div>
  );
}
