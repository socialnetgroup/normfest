// M3 QA gate close-out (CLAUDE.md §14 item 8): extraction_confidence was
// never computed during the original ingest. Re-running the LLM extraction
// just to get a confidence score would cost real money for no new data —
// instead this computes a deterministic completeness/sanity score directly
// from what's already committed. Weighted 0-1, stored as numeric(3,2):
//   - SKU shape matches the catalog's real Art.-Nr. patterns (0.35) —
//     structural correctness matters most, since a garbled SKU corrupts
//     identity/dedup.
//   - name looks like a real product name, not a fragment (0.35)
//   - description present with real content (0.15)
//   - pack_content present (0.15)
import { createClient } from "@supabase/supabase-js";

if (process.env.NEXT_PUBLIC_SUPABASE_URL === undefined) process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Real Normfest Art.-Nr. shapes observed in the committed data: 2-5 leading
// digits, then 1-3 hyphenated numeric segments (e.g. "2896-531",
// "8000-231-898", "1001-183-04"). Bare short numbers like "06"/"07" are
// almost certainly leftover page numbers misread as SKUs, not real ones.
const SKU_RE = /^\d{2,5}(-\d{1,5}){1,3}$/;

function scoreProduct(p) {
  let score = 0;

  if (SKU_RE.test(p.sku)) score += 0.35;

  const nameOk = p.name && p.name.trim().length >= 4 && /[a-zA-ZÀ-ÿ]/.test(p.name) && p.name.trim() !== p.sku;
  if (nameOk) score += 0.35;

  const descOk = p.description && p.description.trim().length >= 15;
  if (descOk) score += 0.15;

  const packOk = p.pack_content && p.pack_content.trim().length > 0;
  if (packOk) score += 0.15;

  return Math.round(score * 100) / 100;
}

async function pool(items, worker, concurrency) {
  let next = 0;
  let done = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
      done++;
      if (done % 200 === 0 || done === items.length) console.log(`Updated ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

async function main() {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("products")
      .select("id, sku, name, description, pack_content")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Scoring ${all.length} products...`);

  const scored = all.map((p) => ({ id: p.id, extraction_confidence: scoreProduct(p) }));

  await pool(
    scored,
    async (row) => {
      const { error } = await admin
        .from("products")
        .update({ extraction_confidence: row.extraction_confidence })
        .eq("id", row.id);
      if (error) throw error;
    },
    20,
  );

  const buckets = { high: 0, mid: 0, low: 0 };
  for (const s of scored) {
    if (s.extraction_confidence >= 0.8) buckets.high++;
    else if (s.extraction_confidence >= 0.5) buckets.mid++;
    else buckets.low++;
  }
  console.log("Distribution:", buckets);
}

main();
