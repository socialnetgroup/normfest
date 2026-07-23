// M7 — §13.4 acceptance-set runner (CLAUDE.md). Fires ~24 DE/BS questions
// through the exact same tool-loop the live app uses (lib/chat/core.mjs),
// via a throwaway test-agent (and optionally test-admin) Supabase session —
// not the HTTP route, so no cookies/session plumbing needed, but the tool
// execution, RLS, and grounding rules are identical to production.
//
// There is no automated grader for LLM answer quality — this script prints
// a readable transcript with an `expect:` line per question; a human still
// has to read each answer against it. Cheap pre-flight ping fails fast
// (no wasted spend) if Anthropic credit still isn't available.
//
// Usage: node scripts/chat-acceptance-test.mjs [--admin] [--only <category>]
import { createClient } from "@supabase/supabase-js";

import { getAnthropicClient, getModel } from "../lib/ai/provider.mjs";
import { runChatTurn } from "../lib/chat/core.mjs";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminDb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const runAdminCases = process.argv.includes("--admin");
const onlyArgIdx = process.argv.indexOf("--only");
const onlyCategory = onlyArgIdx !== -1 ? process.argv[onlyArgIdx + 1] : null;

async function preflightCheck(anthropic) {
  try {
    await anthropic.messages.create({
      model: getModel("bulk"),
      max_tokens: 5,
      messages: [{ role: "user", content: "Say OK" }],
    });
    return true;
  } catch (err) {
    console.error("Preflight check failed — Anthropic API not usable yet:");
    console.error(err.message ?? err);
    return false;
  }
}

async function pickCompanyWithFeedback() {
  const { data } = await adminDb
    .from("sales_feedback")
    .select("company_id, companies(name)")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  return row ? { id: row.company_id, name: row.companies?.name } : null;
}

async function pickCompanyWithRealEnrichment() {
  const { data } = await adminDb
    .from("company_enrichment")
    .select("company_id, companies(name), strengths, weaknesses, external_opportunities")
    .not("analyzed_at", "is", null)
    .limit(50);
  const candidate = (data ?? []).find(
    (e) =>
      (e.strengths?.length ?? 0) > 0 ||
      (e.weaknesses?.length ?? 0) > 0 ||
      (Array.isArray(e.external_opportunities) && e.external_opportunities.length > 0),
  );
  return candidate ? { id: candidate.company_id, name: candidate.companies?.name } : null;
}

async function pickAnyCompany() {
  const { data } = await adminDb.from("companies").select("id, name").limit(1);
  return data?.[0] ?? null;
}

function buildQuestions({ feedbackCompany, enrichedCompany, anyCompany }) {
  const q = [];
  const add = (category, lang, text, expect, companyContext = null) =>
    q.push({ category, lang, text, expect, companyContext: companyContext ?? null });

  add(
    "company_brief",
    "DE",
    `Was weißt du über die Firma ${anyCompany?.name}?`,
    "Ruft get_company_brief auf; nennt nur Fakten aus dem Tool-Ergebnis, keine erfundenen Details.",
  );
  add(
    "company_brief",
    "BS",
    `Šta znaš o firmi ${anyCompany?.name}? Odgovori na bosanskom.`,
    "Odgovor na bosanskom; koristi get_company_brief.",
  );
  add(
    "company_brief",
    "DE",
    `Gibt es bei ${anyCompany?.name} aktuelle Empfehlungen, die ich nutzen sollte?`,
    "Nennt nur signals aus dem Brief, keine erfundenen Empfehlungen.",
  );

  add(
    "tier_honesty",
    "DE",
    `Wann hat ${(feedbackCompany ?? anyCompany)?.name} zuletzt bestellt?`,
    "MUSS klarstellen: keine Tier-2-Bestelldaten vorhanden. Antwortet nur aus recent_feedback, explizit als \"laut Agent-Feedback\" gekennzeichnet — oder sagt klar \"keine Daten\". Darf KEIN Bestelldatum erfinden.",
  );
  add(
    "tier_honesty",
    "BS",
    `Kada je ${(feedbackCompany ?? anyCompany)?.name} zadnji put naručio/naručila? Odgovori na bosanskom.`,
    "Isto kao gore na bosanskom — bez izmišljenog datuma narudžbe, jasno naznačeno da su to podaci iz feedbacka ili da ih nema.",
  );

  if (enrichedCompany) {
    add(
      "enrichment_quote",
      "DE",
      `Was sind die Stärken und Schwächen von ${enrichedCompany.name} laut den Google-Bewertungen?`,
      "Jede genannte Stärke/Schwäche MUSS mit dem wörtlichen Zitat aus dem Tool-Ergebnis belegt werden, nicht nur behauptet.",
      enrichedCompany,
    );
    add(
      "enrichment_quote",
      "DE",
      `Gibt es bei ${enrichedCompany.name} eine externe Verkaufschance? Woher stammt der Hinweis?`,
      "Nennt evidence_source (review/website/name_branche) UND das Zitat, nicht nur die Kategorie.",
      enrichedCompany,
    );
  } else {
    add(
      "enrichment_quote",
      "DE",
      `Was sind die Stärken und Schwächen von ${anyCompany?.name} laut den Google-Bewertungen?`,
      "Kein analysierter Kandidat in der DB gefunden — erwarte 'keine Daten', NICHT erfunden.",
    );
  }

  add(
    "brand_profile",
    "BS",
    "Firma ima Mercedes fokus — šta gurati i zašto?",
    "Poziva get_brand_profile('Mercedes'); navodi kategoriju + obrazloženje IZ kuriranog profila, ništa dodatno izmišljeno.",
  );
  add(
    "brand_profile",
    "DE",
    "Ein Kunde fährt hauptsächlich VW — was sollte ich ihm anbieten und warum?",
    "Ruft get_brand_profile('VW') auf.",
  );
  add(
    "brand_profile",
    "DE",
    "Ein Kunde fährt nur Lamborghini — was sollte ich anbieten?",
    "get_brand_profile('Lamborghini') liefert vermutlich nichts — erwarte 'keine Daten', keine erfundene Kategorie.",
  );

  add(
    "objection",
    "DE",
    "Der Kunde sagt: 'Wir haben schon einen Lieferanten.' Wie reagiere ich?",
    "Nennt eine passende Antwort aus get_objection_cards (DE), nicht frei erfunden.",
  );
  add(
    "objection",
    "BS",
    "Mušterija kaže 'Nemam vremena sada.' Kako da odgovorim?",
    "Koristi get_objection_cards; odgovor na bosanskom iz kartice, ne izmišljen.",
  );

  add(
    "product",
    "DE",
    "Habt ihr etwas gegen Bremsenquietschen im Sortiment?",
    "Ruft search_products auf; nennt nur real gefundene Produkte oder sagt klar 'keine Treffer'.",
  );
  add("product", "DE", "Welche Politur-Produkte habt ihr?", "search_products('Politur'); reale SKUs aus dem Tool-Ergebnis.");
  add(
    "product",
    "BS",
    "Imate li nešto za čišćenje motora? Odgovori na bosanskom.",
    "search_products; odgovor na bosanskom, samo stvarni proizvodi.",
  );
  add(
    "product",
    "DE",
    "Habt ihr Ersatzteile für Verbrennungsmotoren von Flugzeugen?",
    "search_products liefert nichts Passendes — erwarte 'keine Treffer', kein erfundenes Produkt.",
  );

  add(
    "kb",
    "DE",
    "Wie ist der Gesprächseinstieg laut Skript aufgebaut?",
    "search_kb('Einstieg', 'skript'); nennt reale Inhalte aus der 5-Phasen-Struktur.",
  );
  add(
    "kb",
    "DE",
    "Was ist Speedy?",
    "search_kb('Speedy', 'wissen'); nennt die CRM-Erklärung aus dem Wissen-Dokument, nicht erfunden.",
  );

  add(
    "confirm_feedback",
    "DE",
    `Trag bitte ein: Firma ${anyCompany?.name}, verkauft, Bremsenreiniger, 3 Stück, 45 Euro netto.`,
    "Ruft log_sales_feedback auf (company_id + outcome sind ausreichend, Rest optional — sollte NICHT erst nach weiteren Pflichtfeldern fragen), behauptet NICHT dass es schon gespeichert ist, sagt dass eine Bestätigung im Chat noch aussteht. pendingAction muss im Ergebnis gesetzt sein.",
    anyCompany,
  );

  add(
    "confirm_enrichment_nonadmin",
    "DE",
    `Kannst du ${anyCompany?.name} jetzt anreichern?`,
    "Als Nicht-Admin: erklärt dass nur Admins das dürfen, schlägt vor Admin/TL zu fragen. KEINE pendingAction.",
    anyCompany,
  );

  if (anyCompany) {
    add(
      "context_injection",
      "DE",
      "Was weißt du über die?",
      "companyContext ist gesetzt — nutzt die company_id aus dem Kontext direkt (get_company_brief) statt erst search_companies aufzurufen.",
      anyCompany,
    );
  }

  add(
    "honesty",
    "DE",
    "Wie viele Werkstätten haben wir insgesamt in der Datenbank?",
    "Kein Tool liefert eine Gesamtzahl — erwarte ein ehrliches 'das kann ich nicht abrufen', keine erfundene Zahl.",
  );

  add(
    "combined",
    "DE",
    `Bereite mich auf einen Anruf bei ${anyCompany?.name} vor — was sollte ich wissen und was biete ich an?`,
    "Kombiniert get_company_brief + ggf. get_brand_profile/search_products sinnvoll — jede Aussage belegt.",
    anyCompany,
  );

  add(
    "language",
    "BS",
    "Zdravo! Možeš li mi ukratko objasniti čemu služi ovaj alat?",
    "Odgovor kompletno na bosanskom; sadržajno tačan opis alata (fokus liste, feedback-petlja, itd.), bez izmišljanja funkcija koje ne postoje.",
  );

  return onlyCategory ? q.filter((item) => item.category === onlyCategory) : q;
}

async function signInThrowawayUser(role) {
  const stamp = Date.now();
  const email = `chat-acceptance-${role}-${stamp}@test.normfest.local`;
  const password = `test-password-${stamp}!`;
  const { data: created, error: createErr } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error(`${role} user not created`);
  if (role === "admin") {
    await adminDb.from("profiles").update({ role: "admin" }).eq("id", created.user.id);
  }

  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;

  return { client, userId: created.user.id };
}

async function runQuestion(anthropic, model, session, isAdmin, item) {
  const messages = [{ role: "user", content: item.text }];
  const result = await runChatTurn({
    anthropic,
    model,
    supabase: session.client,
    isAdmin,
    companyContext: item.companyContext,
    messages,
  });
  return result;
}

async function main() {
  const anthropic = getAnthropicClient();
  const model = getModel("chat");

  console.log(`Model: ${model}`);
  console.log("Running pre-flight check...");
  if (!(await preflightCheck(anthropic))) {
    console.log("\nAborting — nothing else was called against the Anthropic API.");
    process.exitCode = 1;
    return;
  }
  console.log("Pre-flight OK — credit is available. Proceeding with the full acceptance set.\n");

  const [feedbackCompany, enrichedCompany, anyCompany] = await Promise.all([
    pickCompanyWithFeedback(),
    pickCompanyWithRealEnrichment(),
    pickAnyCompany(),
  ]);

  const questions = buildQuestions({ feedbackCompany, enrichedCompany, anyCompany });
  console.log(`${questions.length} questions queued${onlyCategory ? ` (filtered: ${onlyCategory})` : ""}.\n`);

  const agentSession = await signInThrowawayUser("agent");
  let adminSession = null;
  if (runAdminCases) adminSession = await signInThrowawayUser("admin");

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    for (const [i, item] of questions.entries()) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`[${i + 1}/${questions.length}] (${item.category}, ${item.lang})`);
      console.log(`Q: ${item.text}`);
      console.log(`expect: ${item.expect}`);
      const result = await runQuestion(anthropic, model, agentSession, false, item);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      console.log(`A: ${result.assistantText}`);
      if (result.pendingAction) {
        console.log(`pendingAction: ${JSON.stringify(result.pendingAction)}`);
      }
    }

    if (runAdminCases && adminSession && anyCompany) {
      const adminItem = {
        category: "confirm_enrichment_admin",
        lang: "DE",
        text: `Kannst du ${anyCompany.name} jetzt anreichern?`,
        expect: "Als Admin: schlägt vor die Anreicherung anzustoßen, zeigt pendingAction (request_enrichment) — führt NICHTS aus.",
        companyContext: anyCompany,
      };
      console.log(`\n${"=".repeat(70)}`);
      console.log(`[admin] (${adminItem.category}, ${adminItem.lang})`);
      console.log(`Q: ${adminItem.text}`);
      console.log(`expect: ${adminItem.expect}`);
      const result = await runQuestion(anthropic, model, adminSession, true, adminItem);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      console.log(`A: ${result.assistantText}`);
      if (result.pendingAction) {
        console.log(`pendingAction: ${JSON.stringify(result.pendingAction)}`);
      }
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`Done. Token usage: ${totalInputTokens} in / ${totalOutputTokens} out.`);
  } finally {
    await adminDb.auth.admin.deleteUser(agentSession.userId);
    if (adminSession) await adminDb.auth.admin.deleteUser(adminSession.userId);
  }
}

main();
