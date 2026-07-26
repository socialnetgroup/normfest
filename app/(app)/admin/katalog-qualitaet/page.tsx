import { notFound } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// 2026-07-26 audit suggestion: a quick data-quality overview across the
// 11,909-product catalog so gaps (missing photo/description/season/category)
// are visible at a glance instead of needing an ad-hoc script each time.
// Read-only - nothing here fixes anything, it just surfaces the real state.
export default async function KatalogQualitaetPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const [
    { count: total },
    { count: withOwnPhoto },
    { count: withRepresentativePhoto },
    { count: withRealDescription },
    { count: withGeneratedDescription },
    { count: withSeason },
    { count: withCategory },
    { count: catalogPdfCount },
    { count: webshopCount },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .not("image_path", "is", null)
      .eq("image_is_representative", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .not("image_path", "is", null)
      .eq("image_is_representative", true),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .not("description", "is", null)
      .eq("description_is_generated", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .not("description", "is", null)
      .eq("description_is_generated", true),
    supabase.from("products").select("id", { count: "exact", head: true }).not("season", "is", null),
    supabase.from("products").select("id", { count: "exact", head: true }).not("category_code", "is", null),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("source", "catalog_pdf"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("source", "webshop"),
  ]);

  const n = total ?? 0;
  const pct = (count: number | null) => (n === 0 ? "0%" : `${Math.round(((count ?? 0) / n) * 100)}%`);
  const withAnyPhoto = (withOwnPhoto ?? 0) + (withRepresentativePhoto ?? 0);
  const withAnyDescription = (withRealDescription ?? 0) + (withGeneratedDescription ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Katalog-Qualität</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Datenvollständigkeit über alle {n.toLocaleString("de-DE")} Produkte ({(catalogPdfCount ?? 0).toLocaleString("de-DE")}{" "}
          aus PDF-Katalog, {(webshopCount ?? 0).toLocaleString("de-DE")} aus Webshop-Import).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Foto vorhanden (${pct(withAnyPhoto)})`}
          value={`${withAnyPhoto.toLocaleString("de-DE")} / ${n.toLocaleString("de-DE")}`}
          accent={withAnyPhoto === n ? "success" : withAnyPhoto / (n || 1) > 0.9 ? "success" : "warning"}
        />
        <StatTile
          label={`Beschreibung vorhanden (${pct(withAnyDescription)})`}
          value={`${withAnyDescription.toLocaleString("de-DE")} / ${n.toLocaleString("de-DE")}`}
          accent={withAnyDescription / (n || 1) > 0.9 ? "success" : "warning"}
        />
        <StatTile
          label={`Saison hinterlegt (${pct(withSeason)})`}
          value={`${(withSeason ?? 0).toLocaleString("de-DE")} / ${n.toLocaleString("de-DE")}`}
          accent="secondary"
        />
        <StatTile
          label={`Kategorie zugeordnet (${pct(withCategory)})`}
          value={`${(withCategory ?? 0).toLocaleString("de-DE")} / ${n.toLocaleString("de-DE")}`}
          accent={(withCategory ?? 0) / (n || 1) > 0.95 ? "success" : "warning"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Details
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between border-b pb-2">
            <span>Foto - eigenes (PDF/Webshop-Match)</span>
            <span className="font-medium tabular-nums">{(withOwnPhoto ?? 0).toLocaleString("de-DE")}</span>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Foto - Beispielbild (geliehen)</span>
            <span className="font-medium tabular-nums">{(withRepresentativePhoto ?? 0).toLocaleString("de-DE")}</span>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Foto - keins vorhanden</span>
            <span className="font-medium tabular-nums">{(n - withAnyPhoto).toLocaleString("de-DE")}</span>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Beschreibung - echt (Katalog/Webshop)</span>
            <span className="font-medium tabular-nums">{(withRealDescription ?? 0).toLocaleString("de-DE")}</span>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Beschreibung - KI-generiert</span>
            <span className="font-medium tabular-nums">{(withGeneratedDescription ?? 0).toLocaleString("de-DE")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Beschreibung - keine vorhanden</span>
            <span className="font-medium tabular-nums">{(n - withAnyDescription).toLocaleString("de-DE")}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
