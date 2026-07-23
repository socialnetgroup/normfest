"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { placeToRecord } from "@/lib/enrichment/places.mjs";

type Candidate = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
};

export function AmbiguousCandidatePicker({
  companyId,
  candidates,
}: {
  companyId: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
          <div className="min-w-0">
            <span className="font-medium">{c.displayName?.text ?? "(ohne Namen)"}</span>{" "}
            <span className="text-muted-foreground">{c.formattedAddress}</span>
            {c.rating !== undefined ? (
              <span className="text-muted-foreground"> · {c.rating}/5 ({c.userRatingCount ?? 0})</span>
            ) : null}
          </div>
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
      ))}
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
    </div>
  );
}
