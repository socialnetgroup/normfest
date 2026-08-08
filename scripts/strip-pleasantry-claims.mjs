// One-off cleanup (2026-08-08), Anis: strip existing Stärken/Schwächen
// claims that are pure friendliness/mood judgments with zero concrete
// service/product content, matching the tightened ANALYZE prompt
// (lib/enrichment/analyze.mjs, CLAUDE.md §14 item 27) - without spending
// real Anthropic credit on a full re-analysis. Deliberately conservative:
// only strips a claim when the ENTIRE claim matches (not a substring), so
// a mixed claim like "Freundlicher Service und hohe fachliche Kompetenz"
// is left untouched rather than risk losing real content a keyword match
// can't judge as well as the LLM could. Dry-run first (--dry-run), confirmed
// against real data (93 of 5,276 claims) before running for real.
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PURE_PATTERNS = [
  /^(sehr )?(freundlich|nett|hilfsbereit|zuvorkommend|höflich|sympathisch|kompetent|professionell|angenehm)(e|er|es|en)?( und (freundlich|nett|hilfsbereit|zuvorkommend|höflich|sympathisch|kompetent|professionell|angenehm)(e|er|es|en)?)*\s+(team|personal|mitarbeiter(in)?|service|umgang|beratung|kundenservice)\.?$/i,
  /^(sehr )?(freundlich|nett|hilfsbereit|zuvorkommend|höflich|sympathisch)(e|er|es|en)?( und (freundlich|nett|hilfsbereit|zuvorkommend|höflich|sympathisch)(e|er|es|en)?)*\s+(team|personal|mitarbeiter(in)?|service|umgang|beratung|kundenservice)\s+wird\s+(gelobt|hervorgehoben|explizit hervorgehoben|positiv erwähnt)\.?$/i,
  /^(hohe )?kundenzufriedenheit( und kulanz)?\.?$/i,
];

function isPure(claim) {
  return PURE_PATTERNS.some((p) => p.test(claim.trim()));
}

const dryRun = process.argv.includes("--dry-run");

// Real bug caught after the first run: no pagination meant PostgREST's
// default 1000-row cap silently limited this to the first 1000 of 1432
// real rows, leaving 432 companies never checked. Page through all of them.
const data = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data: page, error } = await admin
    .from("company_enrichment")
    .select("company_id, strengths, weaknesses")
    .not("strengths", "is", null)
    .range(from, from + PAGE - 1);
  if (error) throw error;
  data.push(...page);
  if (page.length < PAGE) break;
}
console.log(`Fetched ${data.length} company_enrichment rows.`);

let rowsChanged = 0;
let claimsStripped = 0;

for (const row of data) {
  const newStrengths = (row.strengths || []).filter((c) => !isPure(c));
  const newWeaknesses = (row.weaknesses || []).filter((c) => !isPure(c));
  const removedCount =
    (row.strengths || []).length - newStrengths.length + (row.weaknesses || []).length - newWeaknesses.length;
  if (removedCount === 0) continue;

  if (!dryRun) {
    const { error: updErr } = await admin
      .from("company_enrichment")
      .update({ strengths: newStrengths, weaknesses: newWeaknesses })
      .eq("company_id", row.company_id);
    if (updErr) {
      console.error("update failed for", row.company_id, updErr.message);
      continue;
    }
  }
  rowsChanged++;
  claimsStripped += removedCount;
}

console.log(`${dryRun ? "[dry-run] Would update" : "Updated"} ${rowsChanged} companies, ${claimsStripped} claims stripped.`);
