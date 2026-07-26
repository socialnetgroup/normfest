import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Consolidates every pending-human-decision admin queue into one landing
// page (2026-07-26 audit suggestion) - previously these three lived on
// separate pages with no shared overview, so a queue could go unnoticed.
// Read-only counts only; every action still happens on its own existing
// screen (nothing merges/verifies/dismisses from here).
export default async function ReviewsPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const [{ count: ambiguousCount }, { count: unverifiedBrandCount }, { count: dedupCount }] = await Promise.all([
    supabase
      .from("company_enrichment")
      .select("id", { count: "exact", head: true })
      .eq("places_ambiguous", true),
    supabase
      .from("brand_consumption_profiles")
      .select("id", { count: "exact", head: true })
      .eq("verified", false),
    supabase
      .from("product_duplicate_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const totalOpen = (ambiguousCount ?? 0) + (unverifiedBrandCount ?? 0) + (dedupCount ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Offene Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle wartenden Entscheidungen an einem Ort - jede Karte führt zur eigentlichen Bearbeitungsseite.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Uneindeutige Enrichment-Treffer"
          value={String(ambiguousCount ?? 0)}
          accent={ambiguousCount ? "warning" : "success"}
          href="/admin/enrichment"
        />
        <StatTile
          label="Unbestätigte Marken-Profile"
          value={String(unverifiedBrandCount ?? 0)}
          accent={unverifiedBrandCount ? "warning" : "success"}
          href="/admin/brand-profiles"
        />
        <StatTile
          label="Katalog-Duplikat-Kandidaten"
          value={String(dedupCount ?? 0)}
          accent={dedupCount ? "warning" : "success"}
          href="/admin/katalog-dedup"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            {totalOpen === 0 ? "Alles erledigt" : `${totalOpen} offene Einträge insgesamt`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {totalOpen === 0
              ? "Keine wartenden Reviews - alle drei Queues sind aktuell leer."
              : "Klicke auf eine Kachel oben, um die jeweilige Liste zu öffnen und einzelne Einträge zu bearbeiten."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
