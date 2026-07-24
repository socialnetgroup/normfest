"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Threshold = { team_revenue: number; bonus_km: number };

export function BonusRulesForm({
  thresholds: initialThresholds,
  minContributionPct: initialMinContributionPct,
  minQualifyingAgents: initialMinQualifyingAgents,
}: {
  thresholds: Threshold[];
  minContributionPct: number;
  minQualifyingAgents: number;
}) {
  const router = useRouter();
  const [thresholds, setThresholds] = useState<Threshold[]>(initialThresholds);
  const [minContributionPct, setMinContributionPct] = useState(String(initialMinContributionPct));
  const [minQualifyingAgents, setMinQualifyingAgents] = useState(String(initialMinQualifyingAgents));
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateThreshold(index: number, field: keyof Threshold, value: string) {
    const num = Number(value);
    setThresholds((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: num } : t)));
  }

  function removeThreshold(index: number) {
    setThresholds((prev) => prev.filter((_, i) => i !== index));
  }

  function addThreshold() {
    setThresholds((prev) => [...prev, { team_revenue: 0, bonus_km: 0 }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const cleanThresholds = [...thresholds].sort((a, b) => a.team_revenue - b.team_revenue);
    const pct = Number(minContributionPct);
    const qualifiers = Number(minQualifyingAgents);

    if (cleanThresholds.some((t) => !Number.isFinite(t.team_revenue) || t.team_revenue <= 0 || !Number.isFinite(t.bonus_km) || t.bonus_km < 0)) {
      setStatus("error");
      setErrorMessage("Alle Umsatz-Stufen brauchen einen positiven Umsatzwert und ein Bonus-KM ≥ 0.");
      return;
    }
    const uniqueRevenues = new Set(cleanThresholds.map((t) => t.team_revenue));
    if (uniqueRevenues.size !== cleanThresholds.length) {
      setStatus("error");
      setErrorMessage("Zwei Stufen haben denselben Umsatzwert - bitte eindeutig machen.");
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setStatus("error");
      setErrorMessage("Mindest-Beitrag muss zwischen 0 und 100 % liegen.");
      return;
    }
    if (!Number.isInteger(qualifiers) || qualifiers < 1) {
      setStatus("error");
      setErrorMessage("Mindestanzahl qualifizierter Agenten muss eine ganze Zahl ≥ 1 sein.");
      return;
    }

    setStatus("saving");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("settings").upsert(
      [
        { key: "bonus_thresholds", value: cleanThresholds, updated_by: user?.id },
        { key: "bonus_min_contribution_pct", value: pct, updated_by: user?.id },
        { key: "bonus_min_qualifying_agents", value: qualifiers, updated_by: user?.id },
      ],
      { onConflict: "key" },
    );

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setThresholds(cleanThresholds);
    setStatus("done");
    router.refresh();
    setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <Label className="mb-2 block">Umsatz-Stufen (Team, pro Tag)</Label>
        <div className="flex flex-col gap-2">
          {thresholds.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={t.team_revenue}
                  onChange={(e) => updateThreshold(i, "team_revenue", e.target.value)}
                  aria-label="Team-Umsatz (€)"
                />
                <span className="text-sm text-muted-foreground">€ →</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={t.bonus_km}
                  onChange={(e) => updateThreshold(i, "bonus_km", e.target.value)}
                  aria-label="Bonus (KM)"
                />
                <span className="text-sm text-muted-foreground">KM</span>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeThreshold(i)} aria-label="Stufe entfernen">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addThreshold}>
          <Plus className="size-3.5" />
          Stufe hinzufügen
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="min-contribution">Mindest-Beitrag pro Agent (%)</Label>
          <Input
            id="min-contribution"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={minContributionPct}
            onChange={(e) => setMinContributionPct(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="min-qualifiers">Mindestanzahl qualifizierter Agenten</Label>
          <Input
            id="min-qualifiers"
            type="number"
            min="1"
            step="1"
            value={minQualifyingAgents}
            onChange={(e) => setMinQualifyingAgents(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Speichern..." : "Regeln speichern"}
        </Button>
        {status === "done" ? (
          <span className="text-sm text-primary" role="status">
            Gespeichert - gilt ab sofort für alle Berechnungen.
          </span>
        ) : null}
        {status === "error" && errorMessage ? (
          <span className="text-sm text-destructive" role="alert">
            {errorMessage}
          </span>
        ) : null}
      </div>
    </form>
  );
}
