// One-off translation (2026-08-08), Anis: "Skript - izbaciti sav bosanski
// jezik, ostvariti samo njemacki svugdje." The full guide's 21 kb_chunks
// (collection='skript') were extracted verbatim from the Bosnian/Croatian
// source document (§8 M6) - there was never a German version to fall back
// to, so this is a real translation pass, not a delete. Uses the "analyze"
// cost tier (lib/ai/provider.mjs) since this is training content agents
// rely on for real customer calls - quality matters more than bulk-tier
// cost here.
//
// Two chunks (5 "Tehnike zaključivanja prodaje" and 6 "Prodajni vokabular")
// have explicit Bosnian-vs-German comparison tables (3 columns: technique/
// code | Bosnian example | German example) - those collapse to 2 columns
// (label | German only) since there's no more Bosnian column to show.
// Everything else translates 1:1 preserving line structure so the existing
// app/(app)/skript/page.tsx table/list parsing (TABLE_SPECS, heading
// matching) keeps working once its heading strings are updated to match.
import { createClient } from "@supabase/supabase-js";
import { existsSync, writeFileSync } from "node:fs";

import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = getAnthropicClient();
const dryRun = process.argv.includes("--dry-run");

const { data: doc, error: docErr } = await admin
  .from("kb_documents")
  .select("id, title")
  .eq("collection", "skript")
  .single();
if (docErr) throw docErr;

const { data: chunks, error: chunksErr } = await admin
  .from("kb_chunks")
  .select("id, chunk_index, heading, content")
  .eq("document_id", doc.id)
  .order("chunk_index");
if (chunksErr) throw chunksErr;

const prompt = `Du übersetzt einen bosnischen Verkaufsleitfaden für ein deutsches Telesales-Team (Normfest) ins Deutsche.
Das ist echtes Trainingsmaterial, das Agenten während echter Kundenanrufe verwenden - Genauigkeit und ein natürlicher, professioneller deutscher Ton sind wichtig, keine wörtliche/holprige Übersetzung.

Dokumenttitel: "${doc.title}"
Übersetze den Titel ins Deutsche (Format: "Agent Sales Guide — <deutscher Untertitel>").

Für jeden Chunk unten: übersetze "heading" und "content" vollständig ins Deutsche. WICHTIG - Struktur beibehalten:
- Gleiche Anzahl Zeilen, gleiche Zeilenumbrüche (\\n-getrennt), gleiche Reihenfolge.
- Zitierte Skriptsätze bleiben in Anführungszeichen ("...").
- Aufzählungspunkte (-, •, Zahlen) bleiben als Aufzählungspunkte.
- "Label: Rest"-Einleitungen bleiben als "Label: Rest".
- ALLCAPS-Unterüberschriften bleiben ALLCAPS (aber auf Deutsch).
- Tabellenartige Zeilenfolgen (Kopfzeile gefolgt von sich wiederholenden Werten) bleiben als Tabellen erkennbar - gleiche Kopfzeilen-Wörter auf Deutsch, gleiche Anzahl Werte pro Zeile.

SONDERFALL - zwei Chunks haben eine Bosnisch-vs-Deutsch-Vergleichstabelle (3 Spalten: Technik/Begriff | bosnisches Beispiel | deutsches Beispiel, ODER "NE koristi"/"KORISTI"/"Primjer"). Da es kein Bosnisch mehr gibt, werden daraus 2-Spalten-Tabellen: nur noch (Technik/Begriff | deutsches Beispiel). Lösche die bosnische Spalte komplett, behalte nur die deutsche Version (übersetze die Kopfzeile entsprechend, z.B. "Bosanski"+"Njemacki" → nur noch "Beispiel"; "NE koristi"/"KORISTI"/"Primjer" → "VERMEIDEN"/"VERWENDEN"/"Beispiel", mit deutschen Wortpaaren statt der bosnischen).

Wenn eine Zeile mit "DE" oder "BS" beginnt gefolgt von einem Beispielsatz (zweisprachige Beispielskripte) - behalte nur die deutsche Version als normale Zeile, ohne "DE"-Präfix, lösche die "BS"-Zeile komplett.

Gib NUR valides JSON zurück, keine Erklärungen, in diesem Format:
{
  "title": "...",
  "chunks": [
    { "chunk_index": 0, "heading": "...", "content": "..." },
    ...
  ]
}

Hier sind Titel und alle ${chunks.length} Chunks:

Titel: ${doc.title}

${chunks.map((c) => `--- Chunk ${c.chunk_index} ---\nHeading: ${c.heading}\nContent:\n${c.content}`).join("\n\n")}`;

console.log(`Sending ${chunks.length} chunks (${prompt.length} chars) to ${getModel("analyze")}...`);

const message = await anthropic.messages
  .stream({
    model: getModel("analyze"),
    max_tokens: 32000,
    messages: [{ role: "user", content: prompt }],
  })
  .finalMessage();

console.log("usage:", message.usage);

const textBlock = message.content.find((b) => b.type === "text");
if (!textBlock) throw new Error("no text block in response");

let parsed;
try {
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text);
} catch (err) {
  writeFileSync("scripts/.skript-translation-raw-output.txt", textBlock.text);
  throw new Error(`Failed to parse JSON, raw output saved to scripts/.skript-translation-raw-output.txt: ${err.message}`);
}

writeFileSync(
  "C:/Users/an1s/AppData/Local/Temp/claude/C--Users-an1s-Desktop-normfest/c871ff7f-002d-4337-88c4-483d023ac9f0/scratchpad/skript-translated.json",
  JSON.stringify(parsed, null, 2),
);
console.log(`Translated title + ${parsed.chunks.length} chunks. Saved to scratchpad/skript-translated.json for review.`);

if (dryRun) {
  console.log("--dry-run: not writing to DB.");
  process.exit(0);
}

const { error: titleErr } = await admin.from("kb_documents").update({ title: parsed.title }).eq("id", doc.id);
if (titleErr) throw titleErr;

for (const c of parsed.chunks) {
  const original = chunks.find((x) => x.chunk_index === c.chunk_index);
  if (!original) {
    console.warn(`chunk_index ${c.chunk_index} not found in original set, skipping`);
    continue;
  }
  const { error } = await admin
    .from("kb_chunks")
    .update({ heading: c.heading, content: c.content })
    .eq("id", original.id);
  if (error) console.error(`update failed for chunk ${c.chunk_index}:`, error.message);
}

console.log("Done writing translated chunks to DB.");
