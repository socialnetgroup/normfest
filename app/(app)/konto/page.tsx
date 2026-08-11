import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordChangeForm } from "@/components/password-change-form";
import { getCurrentUser } from "@/lib/auth";

// Anis, 2026-08-11: "do the option to set your own Password after 1st
// logging" - new agent accounts start on a shared temp password
// (Firstname123) and are flagged profiles.must_change_password until they
// set their own here; proxy.ts redirects them to this page on every
// navigation until they do. Also reachable any time afterward as a normal
// "change my password" settings page.
export default async function KontoPage() {
  const { user, profile } = await getCurrentUser();
  if (!user) notFound();

  const mustChange = profile?.must_change_password ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Mein Konto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mustChange
            ? "Bitte setze jetzt dein eigenes Passwort, bevor du das Tool weiter nutzt."
            : "Hier kannst du dein Passwort ändern."}
        </p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Passwort ändern</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordChangeForm mustChange={mustChange} />
        </CardContent>
      </Card>
    </div>
  );
}
