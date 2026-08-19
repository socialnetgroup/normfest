import { Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FavoriteStarButton } from "@/components/favorite-star-button";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

export default async function FirmenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { user } = await getCurrentUser();

  // RPC instead of a direct .from("companies") query -- a direct query goes
  // through RLS's companies_select_visible policy, whose fn_company_visible()
  // predicate defeats the trigram-index plan entirely (opaque per-row
  // function call under RLS's security barrier forces a near-full scan --
  // measured ~3-9s). fn_search_companies() replicates the same visibility
  // rule but evaluates it once and expresses the per-row check as a plain
  // column comparison, so Postgres can use the indexes (measured ~30-250ms
  // end to end). See migration 20260731020000_fn_search_companies_perf.sql.
  //
  // An empty query lists every company visible to the caller (admin sees
  // all, an agent sees only their own Gebiet once visibility_mode='gebiet')
  // instead of showing nothing until a search is typed -- p_query='' skips
  // the ilike filter entirely inside the RPC (see 20260731050000).
  const showList = query.length === 0 || query.length >= 2;
  const results = showList
    ? await supabase.rpc("fn_search_companies", {
        p_query: query,
        p_limit: PAGE_SIZE,
        p_offset: from,
      })
    : null;

  const total = results?.data?.[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => `/firmen?q=${encodeURIComponent(query)}&page=${p}`;

  // Favoritenliste star, now also shown here (Anis, 2026-08-19: "neka pise i
  // u generalnoj listi favorita zvjezdica kraj imena kad se otvore alle
  // firmen") - scoped to just the ids on this page (not the agent's whole
  // list, which can be in the hundreds, §14 item 124's Rijalda migration)
  // since that's all this render needs.
  const pageCompanyIds = (results?.data ?? []).map((c) => c.id);
  const favoriteIds =
    user && pageCompanyIds.length > 0
      ? new Set(
          (
            await supabase
              .from("company_favorites")
              .select("company_id")
              .eq("agent_id", user.id)
              .in("company_id", pageCompanyIds)
          ).data?.map((f) => f.company_id) ?? [],
        )
      : new Set<string>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Firmen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suche nach Name, Kundennummer, Ort, PLZ oder Gebiet.
        </p>
      </div>

      <form action="/firmen" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="z.B. Autohaus Müller, 314587, Dresden..."
            autoFocus
            className="h-10 pl-8 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="h-10">
          Suchen
        </Button>
      </form>

      {query.length > 0 && query.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Bitte mindestens 2 Zeichen eingeben.
        </p>
      ) : null}

      {results?.error ? (
        <p className="text-sm text-destructive" role="alert">
          Fehler bei der Suche: {results.error.message}
        </p>
      ) : null}

      {results?.data ? (
        results.data.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {query ? `${total} Treffer` : `${total} Firmen verfügbar`} - Seite {page} von {totalPages}
            </p>
            <div className="overflow-hidden rounded-xl border">
              <ul className="divide-y">
                {results.data.map((company) => (
                  <li key={company.id}>
                    <Link
                      href={`/firmen/${company.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {user ? (
                            <FavoriteStarButton
                              companyId={company.id}
                              agentId={user.id}
                              initialFavorited={favoriteIds.has(company.id)}
                            />
                          ) : null}
                          <span className="truncate font-medium">{company.name}</span>
                          {company.call_priority ? (
                            <Badge variant="warning">Zuerst anrufen</Badge>
                          ) : null}
                          {company.do_not_contact ? (
                            <Badge variant="muted">Gesperrt</Badge>
                          ) : null}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {company.kundennummer} · {company.plz} {company.ort}
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {company.gebiet}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    ← Vorherige
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground">
                  Seite {page} von {totalPages}
                </span>
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Nächste →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {query ? (
              <>Keine Firmen gefunden für &ldquo;{query}&rdquo;.</>
            ) : (
              "Keine Firmen für dich verfügbar."
            )}
          </p>
        )
      ) : null}
    </div>
  );
}
