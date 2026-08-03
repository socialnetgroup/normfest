import { notFound } from "next/navigation";
import { Tags } from "lucide-react";

import { BrandProfileManager } from "@/components/brand-profile-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function BrandProfilesPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const [{ data: rows }, { data: categoryRows }] = await Promise.all([
    supabase
      .from("brand_consumption_profiles")
      .select("id, brand, category, note, weight, verified, source")
      .order("brand")
      .order("category"),
    supabase.from("products").select("category_name").not("category_name", "is", null),
  ]);

  const categories = [...new Set((categoryRows ?? []).map((r) => r.category_name!))].sort();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Marken-Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kuratierte Zuordnung Marke → Produktkategorie mit erhöhtem Verbrauch (steuert das Signal
          brand_profile_match). Vorläufige Einträge stammen aus einer ersten Recherche und sind noch
          nicht von Anis/Armina bestätigt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="size-4 text-primary" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BrandProfileManager rows={rows ?? []} categories={categories} />
        </CardContent>
      </Card>
    </div>
  );
}
