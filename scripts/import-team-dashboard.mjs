// Monthly Team Dashboard import (agent daily sales performance).
// Each input/Team Dashboard/*.xlsx has one sheet per agent (name may carry
// Bosnian diacritics inconsistently, e.g. "Alan Šačić" vs agents.full_name
// "Alan Sacic", or an extra middle name "Muhamed Max Lepic" vs "Muhamed
// Lepic") — matched by normalized/subset token comparison, not exact string.
import * as XLSX from "xlsx";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DIR = "input/Team Dashboard";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function tokens(s) {
  return normalize(s).split(/\s+/).filter(Boolean);
}

function matchAgent(sheetName, agents) {
  const sheetTokens = new Set(tokens(sheetName));
  for (const agent of agents) {
    const agentTokens = tokens(agent.full_name);
    if (agentTokens.every((t) => sheetTokens.has(t))) return agent;
  }
  return null;
}

function excelSerialToISODate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function findRowByLabel(rows, label) {
  return rows.find((r) => typeof r[0] === "string" && r[0].trim().toLowerCase() === label.toLowerCase());
}

function parseAgentSheet(rows) {
  const dateRow = rows[2];
  if (!dateRow) return [];
  const totalRow = findRowByLabel(rows, "Total");
  const salesRow = findRowByLabel(rows, "Anzahl von Sales");
  const crRow = findRowByLabel(rows, "CR");
  const callsRow = findRowByLabel(rows, "Anzahl Anrufe");
  if (!totalRow) return [];

  const records = [];
  for (let i = 1; i < dateRow.length - 1; i++) {
    const date = excelSerialToISODate(dateRow[i]);
    if (!date) continue;
    const revenue = totalRow[i];
    if (revenue === undefined || revenue === null || revenue === "") continue;
    const salesCount = salesRow?.[i];
    const callsCount = typeof callsRow?.[i] === "number" ? callsRow[i] : null;
    const crRaw = crRow?.[i];
    const conversionRate = typeof crRaw === "number" ? crRaw : null;
    records.push({
      date,
      revenue: Number(revenue) || 0,
      sales_count: Number(salesCount) || 0,
      calls_count: callsCount,
      conversion_rate: conversionRate,
    });
  }
  return records;
}

async function main() {
  const { data: agents, error: agentsErr } = await admin.from("agents").select("id, full_name, gebiet");
  if (agentsErr) throw agentsErr;
  console.log(`Loaded ${agents.length} agents.`);

  const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
  console.log(`Found ${files.length} Team Dashboard files:`, files);

  const allRecords = [];
  const unmatchedSheets = [];

  for (const file of files) {
    const buf = readFileSync(`${DIR}/${file}`);
    const wb = XLSX.read(buf, { type: "buffer" });
    for (const sheetName of wb.SheetNames) {
      const agent = matchAgent(sheetName, agents);
      if (!agent) {
        unmatchedSheets.push(`${file} :: ${sheetName}`);
        continue;
      }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
      const records = parseAgentSheet(rows);
      for (const r of records) {
        allRecords.push({ agent_id: agent.id, source_file: file, ...r });
      }
    }
  }

  console.log(`\nParsed ${allRecords.length} agent-day rows.`);
  console.log(`Skipped sheets (no agent match, expected for team-rollup sheets):`, unmatchedSheets);

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Sample:", allRecords.slice(0, 5));
    return;
  }

  const batchSize = 500;
  let written = 0;
  for (let i = 0; i < allRecords.length; i += batchSize) {
    const chunk = allRecords.slice(i, i + batchSize);
    const { error } = await admin.from("agent_daily_performance").upsert(chunk, { onConflict: "agent_id,date" });
    if (error) {
      console.error("Upload failed:", error);
      process.exit(1);
    }
    written += chunk.length;
  }
  console.log(`Uploaded ${written} rows.`);
}

main();
