// CLAUDE.md §14 / M8 follow-up plan (2026-07-25, Anis: "products.season, see if
// you can do own research") — products.season is 0% filled, which keeps
// seasonal_push (§6) permanently dead regardless of feedback/enrichment volume.
//
// Deliberately narrow: only genuinely well-established, generic automotive
// seasonality is used (tire changeover, antifreeze/de-icer, AC service,
// cold-weather battery failure) — never a brand- or model-specific claim.
// Matched by name/subcategory keyword, not blanket category, except
// Reifenmontage (tire-mounting equipment/consumables), where the *entire*
// category is genuinely the seasonal-changeover product line. A wiper-blade
// rule was drafted and dropped: the catalog has zero real wiper-blade
// products, and its only keyword hit was a wiper-ARM-removal tool (not
// genuinely seasonal), confirmed via a sanity-check query before running.
//
// fn_refresh_signals() matches season via
//   (',' || p.season || ',') like '%,' || extract(month from now())::text || ',%'
// — so season must be a comma-separated list of plain month numbers (1-12,
// no leading zero, no spaces).
//
// Idempotent / safely re-runnable: only ever touches rows where season is
// still null, so re-running after new products are added is safe.
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Order matters only in that a product is tagged by the first rule it
// matches (a product cannot get two seasons this pass) — rules are ordered
// most-specific first so e.g. a tire-valve product under Reifenmontage isn't
// double-processed by an unrelated keyword rule.
const RULES = [
  {
    label: "Reifenmontage (Reifenwechsel-Saison: Frühjahr + Herbst)",
    season: "3,4,9,10,11",
    match: { categoryName: "Reifenmontage" },
  },
  {
    // name-only: the catalog's "Lecksuche / Vereiserspray / Starthilfe"
    // subcategory bucket mixes genuine de-icer products with unrelated
    // leak-detection/jump-start sprays — checked directly, subcategory
    // matching would have wrongly tagged those as winter-seasonal too.
    label: "Frostschutz / Enteiser (Winter-Vorbereitung)",
    season: "9,10,11,12,1,2",
    keywords: ["frostschutz", "enteiser", "vereiserspray", "scheibenfrostschutz"],
    fields: ["name"],
  },
  {
    // name+subcategory: checked directly — every subcategory-only hit here
    // (AC valve tools/O-rings, AC cleaner spray head) is a genuine AC-system
    // part, unlike the Frostschutz bucket above.
    label: "Klimaservice (Frühjahr/Sommer-Vorbereitung)",
    season: "3,4,5,6,7",
    keywords: ["klimaanlage", "klimaservice", "kältemittel", "kaeltemittel", "r134a", "r1234yf"],
  },
  {
    // name-only: the catalog's "Verteilerkästen / Batterieklemmen" and
    // "Batterieladegerät / Starthilfe" subcategory buckets mix in generic
    // electrical accessories (distribution boxes, wall mounts) alongside
    // genuine battery items — checked directly, kept to name-only to avoid
    // tagging the unrelated ones.
    label: "Batterie (Kälte-Ausfallsaison)",
    season: "10,11,12,1,2",
    keywords: ["starterbatterie", "batterietester", "batterieklemme", "batteriesäure", "batterieladegerät"],
    fields: ["name"],
  },
];

async function fetchNullSeasonProducts() {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("products")
      .select("id, name, category_name, subcategory")
      .is("season", null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function matches(product, rule) {
  if (rule.match?.categoryName) {
    return product.category_name === rule.match.categoryName;
  }
  const fields = rule.fields ?? ["name", "subcategory"];
  const haystack = fields
    .map((f) => (f === "name" ? product.name : (product.subcategory ?? "")))
    .join(" ")
    .toLowerCase();
  return rule.keywords.some((k) => haystack.includes(k));
}

async function main() {
  const products = await fetchNullSeasonProducts();
  console.log(`Found ${products.length} products with season still null.`);

  const counts = new Map(RULES.map((r) => [r.label, 0]));
  const updatesBySeason = new Map();

  for (const product of products) {
    for (const rule of RULES) {
      if (matches(product, rule)) {
        counts.set(rule.label, counts.get(rule.label) + 1);
        if (!updatesBySeason.has(rule.season)) updatesBySeason.set(rule.season, []);
        updatesBySeason.get(rule.season).push(product.id);
        break;
      }
    }
  }

  let totalUpdated = 0;
  for (const [season, ids] of updatesBySeason) {
    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error } = await admin.from("products").update({ season }).in("id", chunk);
      if (error) throw error;
      totalUpdated += chunk.length;
    }
  }

  console.log("\nPer-rule matches:");
  for (const [label, count] of counts) console.log(`  ${label}: ${count}`);
  console.log(`\nTotal products.season filled: ${totalUpdated}`);
}

main();
