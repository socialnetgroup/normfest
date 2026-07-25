// Shared by the QA-Bewertungen create form and detail view. The 5 phases and
// their coaching hints are adapted directly from
// input/Osnovna dokumentacija/Normfest_Coaching_1on1_v1.docx §4 "CALL
// KVALITET RUBRIKA" (2 points per phase, 10 max) - the same 5-phase call
// structure the Agent Sales Guide / Skript already documents elsewhere in
// this app. Not invented, just translated BS/HR -> DE for this UI.
export const CALL_QUALITY_PHASES = [
  {
    key: "f1",
    label: "F1 · Vorstellung & Gesprächsgrund",
    hint: "Typischer Fehler: fragt nicht \"Spreche ich mit Herr/Frau X?\", steigt direkt ein. Kein \"Entschuldigen Sie die Störung\".",
  },
  {
    key: "f2",
    label: "F2 · Eröffnungsfrage",
    hint: "Typischer Fehler: gibt auf, wenn der Kunde \"wir haben schon einen Lieferanten\" sagt. Top-Agent: \"Verstehe, fast alle unsere Kunden hatten das auch...\"",
  },
  {
    key: "f3",
    label: "F3 · Bedarfsanalyse (Fragetechnik)",
    hint: "Typischer Fehler: Agent redet 2 Minuten ohne eine Frage zu stellen. Gesprächskontrolle: wenn der Kunde \"schicken Sie eine E-Mail\" sagt, vorher noch eine Frage stellen.",
  },
  {
    key: "f4",
    label: "F4 · Lösungspräsentation",
    hint: "Typischer Fehler: Fokus liegt auf dem Preis. Fokus sollte sein: Qualität, Zuverlässigkeit, Zeitersparnis.",
  },
  {
    key: "f5",
    label: "F5 · Abschluss / Call-to-Action",
    hint: "Typischer Fehler: pitcht nach der Abschlussfrage weiter. Stille ist eine Verkaufstechnik - der Kunde soll die Stille brechen.",
  },
] as const;

export type CallQualityPhaseKey = (typeof CALL_QUALITY_PHASES)[number]["key"];
