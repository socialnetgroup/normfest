// Closes the remaining product-photo gap (Anis, 2026-07-25): for products
// with no real photo of their own (no exact/fuzzy webshop match), borrow the
// photo of the closest similar product already in our own catalog rather
// than leave the Katalog page empty. "Similar" = same subcategory first
// (tight), falling back to same top-level category if the subcategory has
// no photographed member at all; within the candidate pool, pick the
// closest match by name-word-overlap.
//
// Every borrowed photo is flagged (products.image_is_representative, set via
// fn_flag_representative_images() after this script writes image_path) so
// the Katalog UI can badge it "Beispielbild" instead of presenting it as the
// product's own photo - same provenance discipline as everywhere else in
// this project (nothing here is silently blended with a real own-photo).
//
// Usage: node scripts/fill-representative-images.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

const STOPWORDS = new Set([
  "mit", "für", "und", "aus", "des", "der", "die", "das", "von", "im", "in",
  "zu", "an", "auf", "je", "pro", "bis", "ohne", "als", "am", "ca",
]);

function normalize(name) {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function fetchAll(table, columns, filterFn) {
  let all = [];
  let from = 0;
  for (;;) {
    let q = admin.from(table).select(columns).range(from, from + 999);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function subKey(p) {
  return `${p.category_code}|${p.category_name}|${p.subcategory ?? ""}`;
}
function catKey(p) {
  return `${p.category_code}|${p.category_name}`;
}

async function main() {
  console.log("Lade alle Produkte...");
  const products = await fetchAll(
    "products",
    "id, sku, name, category_code, category_name, subcategory, image_path",
  );
  const withImage = products.filter((p) => p.image_path);
  const withoutImage = products.filter((p) => !p.image_path);
  console.log(`  ${products.length} Produkte gesamt, ${withImage.length} mit Foto, ${withoutImage.length} ohne.\n`);

  const pool = withImage.map((p) => ({ ...p, tokenSet: normalize(p.name) }));
  const bySubKey = new Map();
  const byCatKey = new Map();
  for (const p of pool) {
    const sk = subKey(p);
    const ck = catKey(p);
    if (!bySubKey.has(sk)) bySubKey.set(sk, []);
    bySubKey.get(sk).push(p);
    if (!byCatKey.has(ck)) byCatKey.set(ck, []);
    byCatKey.get(ck).push(p);
  }

  console.log("Suche ähnlichstes Produkt je fehlendem Foto...");
  // A representative photo is only ever accepted if the candidate shares at
  // least one real word with the product's own name (score > 0). Same
  // subcategory or category alone is not enough - spot-checked the zero-
  // overlap cases first (e.g. a specific paint-color spray can matching a
  // generic "spray nozzle accessory" just because both sit in "Lackierung")
  // and confirmed they're genuinely misleading, not just imprecise. Those
  // are left with no image rather than a wrong one - same "don't fabricate"
  // principle as the exact/fuzzy webshop matches above.
  function bestMatch(pTokens, candidates) {
    if (!candidates || candidates.length === 0) return null;
    let best = null;
    for (const c of candidates) {
      const score = jaccard(pTokens, c.tokenSet);
      if (!best || score > best.score) best = { score, c };
    }
    return best;
  }

  const assignments = [];
  const unresolved = [];
  let usedSubcategory = 0;
  let usedCategory = 0;
  for (const p of withoutImage) {
    const pTokens = normalize(p.name);
    let match = bestMatch(pTokens, bySubKey.get(subKey(p)));
    let tier = "subcategory";
    if (!match || match.score === 0) {
      const catMatch = bestMatch(pTokens, byCatKey.get(catKey(p)));
      if (catMatch && catMatch.score > 0) {
        match = catMatch;
        tier = "category";
      } else if (!match) {
        match = catMatch;
        tier = "category";
      }
    }
    if (!match || match.score === 0) {
      unresolved.push(p);
      continue;
    }
    assignments.push({ productId: p.id, productName: p.name, imagePath: match.c.image_path, sourceName: match.c.name, score: match.score, tier });
    if (tier === "subcategory") usedSubcategory++;
    else usedCategory++;
  }

  console.log(`  Zugeordnet über Unterkategorie: ${usedSubcategory}`);
  console.log(`  Zugeordnet über Kategorie (Unterkategorie ohne Foto-Kandidat): ${usedCategory}`);
  console.log(`  Kein Kandidat gefunden (bleibt ohne Bild): ${unresolved.length}\n`);

  console.log("Stichprobe (erste 15):");
  for (const a of assignments.slice(0, 15)) {
    console.log(`  [${a.tier}, score ${a.score.toFixed(2)}] "${a.productName}" <- "${a.sourceName}"`);
  }
  if (unresolved.length > 0) {
    console.log("\nOhne jeden Kandidaten:");
    for (const u of unresolved) console.log(`  ${u.sku} "${u.name}" (${u.category_name} / ${u.subcategory ?? "-"})`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: keine Schreibvorgänge ausgeführt.");
    return;
  }

  console.log("\nSchreibe image_path (Beispielbilder)...");
  let written = 0;
  for (const batch of chunk(assignments, BATCH_SIZE)) {
    const { error } = await admin.rpc("fn_bulk_set_image_path", {
      pairs: batch.map((a) => ({ product_id: a.productId, image_path: a.imagePath })),
    });
    if (error) console.log(`  Fehler: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  ${written}/${assignments.length}`);
  }
  console.log();

  console.log("Markiere alle Beispielbilder (image_is_representative)...");
  const { error: flagError } = await admin.rpc("fn_flag_representative_images");
  if (flagError) console.log(`  Fehler: ${flagError.message}`);

  console.log(`\nFertig: ${assignments.length} weitere Produkte haben jetzt ein Beispielbild.`);
}

main();
