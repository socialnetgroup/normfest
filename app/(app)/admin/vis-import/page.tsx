import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VisImportForm } from "@/components/vis-import-form";
import { createClient } from "@/lib/supabase/server";

// §14 item 9 — self-serve VIS-list re-import, so a weekly refresh doesn't
// need a dev session. Re-runs the exact same mapping/dedup logic as
// scripts/import-vis.mjs (shared via lib/vis-import/core.mjs): upsert on
// kundennummer, invalid rows (missing kundennummer/name/gebiet) skipped and
// reported, never written half-parsed.
export default async function VisImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const { count: companyCount } = await supabase.from("companies").select("id", { count: "exact", head: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">VIS-Liste importieren</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nur für Admins sichtbar. Aktuell {companyCount ?? 0} Firmen in der Datenbank. Beim Hochladen wird
          jede Zeile per Kundennummer abgeglichen — bestehende Firmen werden aktualisiert, neue angelegt,
          nichts wird gelöscht.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Neue Datei hochladen</CardTitle>
        </CardHeader>
        <CardContent>
          <VisImportForm />
        </CardContent>
      </Card>
    </div>
  );
}
