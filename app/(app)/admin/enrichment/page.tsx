import { notFound } from "next/navigation";
import Link from "next/link";

import { AmbiguousCandidatePicker } from "@/components/ambiguous-candidate-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Page size for the ambiguous-queue list (2026-08-09, Anis: "atm it just
// shows 1000 while beeing 1000+"). The old page (a) fetched with no
// `.range()`, so PostgREST's default 1000-row cap silently truncated the
// real ~1,291-row queue's displayed count, and (b) rendered every row's
// full candidate picker on one page at once - a real scale problem on top
// of the count bug now that the queue is four figures. Fixed both: an exact
// `count: "exact", head: true` query for the real total, and real
// pagination for the rendered list.
const PAGE_SIZE = 20;

export default async function EnrichmentAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();
  if (profile?.role !== "admin") notFound();

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  const [{ data: ambiguous }, { count: ambiguousCount }, { count: totalEnriched }, { count: verifiedCount }] =
    await Promise.all([
      supabase
        .from("company_enrichment")
        .select("id, company_id, places_candidates, companies(id, name, kundennummer, ort, strasse)")
        .eq("places_ambiguous", true)
        .order("id")
        .range(from, to),
      supabase.from("company_enrichment").select("id", { count: "exact", head: true }).eq("places_ambiguous", true),
      supabase.from("company_enrichment").select("id", { count: "exact", head: true }),
      supabase.from("company_enrichment").select("id", { count: "exact", head: true }).eq("verified", true),
    ]);

  const total = ambiguousCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
          <CardTitle>Unklare Treffer ({total})</CardTitle>
          <p className="text-sm text-muted-foreground">
            Mehrere mögliche Google-Places-Treffer - bitte den richtigen auswählen oder als &bdquo;kein Treffer&ldquo;
            markieren. Grün markierte Kandidaten haben einen Namens-Match von 80%+ mit der Firma - meist die richtige
            Wahl, trotzdem kurz prüfen.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
                      companyName={company.name}
                      candidates={(row.places_candidates as never[]) ?? []}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
              <span>
                Seite {page} von {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={`/admin/enrichment?page=${page - 1}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Zurück
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link
                    href={`/admin/enrichment?page=${page + 1}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Weiter
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
