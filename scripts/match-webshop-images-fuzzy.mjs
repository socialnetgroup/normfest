// Fuzzy name-match for the 2,174 catalog products that got no photo from the
// exact-SKU webshop match (scripts/match-webshop-staging.mjs). Root cause of
// the gap: our PDF-extracted SKU sometimes differs from the webshop's SKU for
// the same real product (naming/variant drift), so exact-SKU matching missed
// it even though a real photo for that exact product already sits in our own
// `product-images` storage bucket from the full webshop crawl (7,884 staged
// products still unmatched, 99%+ already have an uploaded image).
//
// This never re-downloads or re-crawls anything - it only reuses images we
// already own. Matching is by word-overlap (Jaccard) on normalized product
// names; only names above CONFIDENCE_THRESHOLD are auto-written, everything
// below is logged as "needs review" and left alone, same "don't guess"
// principle as everywhere else in this project (§9 guardrails).
//
// Usage: node scripts/match-webshop-images-fuzzy.mjs [--dry-run]
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIDENCE_THRESHOLD = 0.6;
const REVIEW_THRESHOLD = 0.4;
const BATCH_SIZE = 500;

const STOPWORDS = new Set([
  "mit", "für", "und", "aus", "des", "der", "die", "das", "von", "im", "in",
  "zu", "an", "auf", "je", "pro", "bis", "ohne", "als", "am", "ca",
]);

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function jaccard(aTokens, bSet) {
  if (aTokens.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const t of aTokens) if (bSet.has(t)) intersection++;
  const union = aTokens.size + bSet.size - intersection;
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

async function main() {
  console.log("Lade Produkte ohne Bild + ungematchte Staging-Produkte mit Bild...");
  const [products, staged] = await Promise.all([
    fetchAll("products", "id, sku, name", (q) => q.is("image_path", null)),
    fetchAll(
      "webshop_products_staging",
      "id, sku, name, image_stored_path",
      (q) => q.is("matched_product_id", null).not("image_stored_path", "is", null),
    ),
  ]);
  console.log(`  ${products.length} Produkte ohne Bild, ${staged.length} ungematchte Kandidaten.\n`);

  console.log("Baue Wort-Index...");
  const stagedTokenized = staged.map((s) => ({ ...s, tokenSet: new Set(normalize(s.name)) }));
  const wordIndex = new Map();
  stagedTokenized.forEach((s, i) => {
    for (const t of s.tokenSet) {
      if (!wordIndex.has(t)) wordIndex.set(t, []);
      wordIndex.get(t).push(i);
    }
  });

  console.log("Vergleiche Namen (Jaccard-Ähnlichkeit)...");
  const accepted = [];
  const forReview = [];
  let done = 0;
  for (const p of products) {
    const pTokens = new Set(normalize(p.name));
    const candidateIdx = new Set();
    for (const t of pTokens) {
      const list = wordIndex.get(t);
      if (list) for (const idx of list) candidateIdx.add(idx);
    }
    let best = null;
    for (const idx of candidateIdx) {
      const s = stagedTokenized[idx];
      const score = jaccard(pTokens, s.tokenSet);
      if (!best || score > best.score) best = { score, staged: s };
    }
    if (best && best.score >= CONFIDENCE_THRESHOLD) {
      accepted.push({ productId: p.id, productName: p.name, sku: p.sku, matchName: best.staged.name, matchSku: best.staged.sku, score: best.score, imagePath: best.staged.image_stored_path });
    } else if (best && best.score >= REVIEW_THRESHOLD) {
      forReview.push({ productName: p.name, sku: p.sku, matchName: best.staged.name, matchSku: best.staged.sku, score: best.score });
    }
    done++;
    if (done % 500 === 0) process.stdout.write(`\r  ${done}/${products.length}`);
  }
  console.log(`\r  ${done}/${products.length}\n`);

  console.log(`Auto-akzeptiert (>= ${CONFIDENCE_THRESHOLD}): ${accepted.length}`);
  console.log(`Zur Prüfung (${REVIEW_THRESHOLD}-${CONFIDENCE_THRESHOLD}): ${forReview.length}`);
  console.log(`Kein Kandidat gefunden: ${products.length - accepted.length - forReview.length}\n`);

  console.log("Stichprobe der akzeptierten Treffer (erste 15):");
  for (const a of accepted.slice(0, 15)) {
    console.log(`  [${a.score.toFixed(2)}] "${a.productName}" (${a.sku}) <- "${a.matchName}" (${a.matchSku})`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: keine Schreibvorgänge ausgeführt.");
    return;
  }

  console.log("\nSchreibe image_path für akzeptierte Treffer...");
  let written = 0;
  for (const batch of chunk(accepted, BATCH_SIZE)) {
    const { error } = await admin.rpc("fn_bulk_set_image_path", {
      pairs: batch.map((a) => ({ product_id: a.productId, image_path: a.imagePath })),
    });
    if (error) console.log(`  Fehler: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  ${written}/${accepted.length}`);
  }
  console.log(`\n\nFertig: ${accepted.length} weitere Produkte haben jetzt ein echtes Foto.`);
}

main();
