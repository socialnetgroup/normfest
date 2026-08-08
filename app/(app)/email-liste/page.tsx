import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmailListClient } from "@/components/email-list-client";
import { EmailTemplateBlock } from "@/components/email-template-block";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Email-Liste (2026-08-08), Anis: "lista svih emailova sa agentovog gebieta +
// opcija brisanja maila sa te liste... they would use all those emails to
// kinda copy paste into mail client. Lets for now just build a copiable list
// per gebiet per agent." No auto-send yet (§14 item 29) - just a fast,
// correct copy source for a manual Outlook send.
export default async function EmailListePage({
  searchParams,
}: {
  searchParams: Promise<{ gebiet?: string }>;
}) {
  const { gebiet: gebietParam } = await searchParams;
  const { profile } = await getCurrentUser();
  const isAdmin = profile?.role === "admin";
  const supabase = await createClient();

  const [{ data: gebietOptions }, { data: rows }] = await Promise.all([
    isAdmin
      ? supabase
          .from("agents")
          .select("gebiet, full_name")
          .eq("active", true)
          .not("gebiet", "is", null)
          .order("full_name")
      : Promise.resolve({ data: null }),
    supabase.rpc("fn_email_list", { p_gebiet: isAdmin ? (gebietParam ?? undefined) : undefined }),
  ]);

  const noGebietSelected = isAdmin && !gebietParam;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Email-Liste</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "E-Mail-Adressen aller Firmen im gewählten Gebiet - zum Kopieren ins Mail-Programm."
            : "E-Mail-Adressen aller Firmen in deinem Gebiet - zum Kopieren ins Mail-Programm."}
        </p>
      </div>

      {isAdmin ? (
        <Card>
          <CardContent className="pt-4">
            <form action="/email-liste" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="gebiet">Gebiet</Label>
                <select id="gebiet" name="gebiet" defaultValue={gebietParam ?? ""} className={selectClassName}>
                  <option value="">Gebiet wählen…</option>
                  {(gebietOptions ?? []).map((g) => (
                    <option key={g.gebiet} value={g.gebiet!}>
                      {g.full_name} ({g.gebiet})
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm">
                Anzeigen
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{noGebietSelected ? "Kein Gebiet gewählt" : "Firmen-E-Mails"}</CardTitle>
        </CardHeader>
        <CardContent>
          {noGebietSelected ? (
            <p className="text-sm text-muted-foreground">Bitte oben ein Gebiet auswählen.</p>
          ) : (
            <EmailListClient rows={rows ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>E-Mail-Vorlage</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailTemplateBlock />
        </CardContent>
      </Card>
    </div>
  );
}
