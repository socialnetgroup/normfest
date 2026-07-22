// One-time/re-run VIS-list import (CLAUDE.md §11.2). Reads input/VIS.xlsx,
// maps columns by index (the sheet has duplicate headers — "NAME" and
// "Verantwortlicher" each appear twice — so header-based lookups are unsafe),
// coerces types, validates with zod, and upserts into `companies` on
// `kundennummer` conflict via the service-role client (bypasses RLS).
import * as XLSX from "xlsx";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COL = {
  gebiet: 0,
  gebiet_agent_name: 1,
  kundennummer: 2,
  name: 3,
  name_2: 4,
  land: 5,
  plz: 6,
  ort: 7,
  strasse: 8,
  order_count: 9,
  article_count: 10,
  last_visit_date: 11,
  last_contact_date: 12,
  last_invoice_period: 13,
  revenue_prior_prior_year: 14,
  revenue_prior_year: 15,
  revenue_current_year: 16,
  revenue_forecast: 17,
  revenue_delta: 18,
  size_class: 19,
  call_priority: 20,
  do_not_contact: 21,
  branche_code: 22,
  branche_name: 23,
  cluster: 24,
  potential_value: 25,
  potential_utilization_pct: 26,
  gruppe: 29,
  verband: 32,
  telefon: 36,
  email: 37,
  dunning_level: 38,
  legacy_gebiet: 40,
  last_review_date: 41,
  revenue_current_year_ds_cod: 43,
  soft_deleted_at: 45,
};

function nullIfBlank(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNumber(v) {
  const s = nullIfBlank(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function excelSerialToISODate(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

const companySchema = z.object({
  kundennummer: z.string().min(1),
  name: z.string().min(1),
  name_2: z.string().nullable(),
  gebiet: z.string().min(1),
  gebiet_agent_name: z.string().nullable(),
  legacy_gebiet: z.string().nullable(),
  land: z.string().min(1),
  plz: z.string().nullable(),
  ort: z.string().nullable(),
  strasse: z.string().nullable(),
  telefon: z.string().nullable(),
  email: z.string().nullable(),
  do_not_contact: z.boolean(),
  branche_code: z.string().nullable(),
  branche_name: z.string().nullable(),
  cluster: z.string().nullable(),
  verband: z.string().nullable(),
  gruppe: z.string().nullable(),
  size_class: z.string().nullable(),
  potential_value: z.number().nullable(),
  potential_utilization_pct: z.number().nullable(),
  dunning_level: z.number().int().nullable(),
  call_priority: z.boolean(),
  last_visit_date: z.string().nullable(),
  last_contact_date: z.string().nullable(),
  last_invoice_period: z.string().nullable(),
  last_review_date: z.string().nullable(),
  revenue_prior_prior_year: z.number().nullable(),
  revenue_prior_year: z.number().nullable(),
  revenue_current_year: z.number().nullable(),
  revenue_current_year_ds_cod: z.number().nullable(),
  revenue_forecast: z.number().nullable(),
  revenue_delta: z.number().nullable(),
  order_count: z.number().int().nullable(),
  article_count: z.number().int().nullable(),
  source_row_number: z.number().int(),
});

function mapRow(row, rowNumber) {
  const kundennummer = nullIfBlank(row[COL.kundennummer]);
  const name = nullIfBlank(row[COL.name]);
  const gebiet = nullIfBlank(row[COL.gebiet]);
  if (!kundennummer || !name || !gebiet) return { skip: true, rowNumber, reason: "missing kundennummer/name/gebiet" };

  const gesperrt = (nullIfBlank(row[COL.do_not_contact]) ?? "").toLowerCase();
  const alarm = nullIfBlank(row[COL.call_priority]);

  const record = {
    kundennummer,
    name,
    name_2: nullIfBlank(row[COL.name_2]),
    gebiet,
    gebiet_agent_name: nullIfBlank(row[COL.gebiet_agent_name]),
    legacy_gebiet: nullIfBlank(row[COL.legacy_gebiet]),
    land: nullIfBlank(row[COL.land]) ?? "DEU",
    plz: nullIfBlank(row[COL.plz]),
    ort: nullIfBlank(row[COL.ort]),
    strasse: nullIfBlank(row[COL.strasse]),
    telefon: nullIfBlank(row[COL.telefon]),
    email: nullIfBlank(row[COL.email]),
    do_not_contact: gesperrt === "ja",
    branche_code: nullIfBlank(row[COL.branche_code]),
    branche_name: nullIfBlank(row[COL.branche_name]),
    cluster: nullIfBlank(row[COL.cluster]),
    verband: nullIfBlank(row[COL.verband]),
    gruppe: nullIfBlank(row[COL.gruppe]),
    size_class: nullIfBlank(row[COL.size_class]),
    potential_value: toNumber(row[COL.potential_value]),
    potential_utilization_pct: toNumber(row[COL.potential_utilization_pct]),
    dunning_level: toInt(row[COL.dunning_level]),
    call_priority: alarm !== null,
    last_visit_date: excelSerialToISODate(row[COL.last_visit_date]),
    last_contact_date: excelSerialToISODate(row[COL.last_contact_date]),
    last_invoice_period: nullIfBlank(row[COL.last_invoice_period]),
    last_review_date: excelSerialToISODate(row[COL.last_review_date]),
    revenue_prior_prior_year: toNumber(row[COL.revenue_prior_prior_year]),
    revenue_prior_year: toNumber(row[COL.revenue_prior_year]),
    revenue_current_year: toNumber(row[COL.revenue_current_year]),
    revenue_current_year_ds_cod: toNumber(row[COL.revenue_current_year_ds_cod]),
    revenue_forecast: toNumber(row[COL.revenue_forecast]),
    revenue_delta: toNumber(row[COL.revenue_delta]),
    order_count: toInt(row[COL.order_count]),
    article_count: toInt(row[COL.article_count]),
    source_row_number: rowNumber,
  };

  const parsed = companySchema.safeParse(record);
  if (!parsed.success) {
    return { skip: true, rowNumber, reason: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { skip: false, record: parsed.data };
}

async function main() {
  const buf = readFileSync("input/VIS.xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const data = rows.slice(1);

  const records = [];
  const skipped = [];
  data.forEach((row, i) => {
    const result = mapRow(row, i + 2); // +2: 1-based, +1 for header row
    if (result.skip) skipped.push(result);
    else records.push(result.record);
  });

  console.log(`Parsed ${records.length} valid rows, skipped ${skipped.length}`);
  if (skipped.length > 0) console.log("Skipped sample:", skipped.slice(0, 10));

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Dry run — not writing. Sample record:", records[0]);
    return;
  }

  const batchSize = 1000;
  let written = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await admin.from("companies").upsert(batch, { onConflict: "kundennummer" });
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} failed:`, error);
      process.exit(1);
    }
    written += batch.length;
    console.log(`Upserted ${written}/${records.length}`);
  }

  console.log("Done.");
}

main();
