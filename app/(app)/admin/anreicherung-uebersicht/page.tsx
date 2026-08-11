import { notFound } from "next/navigation";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// 2026-07-27: ranking table by companies enriched per Gebiet/agent - same
// idea as the ad-hoc query shown in chat earlier, now a real admin screen
// instead of a one-off. Same read-only, no-fix-anything shape as
// Katalog-Qualität. Broken into the 3 real pipeline steps (Places resolve ->
// website fetch -> AI analyze) rather than one "enriched" bucket, since each
// has its own completion state - not every company has a website to fetch in
// the first place, so a lower website-fetch count than Places-resolved is
// expected, not a gap. Aggregated via company_gebiet_enrichment_coverage
// (view, avoids the 1000-row PostgREST cap a client-side aggregation over
// all 13.5k companies would hit).
export default async function AnreicherungUebersichtPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();

  const [{ data: agents }, { data: coverageStats }] = await Promise.all([
    supabase.from("agents").select("id, full_name, gebiet").eq("active", true),
    supabase
      .from("company_gebiet_enrichment_coverage")
      .select("gebiet, total, places_resolved, website_fetched, ai_analyzed, ambiguous"),
  ]);

  const byGebiet = new Map<
    string,
    { total: number; placesResolved: number; websiteFetched: number; aiAnalyzed: number; ambiguous: number }
  >();
  for (const row of coverageStats ?? []) {
    if (!row.gebiet) continue;
    byGebiet.set(row.gebiet, {
      total: row.total ?? 0,
      placesResolved: row.places_resolved ?? 0,
      websiteFetched: row.website_fetched ?? 0,
      aiAnalyzed: row.ai_analyzed ?? 0,
      ambiguous: row.ambiguous ?? 0,
    });
  }

  const empty = { total: 0, placesResolved: 0, websiteFetched: 0, aiAnalyzed: 0, ambiguous: 0 };
  const assignedGebiete = new Set((agents ?? []).map((a) => a.gebiet));
  const rows = [
    ...(agents ?? []).map((a) => ({
      label: a.full_name,
      agentId: a.id as string | null,
      ...(byGebiet.get(a.gebiet) ?? empty),
    })),
  ].sort((a, b) => b.placesResolved - a.placesResolved);

  const unassignedTotals = [...byGebiet.entries()]
    .filter(([gebiet]) => !assignedGebiete.has(gebiet))
    .reduce(
      (sum, [, v]) => ({
        total: sum.total + v.total,
        placesResolved: sum.placesResolved + v.placesResolved,
        websiteFetched: sum.websiteFetched + v.websiteFetched,
        aiAnalyzed: sum.aiAnalyzed + v.aiAnalyzed,
        ambiguous: sum.ambiguous + v.ambiguous,
      }),
      empty,
    );
  if (unassignedTotals.total > 0) {
    rows.push({ label: "Nicht zugeordnet", agentId: null, ...unassignedTotals });
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const grandPlaces = rows.reduce((sum, r) => sum + r.placesResolved, 0);
  const grandWebsite = rows.reduce((sum, r) => sum + r.websiteFetched, 0);
  const grandAnalyzed = rows.reduce((sum, r) => sum + r.aiAnalyzed, 0);
  const grandAmbiguous = rows.reduce((sum, r) => sum + r.ambiguous, 0);
  const pctOf = (n: number) => (grandTotal > 0 ? Math.round((n / grandTotal) * 100) : 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Anreicherung-Übersicht</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranking nach angereicherten Firmen je Gebiet/Agent, aufgeschlüsselt nach den 3 echten Pipeline-Schritten.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`1. Places aufgelöst (${pctOf(grandPlaces)}%)`}
          value={`${grandPlaces.toLocaleString("de-DE")} / ${grandTotal.toLocaleString("de-DE")}`}
          accent={pctOf(grandPlaces) >= 20 ? "success" : "secondary"}
        />
        <StatTile
          label={`2. Website abgerufen (${pctOf(grandWebsite)}%)`}
          value={`${grandWebsite.toLocaleString("de-DE")} / ${grandTotal.toLocaleString("de-DE")}`}
          accent="secondary"
        />
        <StatTile
          label={`3. KI-analysiert (${pctOf(grandAnalyzed)}%)`}
          value={`${grandAnalyzed.toLocaleString("de-DE")} / ${grandTotal.toLocaleString("de-DE")}`}
          accent={pctOf(grandAnalyzed) >= 20 ? "success" : "warning"}
        />
        <Link href="/admin/enrichment" className="block">
          <StatTile
            label="Davon unklar (Places-Match)"
            value={grandAmbiguous.toLocaleString("de-DE")}
            accent={grandAmbiguous > 0 ? "warning" : "success"}
          />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Ranking nach angereicherten Firmen
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Sortiert nach Schritt 1 (Places aufgelöst). Website-Abruf ist naturgemäß niedriger, da nicht jede Firma
            eine hinterlegte Website hat - das ist normal, keine Lücke. &quot;Unklar&quot; zählt Firmen mit einem
            noch nicht entschiedenen Places-Match (mehrere Kandidaten) - diese landen in der{" "}
            <Link href="/admin/enrichment" className="underline">
              Enrichment-Warteschlange
            </Link>{" "}
            zur manuellen Prüfung.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Agent</th>
                  <th className="px-2 py-2 font-medium">Firmen gesamt</th>
                  <th className="px-2 py-2 font-medium">1. Places aufgelöst</th>
                  <th className="px-2 py-2 font-medium">2. Website abgerufen</th>
                  <th className="px-2 py-2 font-medium">3. KI-analysiert</th>
                  <th className="px-2 py-2 font-medium">Davon unklar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const pct = row.total > 0 ? row.placesResolved / row.total : 0;
                  return (
                    <tr key={row.label} className={row.label === "Nicht zugeordnet" ? "opacity-60" : undefined}>
                      <td className="px-2 py-2 font-medium">
                        {row.agentId ? (
                          <Link href={`/admin/team/${row.agentId}`} className="hover:underline">
                            {row.label}
                          </Link>
                        ) : (
                          row.label
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{row.total}</td>
                      <td className="px-2 py-2 tabular-nums">
                        <span
                          className={cn(
                            "font-medium",
                            pct >= 0.2 ? "text-success-foreground" : "text-muted-foreground",
                          )}
                        >
                          {row.placesResolved}
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">({Math.round(pct * 100)}%)</span>
                      </td>
                      <td className="px-2 py-2 tabular-nums">{row.websiteFetched}</td>
                      <td className="px-2 py-2 tabular-nums">{row.aiAnalyzed}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {row.ambiguous > 0 ? (
                          <span className="font-medium text-warning-foreground">{row.ambiguous}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
