import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";

const RESULT_LIMIT = 25;

export default async function FirmenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createClient();

  const results =
    query.length >= 2
      ? await supabase
          .from("companies")
          .select("id, kundennummer, name, ort, plz, gebiet, do_not_contact, call_priority")
          .or(
            `name.ilike.%${query}%,kundennummer.ilike.%${query}%,ort.ilike.%${query}%,plz.ilike.%${query}%`,
          )
          .order("name")
          .limit(RESULT_LIMIT)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Firmen</h1>
        <p className="mt-1 text-muted-foreground">
          Suche nach Name, Kundennummer, Ort oder PLZ.
        </p>
      </div>

      <form action="/firmen" className="flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="z.B. Autohaus Müller, 314587, Dresden..."
          autoFocus
        />
        <Button type="submit">Suchen</Button>
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
          <ul className="flex flex-col divide-y rounded-lg border">
            {results.data.map((company) => (
              <li key={company.id}>
                <Link
                  href={`/firmen/${company.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
                >
                  <div>
                    <div className="font-medium">
                      {company.name}
                      {company.call_priority ? (
                        <span className="ml-2 text-xs text-destructive">
                          zuerst anrufen
                        </span>
                      ) : null}
                      {company.do_not_contact ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          gesperrt
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {company.kundennummer} · {company.plz} {company.ort}
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {company.gebiet}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keine Firmen gefunden für &ldquo;{query}&rdquo;.
          </p>
        )
      ) : null}
    </div>
  );
}
