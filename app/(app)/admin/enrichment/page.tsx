import { notFound } from "next/navigation";
import Link from "next/link";

import { AmbiguousCandidatePicker } from "@/components/ambiguous-candidate-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function EnrichmentAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const [{ data: ambiguous }, { count: totalEnriched }, { count: verifiedCount }] = await Promise.all([
    supabase
      .from("company_enrichment")
      .select("id, company_id, places_candidates, companies(id, name, kundennummer, ort, strasse)")
      .eq("places_ambiguous", true),
    supabase.from("company_enrichment").select("id", { count: "exact", head: true }),
    supabase.from("company_enrichment").select("id", { count: "exact", head: true }).eq("verified", true),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Enrichment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalEnriched ?? 0} Firmen angereichert · {verifiedCount ?? 0} Markenfokus-Vermutungen bestätigt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unklare Treffer ({ambiguous?.length ?? 0})</CardTitle>
          <p className="text-sm text-muted-foreground">
            Mehrere mögliche Google-Places-Treffer — bitte den richtigen auswählen oder als &bdquo;kein Treffer&ldquo;
            markieren.
          </p>
        </CardHeader>
        <CardContent>
          {!ambiguous || ambiguous.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine offenen Fälle.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {ambiguous.map((row) => {
                const company = row.companies as {
                  id: string;
                  name: string;
                  kundennummer: string;
                  ort: string | null;
                  strasse: string | null;
                } | null;
                if (!company) return null;
                return (
                  <li key={row.id} className="rounded-xl border p-3">
                    <div className="mb-2">
                      <Link href={`/firmen/${company.id}`} className="font-medium hover:underline">
                        {company.name}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {company.kundennummer} · {company.strasse}, {company.ort}
                      </p>
                    </div>
                    <AmbiguousCandidatePicker
                      companyId={row.company_id}
                      candidates={(row.places_candidates as never[]) ?? []}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
