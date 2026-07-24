import { Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  const results =
    query.length >= 2
      ? await supabase
          .from("companies")
          .select("id, kundennummer, name, ort, plz, gebiet, do_not_contact, call_priority", { count: "exact" })
          .or(
            `name.ilike.%${query}%,kundennummer.ilike.%${query}%,ort.ilike.%${query}%,plz.ilike.%${query}%,gebiet.ilike.%${query}%`,
          )
          .order("name")
          .range(from, to)
      : null;

  const total = results?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => `/firmen?q=${encodeURIComponent(query)}&page=${p}`;

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
              {total} {total === 1 ? "Treffer" : "Treffer"} - Seite {page} von {totalPages}
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
            Keine Firmen gefunden für &ldquo;{query}&rdquo;.
          </p>
        )
      ) : null}
    </div>
  );
}
