import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FavoriteStarButton } from "@/components/favorite-star-button";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Favoritenliste (2026-08-19), Anis: "Could we make an Favoritenliste of the
// companies each agent has and can 'star' them... sie benutzen
// wiedervorlagen dafuer, was falsch ist. also favoritenliste ist die
// losung." Rijalda had been keeping her own priority list inside the
// dialer's own lead-list feature instead - this gives every agent a real
// list inside the app, private per agent (same shape as chat_log, §10 M7),
// with admin able to view any agent's list for oversight.
export default async function FavoritenPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent: agentParam } = await searchParams;
  const { user, profile } = await getCurrentUser();
  const isAdmin = profile?.role === "admin";
  const supabase = await createClient();

  const effectiveAgentId = isAdmin ? agentParam : user?.id;
  const isOwnList = effectiveAgentId === user?.id;

  const [{ data: agentOptions }, { data: favorites }] = await Promise.all([
    isAdmin
      ? supabase.from("agents").select("full_name, profile_id").not("profile_id", "is", null).order("full_name")
      : Promise.resolve({ data: null }),
    effectiveAgentId
      ? supabase
          .from("company_favorites")
          .select("id, company_id, created_at, companies(name, kundennummer, plz, ort, gebiet)")
          .eq("agent_id", effectiveAgentId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Favoritenliste</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Priorisierte Firmen pro Agent - mit dem Stern auf dem Firmenprofil hinzugefügt."
            : "Deine priorisierten Firmen - mit dem Stern auf dem Firmenprofil hinzugefügt oder entfernt."}
        </p>
      </div>

      {isAdmin ? (
        <Card>
          <CardContent className="pt-4">
            <form action="/favoriten" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="agent">Agent</Label>
                <select id="agent" name="agent" defaultValue={agentParam ?? ""} className={selectClassName}>
                  <option value="">Bitte wählen</option>
                  {(agentOptions ?? []).map((a) => (
                    <option key={a.profile_id} value={a.profile_id!}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Anzeigen
              </button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {!effectiveAgentId ? (
        <p className="text-sm text-muted-foreground">Bitte einen Agenten auswählen.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{favorites?.length ?? 0} Favorit{favorites?.length === 1 ? "" : "en"}</CardTitle>
          </CardHeader>
          <CardContent>
            {!favorites || favorites.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Favoriten - auf einem Firmenprofil den Stern anklicken.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {favorites.map((f) => {
                  const c = f.companies as {
                    name: string;
                    kundennummer: string | null;
                    plz: string | null;
                    ort: string | null;
                    gebiet: string | null;
                  } | null;
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link href={`/firmen/${f.company_id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{c?.name ?? "-"}</span>
                        <span className="text-xs text-muted-foreground">
                          {c?.kundennummer} · {c?.plz} {c?.ort}
                        </span>
                      </Link>
                      {isOwnList && user ? (
                        <FavoriteStarButton companyId={f.company_id} agentId={user.id} initialFavorited={true} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
