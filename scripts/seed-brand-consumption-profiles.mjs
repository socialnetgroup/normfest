// CLAUDE.md M8 follow-up (2026-07-25, Anis: "brand consumptio profile - do
// your own research for each specific brand and use this information as
// preliminary, i will give some input afterwards with sanin and agents").
//
// brand_consumption_profiles had 0 rows since the real workshop (§14 item 5,
// Anis+Sanin+top agent) hasn't happened yet, which keeps brand_profile_match
// permanently dead. These 10 rows are Claude-researched, restricted to
// genuinely well-established, widely-documented automotive trade knowledge
// (timing-chain/oil-consumption discussions that are common knowledge in the
// independent-workshop/aftermarket world) — never a specific numeric claim I
// can't ground, and never anything model-year-specific I'm not fully certain
// of. All seeded with verified=false and a source note — Anis/Sanin review
// and correct these later; nothing here should be treated as final.
//
// Brand names chosen match the most common real spelling seen in
// company_enrichment.brand_focus_guess (checked directly: "Mercedes-Benz"
// 16x + "Mercedes" 12x, "Volkswagen" 13x + "VW" 10x, "Audi" 24x, "BMW" 20x,
// etc.) — but note this table's `brand` values are NOT yet normalized
// against those guess variants (e.g. "Mercedes" vs "Mercedes-Benz" won't
// join as the same brand). That normalization is real future work for
// whoever builds the brand_profile_match signal block itself (still
// unbuilt — needs companies.brand_focus populated first, §6), not something
// to solve in this seed pass.
//
// Idempotent: uses upsert on the (brand, category) unique constraint, safe
// to re-run.
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SOURCE = "Claude-Recherche, vorläufig (2026-07-25) — noch nicht von Anis/Sanin geprüft";

const ROWS = [
  {
    brand: "Mercedes-Benz",
    category: "Inspektion & Wartung",
    weight: 3,
    note: "Bestimmte MB-Dieselmotoren (u.a. OM642, OM651) sind in der Kfz-Branche für erhöhten Ölverbrauch bekannt - häufigere Ölstandskontrolle und Nachfüllbedarf.",
  },
  {
    brand: "Mercedes-Benz",
    category: "Fahrzeugteile NFZ",
    weight: 3,
    note: "Sprinter und Vito zählen zu den meistgenutzten NFZ-Modellen im Werkstattalltag - entsprechend hoher Bedarf an NFZ-spezifischen Ersatzteilen.",
  },
  {
    brand: "BMW",
    category: "Inspektion & Wartung",
    weight: 3,
    note: "N47-Dieselmotoren (u.a. 1er/3er, Baujahre ca. 2007-2014) sind für Steuerkettenverschleiß bekannt - erhöhter Bedarf an Wartungsteilen.",
  },
  {
    brand: "BMW",
    category: "Werkzeuge",
    weight: 2,
    note: "Steuerkettenreparaturen bei N47-Motoren erfordern Spezialwerkzeug, das in Standard-Werkstattausstattung oft fehlt.",
  },
  {
    brand: "Volkswagen",
    category: "Inspektion & Wartung",
    weight: 3,
    note: "TSI-Motoren der ersten und zweiten EA888-Generation (ca. 2008-2017) sind für erhöhten Ölverbrauch bekannt - häufigere Ölkontrolle empfohlen.",
  },
  {
    brand: "Audi",
    category: "Inspektion & Wartung",
    weight: 3,
    note: "Audi teilt sich mit VW die EA888-Motorenfamilie (TFSI) - dieselbe bekannte Ölverbrauchsproblematik betrifft TFSI-Modelle gleichermaßen.",
  },
  {
    brand: "Ford",
    category: "Fahrzeugteile NFZ",
    weight: 2,
    note: "Ford Transit ist eines der meistgenutzten NFZ-Modelle in Deutschland - hoher Ersatzteilbedarf im Werkstattalltag.",
  },
  {
    brand: "Fiat",
    category: "Fahrzeugteile NFZ",
    weight: 2,
    note: "Fiat Ducato (Basis für viele Transporter/Wohnmobile, baugleich mit Citroën Jumper/Peugeot Boxer) ist ein häufiges NFZ-Modell mit entsprechendem Ersatzteilbedarf.",
  },
  {
    brand: "Tesla",
    category: "Elektromobilität",
    weight: 3,
    note: "Reiner Elektroantrieb - Bedarf konzentriert sich auf Elektromobilität-Zubehör statt klassischer Verbrennerteile (Öl, Zündkerzen etc.).",
  },
  {
    brand: "Porsche",
    category: "Inspektion & Wartung",
    weight: 2,
    note: "Hochleistungsmotoren erfordern häufig hochwertigere Ölspezifikationen und entsprechend engmaschigere Wartungsintervalle.",
  },
];

async function main() {
  const rows = ROWS.map((r) => ({ ...r, verified: false, source: SOURCE }));
  const { error, data } = await admin
    .from("brand_consumption_profiles")
    .upsert(rows, { onConflict: "brand,category" })
    .select("brand, category");
  if (error) throw error;
  console.log(`Seeded ${data.length} brand_consumption_profiles rows (verified=false).`);
  for (const r of data) console.log(`  ${r.brand} -> ${r.category}`);
}

main();
