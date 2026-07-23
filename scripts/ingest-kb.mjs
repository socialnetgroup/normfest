// M6 — KB ingestion (CLAUDE.md §8/§11.3). docx text extraction without
// pandoc/soffice: unzip word/document.xml + regex XML-tag stripping.
// Chunks by heading boundary (Heading1/Heading2) for German FTS.
//
// Usage: node scripts/ingest-kb.mjs
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SKRIPT_PATH = "input/Osnovna dokumentacija/2. Normfest - Agent - Sales Priručnik & Skripta.docx";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractParagraphs(docxPath) {
  const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
    maxBuffer: 1024 * 1024 * 50,
  }).toString("utf8");

  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const styleRe = /<w:pStyle w:val="([^"]+)"/;
  const textRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

  const paragraphs = [];
  let m;
  while ((m = paraRe.exec(xml))) {
    const body = m[1];
    const styleMatch = body.match(styleRe);
    const style = styleMatch ? styleMatch[1] : null;

    const withBreaks = body.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n");
    let text = "";
    let tm;
    const localTextRe = new RegExp(textRe.source, "g");
    while ((tm = localTextRe.exec(withBreaks))) text += tm[1];
    text = decodeEntities(text).trim();
    // Defense in depth: a malformed run (seen on at least one paragraph in
    // this doc — a pPr/rPr fragment bleeding into the matched <w:t> content,
    // root cause not worth chasing further) can leak literal OOXML tags
    // into the "text". Real prose never legitimately contains a `<...>`
    // sequence, so strip anything tag-shaped rather than ship raw XML into
    // the KB.
    text = text.replace(/<\/?w:[a-zA-Z]+[^>]*\/?>/g, "").trim();
    if (text) paragraphs.push({ style, text });
  }
  return paragraphs;
}

function chunkByHeading(paragraphs) {
  const chunks = [];
  let current = null;
  for (const p of paragraphs) {
    const isHeading = p.style === "Heading1" || p.style === "Heading2";
    if (isHeading) {
      if (current) chunks.push(current);
      current = { heading: p.text, content: "" };
    } else if (current) {
      current.content += (current.content ? "\n" : "") + p.text;
    }
    // Paragraphs before the first heading (title block) are dropped from
    // chunks — they're cover-page metadata, not searchable content.
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.content.trim().length > 0);
}

// Known table structure in §4 "Prigovori kupaca i kako odgovoriti" (verified
// against the real extracted paragraphs): 8 objection/response-bs/response-de
// triples starting right after the 3 column-header paragraphs. The DE
// objection quote paragraph has a trailing truncated-repeat artifact from
// the source table (e.g. `"Wir haben schon einen Lieferanten." Wir...`) —
// stripped here.
function extractObjectionCards(paragraphs) {
  const texts = paragraphs.map((p) => p.text);
  const startIdx = texts.findIndex((t) => t === "Prigovor (DE / BS)");
  if (startIdx === -1) throw new Error("Could not find objection table header — docx structure changed?");

  const rows = [];
  let i = startIdx + 3; // skip the 3 header cells
  while (i + 2 < texts.length && /^["„]/.test(texts[i])) {
    const objectionRaw = texts[i];
    const responseBs = texts[i + 1];
    const responseDe = texts[i + 2];
    // Strip trailing truncated-repeat artifact: a short fragment (<=6 chars
    // before "...") that duplicates the objection's own opening words.
    const objection = objectionRaw.replace(/\s+[^"„]{1,8}\.\.\.$/, "").trim();
    rows.push({ objection, response_bs: responseBs, response_de: responseDe });
    i += 3;
  }
  return rows;
}

async function main() {
  const paragraphs = extractParagraphs(SKRIPT_PATH);
  console.log(`Extracted ${paragraphs.length} paragraphs from Skript docx.`);

  const { data: doc, error: docErr } = await admin
    .from("kb_documents")
    .insert({
      title: "Agent Sales Guide — Vodič za svakodnevnu prodaju",
      collection: "skript",
      source_path: SKRIPT_PATH,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  console.log(`Created kb_documents row ${doc.id}`);

  const chunks = chunkByHeading(paragraphs);
  console.log(`Chunked into ${chunks.length} sections.`);
  const chunkRows = chunks.map((c, i) => ({
    document_id: doc.id,
    chunk_index: i,
    heading: c.heading,
    content: c.content,
  }));
  const { error: chunkErr } = await admin.from("kb_chunks").insert(chunkRows);
  if (chunkErr) throw chunkErr;
  console.log(`Inserted ${chunkRows.length} kb_chunks.`);

  const objections = extractObjectionCards(paragraphs);
  console.log(`Extracted ${objections.length} objection cards.`);
  const objectionRows = objections.map((o) => ({ ...o, source_document_id: doc.id }));
  const { error: objErr } = await admin.from("objection_cards").insert(objectionRows);
  if (objErr) throw objErr;
  console.log(`Inserted ${objectionRows.length} objection_cards.`);
}

main();
