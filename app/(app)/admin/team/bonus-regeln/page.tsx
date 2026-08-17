import Link from "next/link";
import { notFound } from "next/navigation";

import { BonusRulesForm } from "@/components/team/bonus-rules-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type BonusThreshold } from "@/lib/team/bonus";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function BonusRegelnPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["bonus_thresholds", "bonus_min_contribution_pct", "bonus_min_qualifying_agents", "bonus_visible"]);

  const settingsMap: Record<string, unknown> = {};
  for (const row of settingsRows ?? []) settingsMap[row.key] = row.value;

  const thresholds = (settingsMap.bonus_thresholds as BonusThreshold[] | undefined) ?? [];
  const minContributionPct = Number(settingsMap.bonus_min_contribution_pct ?? 5);
  const minQualifyingAgents = Number(settingsMap.bonus_min_qualifying_agents ?? 7);
  const bonusVisible = settingsMap.bonus_visible === true;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/team" className="text-sm text-muted-foreground hover:underline">
          ← Team Dashboard
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">Bonus-Regeln</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Steuert den täglichen Team-Bonus (§14) - Umsatz-Stufen, Mindest-Beitrag pro Agent und
          Mindestanzahl qualifizierter Agenten. Änderungen gelten sofort für alle künftigen Berechnungen
          (Dashboard, Team Dashboard, Tagesansicht) - kein Code-Deploy nötig.
        </p>
        {!bonusVisible ? (
          <p className="mt-2 text-sm text-warning-foreground">
            Bonus-Anzeige ist derzeit im Tool ausgeblendet - die Berechnung läuft im Hintergrund weiter.
            Zum Reaktivieren unten den Haken setzen und speichern.
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regeln bearbeiten</CardTitle>
        </CardHeader>
        <CardContent>
          <BonusRulesForm
            thresholds={thresholds}
            minContributionPct={minContributionPct}
            minQualifyingAgents={minQualifyingAgents}
            bonusVisible={bonusVisible}
          />
        </CardContent>
      </Card>
    </div>
  );
}
