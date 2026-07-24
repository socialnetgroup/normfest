import { notFound } from "next/navigation";
import { FileAudio, Headphones, ListChecks, MessageSquareWarning, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/progress-bar";
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

const TRANSCRIPT = [
  { speaker: "Agent", phase: "1. Eröffnung", text: "Guten Tag, hier ist [Agent] von Normfest, spreche ich mit der Werkstattleitung?" },
  { speaker: "Kunde", phase: "1. Eröffnung", text: "Ja, worum geht's?" },
  { speaker: "Agent", phase: "2. Bedarfsanalyse", text: "Ich wollte kurz fragen, wie es aktuell bei Ihnen mit Verbrauchsmaterial aussieht - Bremsenreiniger, Schleifmittel, sowas in der Richtung?" },
  { speaker: "Kunde", phase: "2. Bedarfsanalyse", text: "Wir sind eigentlich ganz gut versorgt, aber bei den Reinigern könnten wir bald wieder was brauchen." },
  { speaker: "Agent", phase: "3. Angebot", text: "Dann hätte ich da ein passendes Aktionspaket, das gerade im Fokus läuft, gutes Preis-Leistungs-Verhältnis." },
  { speaker: "Kunde", phase: "4. Einwand", text: "Ist mir grad zu teuer, wir haben diesen Monat schon einiges bestellt." },
  { speaker: "Agent", phase: "4. Einwand", text: "Verstehe ich - darf ich fragen, im Vergleich wozu das zu teuer ist? Oft rechnet sich das Paket über die Packungsgröße." },
  { speaker: "Kunde", phase: "5. Abschluss", text: "Ok, schicken Sie mir mal ein Angebot, dann schauen wir uns das in Ruhe an." },
];

const OBJECTIONS = [
  { text: "\"Ist mir grad zu teuer\"", technique: "5S angewendet (teilweise)", quality: "gut" as const },
  { text: "Kein zweiter Einwand im Gespräch", technique: "-", quality: "n/a" as const },
];

const COACHING_NOTES = [
  "Bedarfsanalyse war kurz - noch eine offene Frage mehr hätte den Bedarf klarer gemacht.",
  "Preiseinwand wurde sauber mit einer Gegenfrage aufgefangen, statt sofort nachzulassen.",
  "Abschluss blieb vage (\"schicken Sie ein Angebot\") - ein konkreter Folgetermin wäre stärker gewesen.",
];

export default async function QaAnrufePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading flex items-center gap-2 text-2xl font-semibold tracking-tight">
            QA-Anrufe
            <Badge variant="warning">Work in Progress</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konzept-Vorschau: automatische Call-QA aus hochgeladenen Gesprächsaufnahmen. Noch nicht live -
            unten ein Beispiel, wie das Ergebnis aussehen könnte.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <IconTitle icon={Sparkles}>Wie das funktionieren soll</IconTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          TL lädt eine gespeicherte Anrufaufnahme hoch (mp3/wav) → eine externe Spracherkennung transkribiert
          das Gespräch mit Sprechertrennung (Agent/Kunde) → die KI bewertet das Transkript gegen die
          dokumentierte Gesprächsmethodik aus dem Skript (5-Phasen-Struktur, 5S-Einwandtechnik, Redewendungen)
          → strukturierter QA-Report mit Phasen-Zeitstempeln, Einwänden, Score und Coaching-Hinweisen. Fehlt
          aktuell noch: Auswahl eines Spracherkennungs-Anbieters (z.B. Deepgram, Whisper) - siehe CLAUDE.md §13
          M9.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <IconTitle icon={FileAudio}>Aufnahme hochladen</IconTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Headphones className="size-4 text-muted-foreground" />
              <span className="font-medium">Elida.mp3</span>
              <Badge variant="secondary">Beispiel-Datei</Badge>
            </div>
            <Button type="button" size="sm" disabled>
              Transkribieren &amp; analysieren
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload ist noch nicht aktiv - der Report unten zeigt, was aus dieser Datei entstehen würde, sobald
            die Anbindung steht.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <IconTitle icon={ListChecks}>Beispiel-Transkript</IconTitle>
          <p className="text-sm text-muted-foreground">
            Frei erfunden zu Demozwecken - keine echte Transkription von Elida.mp3, nur eine Illustration des
            Formats.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {TRANSCRIPT.map((line, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5 text-sm">
                <Badge variant={line.speaker === "Agent" ? "default" : "muted"} className="mt-0.5 shrink-0">
                  {line.speaker}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p>{line.text}</p>
                  <span className="text-xs text-muted-foreground">{line.phase}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <IconTitle icon={Sparkles}>QA-Report (Beispiel)</IconTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">Gesamt-Score</span>
              <span className="font-semibold text-primary">78 / 100</span>
            </div>
            <ProgressBar value={78} max={100} />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Einwände
            </p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {OBJECTIONS.map((o, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <MessageSquareWarning className="size-3.5 shrink-0 text-warning-foreground" />
                    <span>{o.text}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{o.technique}</span>
                    <Badge variant={o.quality === "gut" ? "success" : "muted"}>{o.quality}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Coaching-Hinweise
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              {COACHING_NOTES.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
