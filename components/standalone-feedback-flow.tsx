"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { FeedbackForm } from "@/components/feedback-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type CompanyOption = { id: string; name: string; kundennummer: string; ort: string | null };

export function StandaloneFeedbackFlow({ agentId }: { agentId: string }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<CompanyOption | null>(null);

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("companies")
      .select("id, name, kundennummer, ort")
      .or(`name.ilike.%${q}%,kundennummer.ilike.%${q}%`)
      .order("name")
      .limit(8);
    setOptions(data ?? []);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={selected ? `${selected.name} (${selected.kundennummer})` : query}
          onChange={(e) => search(e.target.value)}
          placeholder="Firma suchen — Name oder Kundennummer..."
          autoFocus
          className="h-10 pl-8 text-base"
        />
      </div>

      {options.length > 0 && !selected ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {options.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setSelected(c);
                  setOptions([]);
                }}
              >
                <span className="font-medium">{c.name}</span>{" "}
                <span className="text-muted-foreground">
                  {c.kundennummer} · {c.ort}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>Feedback für {selected.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <FeedbackForm companyId={selected.id} agentId={agentId} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
