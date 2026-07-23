// M6 — Wissen seed content (onboarding basics). Requested 2026-07-23: Wissen
// was empty because the only other candidate source document mixed
// methodology with sensitive HR data (see CLAUDE.md §8). Anis asked for a
// non-empty starting set instead: general Normfest company facts (from
// normfest.de/en, summarized not copied), telesales-as-relationship framing,
// and the tool landscape (Speedy CRM, dialer, this app). Skript stays the
// single source of truth for the actual call script/objection handling —
// these docs only point there, they don't duplicate it.
//
// Usage: node scripts/seed-wissen.mjs
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DOCUMENTS = [
  {
    title: "Normfest — Unternehmensüberblick",
    source_path: "https://normfest.de/en/",
    chunks: [
      {
        heading: "Wer ist Normfest?",
        content:
          "Normfest wurde 1948 gegründet und beschreibt sich selbst als seit über sieben Jahrzehnten führenden Anbieter von Werkstattausrüstung. Hauptsitz ist Velbert (Deutschland). Das Sortiment umfasst über 26.000 chemisch-technische und technische Produkte — Kfz-Verbrauchsmaterial und Zubehör, Ausrüstung für Caravan- und Landmaschinenbetriebe sowie über die Marke „Dress and Safe“ (seit 1995) Arbeitskleidung und Sicherheitsschuhe.",
      },
      {
        heading: "Kunden & Reichweite",
        content:
          "Zielkunden sind gewerbliche Betriebe rund um Fahrzeugwartung und -reparatur — vor allem freie Kfz-Werkstätten, daneben auch Bau, Lackiererei, Elektro und Garten- bzw. Landtechnik. Normfest ist mit Tochtergesellschaften in mehreren europäischen Ländern vertreten (u.a. Österreich, Kroatien, Tschechien, Polen, Serbien, Slowakei, Spanien, UK, Bosnien und Herzegowina). Unser Sarajevo-Team verkauft im Outbound-Telesales an deutsche Kfz-Werkstätten — die Zielgruppe sitzt in Deutschland, das Vertriebsteam in Sarajevo.",
      },
      {
        heading: "Werte & Service",
        content:
          "Normfest positioniert sich über persönlichen Service, Verlässlichkeit und effiziente Abläufe für die Werkstatt — u.a. über Außendienst-Teams und feste Ansprechpartner. Zum Nachhaltigkeitsengagement zählt eine 970 m² große Photovoltaikanlage (200+ kWp), die laut Unternehmensangaben rund 82.000 kg CO2 pro Jahr einspart. Digitale Zusatzservices umfassen u.a. eine Gefahrstoffdatenbank, Sicherheitsdatenblätter, Kostenstellen-Verwaltung und eine App für die Bestellung.",
      },
    ],
  },
  {
    title: "Telesales bei Normfest — Beziehung statt nur Verkauf",
    chunks: [
      {
        heading: "Nicht nur Hard Selling",
        content:
          "Verbrauchsmaterial ist ein wiederkehrendes Geschäft: Eine Werkstatt braucht Öl, Reiniger, Kleinteile etc. nicht einmal, sondern dauerhaft. Ziel eines Anrufs ist deshalb selten der einmalige Abschluss um jeden Preis, sondern der Aufbau einer Beziehung, in der Normfest die naheliegende erste Adresse wird, wenn wieder etwas gebraucht wird. Ein Kunde, der sich gut beraten fühlt, bestellt öfter — und das zahlt direkt auf Fokusliste, Feedback und Signale in diesem Tool ein.",
      },
      {
        heading: "Der Kunde im Zentrum",
        content:
          "Bevor du anrufst: Schau dir das Firmenprofil an. Was wurde bisher bestellt oder als Feedback erfasst? Gibt es einen erkannten Marken- oder Kategoriefokus? Gibt es externe Hinweise (z.B. aus Google-Bewertungen oder der Website der Werkstatt)? Ziel ist, dass der Kunde merkt: „Die kennen meinen Betrieb.“ Das ist der Kerngedanke hinter Firmenprofil, Empfehlungen und der Anreicherung in diesem Tool.",
      },
      {
        heading: "Gesprächsstruktur & Einwände",
        content:
          "Die konkrete Gesprächsstruktur (5 Phasen: Einstieg, Eröffnungsfrage, Bedarfsermittlung, Angebot, Abschluss), die 5S-Einwandtechnik und die einzelnen formulierten Antworten auf typische Kundeneinwände sind im Bereich Skript hinterlegt — dort liegt der vollständige, verbindliche Leitfaden. Dieser Wissen-Bereich beschreibt nur die Haltung dahinter.",
      },
    ],
  },
  {
    title: "Werkzeuge im Arbeitsalltag",
    chunks: [
      {
        heading: "Speedy (CRM)",
        content:
          "Speedy ist das bestehende CRM, in dem die Kundendatenbank (Leads, Kontakthistorie, Anrufstatus) geführt wird. Es bleibt neben diesem Tool im Einsatz — bei Fragen zu Zugängen oder zur Dateneingabe in Speedy wende dich an deinen Teamleiter.",
      },
      {
        heading: "Der Dialer",
        content:
          "Anrufe laufen weiterhin über den bestehenden Dialer, nicht über dieses Tool. Dieses Tool ist dein Vorbereitungs- und Wissens-Begleiter rund um den Anruf (Firmenprofil, Empfehlungen, Skript) — keine Telefonanlage.",
      },
      {
        heading: "Dieses Tool: der persönliche Sales Assistant",
        content:
          "Dieses Tool ergänzt Speedy und den Dialer um: eine durchsuchbare Firmen- und Produktdatenbank (Firmen, Katalog), Vorschläge was du wem anbieten solltest inkl. Begründung (Empfehlungen), die aktuelle Fokusliste des Teams (Fokus), diesen Wissensbereich sowie den Gesprächsleitfaden (Skript), und die Feedback-Erfassung nach jedem Anruf. Wichtig: Je konsequenter Feedback erfasst wird, desto besser werden die Vorschläge, die du bekommst — das Tool lernt aus dem, was das ganze Team einträgt.",
      },
    ],
  },
];

async function main() {
  for (const doc of DOCUMENTS) {
    const { data: created, error: docErr } = await admin
      .from("kb_documents")
      .insert({ title: doc.title, collection: "wissen", source_path: doc.source_path ?? null })
      .select("id")
      .single();
    if (docErr) throw docErr;

    const chunkRows = doc.chunks.map((c, i) => ({
      document_id: created.id,
      chunk_index: i,
      heading: c.heading,
      content: c.content,
    }));
    const { error: chunkErr } = await admin.from("kb_chunks").insert(chunkRows);
    if (chunkErr) throw chunkErr;

    console.log(`Inserted "${doc.title}" (${chunkRows.length} chunks) — ${created.id}`);
  }
}

main();
