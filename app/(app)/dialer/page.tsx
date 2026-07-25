import { notFound } from "next/navigation";
import { PhoneCall, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SoftphoneDialpad } from "@/components/softphone-dialpad";
import { createClient } from "@/lib/supabase/server";

function IconTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      {children}
    </CardTitle>
  );
}

export default async function DialerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Dialer
          <Badge variant="warning">Bald</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Konzept-Vorschau: Anrufe direkt aus diesem Fenster starten, ohne zwischen Tools zu wechseln. Noch
          nicht verbunden - unten ein Eindruck, wie das Softphone aussehen könnte.
        </p>
      </div>

      <Card>
        <CardHeader>
          <IconTitle icon={Sparkles}>Wie das funktionieren soll</IconTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Anbindung an den bestehenden Dialer über dessen API, direkt aus diesem Fenster - Anruf starten
          (z.B. per Klick von der Firmenprofil-Seite mit vorausgefüllter Nummer), Status live sehen, nach dem
          Gespräch direkt Feedback eintragen, ohne das Tool zu wechseln. Ersetzt nicht den bestehenden Dialer
          (der bleibt System of Record fürs eigentliche Telefonieren, CLAUDE.md §1) - reine
          Bedienoberfläche/Anbindung. Fehlt aktuell noch: Wahl u. Anbindung der Dialer-API.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <IconTitle icon={PhoneCall}>Softphone (Beispiel-Layout)</IconTitle>
          <p className="text-sm text-muted-foreground">
            Ziffernblock funktioniert schon zur Eingabe - der Anruf-Button ist bewusst deaktiviert, es besteht
            noch keine echte Verbindung.
          </p>
        </CardHeader>
        <CardContent>
          <SoftphoneDialpad />
        </CardContent>
      </Card>
    </div>
  );
}
