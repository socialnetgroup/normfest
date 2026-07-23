import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type ItemRow = {
  id: string;
  note: string | null;
  companies: {
    id: string;
    name: string;
    kundennummer: string;
    ort: string | null;
    gebiet: string | null;
  } | null;
};

export default async function FokusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: activeList }] = await Promise.all([
    user ? supabase.from("profiles").select("role").eq("id", user.id).single() : Promise.resolve({ data: null }),
    supabase.from("focus_lists").select("id, name, note, created_at").eq("active", true).maybeSingle(),
  ]);

  const isAdmin = profile?.role === "admin";

  const { data: items } = activeList
    ? await supabase
        .from("focus_list_items")
        .select("id, note, companies(id, name, kundennummer, ort, gebiet)")
        .eq("focus_list_id", activeList.id)
        .order("created_at")
    : { data: null };

  const rows = (items ?? []) as unknown as ItemRow[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Fokus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aktuelle Fokusliste — kuratiert vom Admin.
          </p>
        </div>
        {isAdmin ? (
          <Link href="/fokus/neu" className={buttonVariants({ variant: "default" })}>
            Neue Liste erstellen
          </Link>
        ) : null}
      </div>

      {!activeList ? (
        <p className="text-sm text-muted-foreground">Aktuell keine aktive Fokusliste.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{activeList.name}</CardTitle>
            {activeList.note ? (
              <p className="text-sm text-muted-foreground">{activeList.note}</p>
            ) : null}
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Diese Liste enthält noch keine Firmen.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <ul className="divide-y">
                  {rows.map((row) =>
                    row.companies ? (
                      <li key={row.id}>
                        <Link
                          href={`/firmen/${row.companies.id}`}
                          className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                        >
                          <div className="min-w-0">
                            <span className="font-medium">{row.companies.name}</span>
                            <div className="text-sm text-muted-foreground">
                              {row.companies.kundennummer} · {row.companies.ort}
                              {row.note ? ` · ${row.note}` : ""}
                            </div>
                          </div>
                          {row.companies.gebiet ? (
                            <Badge variant="secondary" className="shrink-0">
                              {row.companies.gebiet}
                            </Badge>
                          ) : null}
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
