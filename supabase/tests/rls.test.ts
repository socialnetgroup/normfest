import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient() {
  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const stamp = Date.now();
const agentEmail = `rls-test-agent-${stamp}@test.normfest.local`;
const adminEmail = `rls-test-admin-${stamp}@test.normfest.local`;
const password = `test-password-${stamp}!`;

let agentId = "";
let adminId = "";

beforeAll(async () => {
  const { data: agentUser, error: agentErr } = await admin.auth.admin.createUser({
    email: agentEmail,
    password,
    email_confirm: true,
  });
  if (agentErr || !agentUser.user) throw agentErr ?? new Error("agent user not created");
  agentId = agentUser.user.id;

  const { data: adminUser, error: adminErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: true,
  });
  if (adminErr || !adminUser.user) throw adminErr ?? new Error("admin user not created");
  adminId = adminUser.user.id;

  const { error: promoteErr } = await admin
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", adminId);
  if (promoteErr) throw promoteErr;
});

afterAll(async () => {
  if (agentId) await admin.auth.admin.deleteUser(agentId);
  if (adminId) await admin.auth.admin.deleteUser(adminId);
});

describe("profiles RLS (fn_is_admin, on_auth_user_created)", () => {
  it("fn_handle_new_user creates a profile row with default role 'agent'", async () => {
    const { data, error } = await admin
      .from("profiles")
      .select("role, email")
      .eq("id", agentId)
      .single();
    expect(error).toBeNull();
    expect(data?.role).toBe("agent");
    expect(data?.email).toBe(agentEmail);
  });

  it("an agent can read their own profile", async () => {
    const client = anonClient();
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: agentEmail,
      password,
    });
    expect(signInErr).toBeNull();

    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", agentId)
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(agentId);
  });

  it("an agent cannot read another user's profile", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", adminId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("an admin can read any profile", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", agentId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(agentId);
  });

  it("an agent cannot promote themselves to admin", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", agentId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: check } = await admin
      .from("profiles")
      .select("role")
      .eq("id", agentId)
      .single();
    expect(check?.role).toBe("agent");
  });
});

describe("settings RLS", () => {
  it("an agent can read settings but cannot write them", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: readData, error: readErr } = await client
      .from("settings")
      .select("key")
      .eq("key", "visibility_mode")
      .single();
    expect(readErr).toBeNull();
    expect(readData?.key).toBe("visibility_mode");

    const { data: writeData, error: writeErr } = await client
      .from("settings")
      .update({ value: "gebiet" })
      .eq("key", "visibility_mode")
      .select();
    expect(writeErr).toBeNull();
    expect(writeData).toEqual([]);
  });

  it("an admin can write settings", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { error } = await client
      .from("settings")
      .update({ value: "shared" })
      .eq("key", "visibility_mode");
    expect(error).toBeNull();

    const { data } = await admin
      .from("settings")
      .select("value")
      .eq("key", "visibility_mode")
      .single();
    expect(data?.value).toBe("shared");
  });
});

describe("fn_is_admin / fn_company_visible RPCs", () => {
  it("fn_is_admin reflects the caller's profile role", async () => {
    const agentClient = anonClient();
    await agentClient.auth.signInWithPassword({ email: agentEmail, password });
    const { data: agentIsAdmin, error: agentErr } = await agentClient.rpc("fn_is_admin");
    expect(agentErr).toBeNull();
    expect(agentIsAdmin).toBe(false);

    const adminClient = anonClient();
    await adminClient.auth.signInWithPassword({ email: adminEmail, password });
    const { data: adminIsAdmin, error: adminErr } = await adminClient.rpc("fn_is_admin");
    expect(adminErr).toBeNull();
    expect(adminIsAdmin).toBe(true);
  });

  it("fn_company_visible defaults to true in 'shared' mode regardless of gebiet", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client.rpc("fn_company_visible", {
      p_gebiet: "some-other-gebiet",
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});

describe("agents / agent_daily_performance RLS (leaderboard — readable by everyone)", () => {
  it("a non-admin agent can read the agents table (leaderboard is team-visible)", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client.from("agents").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("a non-admin agent can read agent_daily_performance (leaderboard is team-visible)", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client.from("agent_daily_performance").select("id").limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("an admin can read both agents and agent_daily_performance", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { data: agentsData, error: agentsErr } = await client.from("agents").select("id");
    expect(agentsErr).toBeNull();
    expect(agentsData!.length).toBeGreaterThan(0);

    const { data: perfData, error: perfErr } = await client
      .from("agent_daily_performance")
      .select("id")
      .limit(1);
    expect(perfErr).toBeNull();
    expect(perfData!.length).toBeGreaterThan(0);
  });
});

describe("fn_log_sale", () => {
  let testAgentId = "";
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const { data, error } = await admin
      .from("agents")
      .insert({ full_name: `RLS Test Agent ${stamp}`, gebiet: `test-${stamp}`, profile_id: agentId })
      .select("id")
      .single();
    if (error) throw error;
    testAgentId = data.id;
  });

  afterAll(async () => {
    if (testAgentId) {
      await admin.from("agent_daily_performance").delete().eq("agent_id", testAgentId);
      await admin.from("agents").delete().eq("id", testAgentId);
    }
  });

  it("logs a sale into today's row and accumulates on a second call", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error: firstErr } = await client.rpc("fn_log_sale", { p_amount: 150 });
    expect(firstErr).toBeNull();

    const { error: secondErr } = await client.rpc("fn_log_sale", { p_amount: 50 });
    expect(secondErr).toBeNull();

    const { data: row } = await admin
      .from("agent_daily_performance")
      .select("revenue, sales_count")
      .eq("agent_id", testAgentId)
      .eq("date", today)
      .single();
    expect(row?.revenue).toBe(200);
    expect(row?.sales_count).toBe(2);
  });

  it("rejects a non-positive amount", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client.rpc("fn_log_sale", { p_amount: 0 });
    expect(error).not.toBeNull();
  });
});

describe("fn_set_day_off (admin-only)", () => {
  let testAgentId = "";
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const { data, error } = await admin
      .from("agents")
      .insert({ full_name: `RLS Day-off Agent ${stamp}`, gebiet: `test-dayoff-${stamp}` })
      .select("id")
      .single();
    if (error) throw error;
    testAgentId = data.id;
  });

  afterAll(async () => {
    if (testAgentId) {
      await admin.from("agent_daily_performance").delete().eq("agent_id", testAgentId);
      await admin.from("agents").delete().eq("id", testAgentId);
    }
  });

  it("a non-admin agent cannot mark someone as off", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client.rpc("fn_set_day_off", {
      p_agent_id: testAgentId,
      p_date: today,
      p_off: true,
    });
    expect(error).not.toBeNull();
  });

  it("an admin can mark someone as off", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { error } = await client.rpc("fn_set_day_off", {
      p_agent_id: testAgentId,
      p_date: today,
      p_off: true,
    });
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("agent_daily_performance")
      .select("day_off")
      .eq("agent_id", testAgentId)
      .eq("date", today)
      .single();
    expect(row?.day_off).toBe(true);
  });
});

describe("sales_feedback RLS", () => {
  let companyId = "";
  let feedbackId = "";

  beforeAll(async () => {
    const { data, error } = await admin.from("companies").select("id").limit(1).single();
    if (error) throw error;
    companyId = data.id;
  });

  afterAll(async () => {
    if (feedbackId) await admin.from("sales_feedback").delete().eq("id", feedbackId);
  });

  it("an agent can log feedback as themselves", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client
      .from("sales_feedback")
      .insert({ agent_id: agentId, company_id: companyId, outcome: "interested", comment: "RLS test" })
      .select("id")
      .single();
    expect(error).toBeNull();
    feedbackId = data!.id;
  });

  it("an agent cannot log feedback as someone else", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client
      .from("sales_feedback")
      .insert({ agent_id: adminId, company_id: companyId, outcome: "interested" });
    expect(error).not.toBeNull();
  });

  it("any authenticated user can read feedback (shared flywheel visibility)", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { data, error } = await client.from("sales_feedback").select("id").eq("id", feedbackId).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(feedbackId);
  });
});

describe("focus_lists / focus_list_items RLS", () => {
  let listId = "";

  afterAll(async () => {
    if (listId) await admin.from("focus_lists").delete().eq("id", listId);
  });

  it("a non-admin agent cannot create a focus list", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client.from("focus_lists").insert({ name: `RLS test list ${stamp}` });
    expect(error).not.toBeNull();
  });

  it("an admin can create a focus list and add items", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: adminEmail, password });

    const { data: list, error: listErr } = await client
      .from("focus_lists")
      .insert({ name: `RLS test list ${stamp}`, active: false })
      .select("id")
      .single();
    expect(listErr).toBeNull();
    listId = list!.id;

    const { data: company } = await admin.from("companies").select("id").limit(1).single();
    const { error: itemErr } = await client
      .from("focus_list_items")
      .insert({ focus_list_id: listId, company_id: company!.id, note: "test" });
    expect(itemErr).toBeNull();

    const { data: product } = await admin.from("products").select("id").limit(1).single();
    const { error: productErr } = await client
      .from("focus_list_products")
      .insert({ focus_list_id: listId, product_id: product!.id, note: "test" });
    expect(productErr).toBeNull();
  });

  it("a non-admin cannot add a product to a focus list", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: product } = await admin.from("products").select("id").limit(1).single();
    const { error } = await client
      .from("focus_list_products")
      .insert({ focus_list_id: listId, product_id: product!.id });
    expect(error).not.toBeNull();
  });

  it("any authenticated user can read a focus list by id (active or not)", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client.from("focus_lists").select("id").eq("id", listId).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(listId);

    const { data: items, error: itemsErr } = await client
      .from("focus_list_items")
      .select("id")
      .eq("focus_list_id", listId);
    expect(itemsErr).toBeNull();
    expect(items!.length).toBe(1);

    const { data: products, error: productsErr } = await client
      .from("focus_list_products")
      .select("id")
      .eq("focus_list_id", listId);
    expect(productsErr).toBeNull();
    expect(products!.length).toBe(1);
  });

  it("the DB rejects a second simultaneously-active list", async () => {
    const { error } = await admin
      .from("focus_lists")
      .insert({ name: `RLS test list 2 ${stamp}`, active: true });
    expect(error).not.toBeNull();
  });
});

describe("signals RLS + fn_refresh_signals", () => {
  it("a non-admin cannot write to signals directly", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: company } = await admin.from("companies").select("id").limit(1).single();
    const { error } = await client.from("signals").insert({
      company_id: company!.id,
      type: "focus_list_push",
      tier: 1,
      score: 1,
      reason: "test",
    });
    expect(error).not.toBeNull();
  });

  it("a non-admin cannot call fn_refresh_signals", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client.rpc("fn_refresh_signals");
    expect(error).not.toBeNull();
  });

  it("an admin can call fn_refresh_signals and any authenticated user can read signals", async () => {
    const adminClient = anonClient();
    await adminClient.auth.signInWithPassword({ email: adminEmail, password });

    const { error: rpcErr } = await adminClient.rpc("fn_refresh_signals");
    expect(rpcErr).toBeNull();

    const agentClient = anonClient();
    await agentClient.auth.signInWithPassword({ email: agentEmail, password });
    const { data, error } = await agentClient.from("signals").select("id").limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("fn_refresh_signals is idempotent (dedup index holds across re-runs)", async () => {
    const { error: first } = await admin.rpc("fn_refresh_signals");
    expect(first).toBeNull();
    const { count: countAfterFirst } = await admin
      .from("signals")
      .select("id", { count: "exact", head: true });

    const { error: second } = await admin.rpc("fn_refresh_signals");
    expect(second).toBeNull();
    const { count: countAfterSecond } = await admin
      .from("signals")
      .select("id", { count: "exact", head: true });

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

describe("product_relations / brand_consumption_profiles RLS", () => {
  afterAll(async () => {
    await admin.from("product_relations").delete().ilike("note", `RLS test%`);
  });

  it("a non-admin cannot write product_relations", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: products } = await admin.from("products").select("id").order("id").limit(2);
    const { error } = await client.from("product_relations").insert({
      product_id: products![0].id,
      related_product_id: products![1].id,
      relation_type: "cross_sell",
      note: `RLS test ${stamp}`,
    });
    expect(error).not.toBeNull();
  });

  it("an admin can write product_relations and any authenticated user can read it", async () => {
    const adminClient = anonClient();
    await adminClient.auth.signInWithPassword({ email: adminEmail, password });

    const { data: products } = await admin.from("products").select("id").order("id").limit(2);
    const { data: rel, error } = await adminClient
      .from("product_relations")
      .insert({
        product_id: products![0].id,
        related_product_id: products![1].id,
        relation_type: "cross_sell",
        note: `RLS test ${stamp}`,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const agentClient = anonClient();
    await agentClient.auth.signInWithPassword({ email: agentEmail, password });
    const { data, error: readErr } = await agentClient
      .from("product_relations")
      .select("id")
      .eq("id", rel!.id)
      .single();
    expect(readErr).toBeNull();
    expect(data?.id).toBe(rel!.id);
  });

  it("a non-admin cannot write brand_consumption_profiles", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client
      .from("brand_consumption_profiles")
      .insert({ brand: `RLS-Test-${stamp}`, category: "Test", note: "test" });
    expect(error).not.toBeNull();
  });
});

describe("company_enrichment / enrichment_jobs RLS (M5)", () => {
  let companyId = "";
  let jobId = "";
  let enrichmentId = "";

  beforeAll(async () => {
    // Pick a company with no existing company_enrichment row — company_id
    // is unique on that table, and real companies get enriched by the
    // actual pipeline (scripts/enrich-*.mjs) outside of tests.
    const { data: enriched } = await admin.from("company_enrichment").select("company_id");
    const enrichedIds = new Set((enriched ?? []).map((e) => e.company_id));
    const { data: candidates } = await admin.from("companies").select("id").limit(50);
    const free = candidates!.find((c) => !enrichedIds.has(c.id));
    companyId = free!.id;
  });

  afterAll(async () => {
    if (enrichmentId) await admin.from("company_enrichment").delete().eq("id", enrichmentId);
    if (jobId) await admin.from("enrichment_jobs").delete().eq("id", jobId);
  });

  it("a non-admin cannot create an enrichment job or enrichment row", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error: jobErr } = await client.from("enrichment_jobs").insert({ company_id: companyId });
    expect(jobErr).not.toBeNull();

    const { error: enrichErr } = await client
      .from("company_enrichment")
      .insert({ company_id: companyId });
    expect(enrichErr).not.toBeNull();
  });

  it("an admin can create a job + enrichment row, and any authenticated user can read them", async () => {
    const adminClient = anonClient();
    await adminClient.auth.signInWithPassword({ email: adminEmail, password });

    const { data: job, error: jobErr } = await adminClient
      .from("enrichment_jobs")
      .insert({ company_id: companyId, status: "pending" })
      .select("id")
      .single();
    expect(jobErr).toBeNull();
    jobId = job!.id;

    const { data: enrichment, error: enrichErr } = await adminClient
      .from("company_enrichment")
      .insert({ company_id: companyId, places_name: "RLS Test Place" })
      .select("id")
      .single();
    expect(enrichErr).toBeNull();
    enrichmentId = enrichment!.id;

    const agentClient = anonClient();
    await agentClient.auth.signInWithPassword({ email: agentEmail, password });

    const { data: readJob, error: readJobErr } = await agentClient
      .from("enrichment_jobs")
      .select("id")
      .eq("id", jobId)
      .single();
    expect(readJobErr).toBeNull();
    expect(readJob?.id).toBe(jobId);

    const { data: readEnrichment, error: readEnrichErr } = await agentClient
      .from("company_enrichment")
      .select("id, places_name")
      .eq("id", enrichmentId)
      .single();
    expect(readEnrichErr).toBeNull();
    expect(readEnrichment?.places_name).toBe("RLS Test Place");
  });
});

describe("chat_log RLS + chat tool RPCs (M7)", () => {
  let companyId = "";
  let agentChatLogId = "";

  beforeAll(async () => {
    const { data: candidates } = await admin.from("companies").select("id, name").limit(1);
    companyId = candidates![0].id;
  });

  afterAll(async () => {
    if (agentChatLogId) await admin.from("chat_log").delete().eq("id", agentChatLogId);
  });

  it("an agent can insert their own chat_log row and read it back", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data, error } = await client
      .from("chat_log")
      .insert({ agent_id: agentId, role: "user", content: "RLS test message" })
      .select("id")
      .single();
    expect(error).toBeNull();
    agentChatLogId = data!.id;

    const { data: readBack, error: readErr } = await client
      .from("chat_log")
      .select("content")
      .eq("id", agentChatLogId)
      .single();
    expect(readErr).toBeNull();
    expect(readBack?.content).toBe("RLS test message");
  });

  it("an agent cannot insert a chat_log row for another agent", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { error } = await client
      .from("chat_log")
      .insert({ agent_id: adminId, role: "user", content: "spoofed" });
    expect(error).not.toBeNull();
  });

  it("an agent cannot read another agent's chat_log row, but an admin can", async () => {
    const adminClient = anonClient();
    await adminClient.auth.signInWithPassword({ email: adminEmail, password });
    const { data: adminOwnRow } = await adminClient
      .from("chat_log")
      .insert({ agent_id: adminId, role: "user", content: "admin-only message" })
      .select("id")
      .single();

    const agentClient = anonClient();
    await agentClient.auth.signInWithPassword({ email: agentEmail, password });
    const { data: agentRead, error: agentReadErr } = await agentClient
      .from("chat_log")
      .select("id")
      .eq("id", adminOwnRow!.id)
      .maybeSingle();
    expect(agentReadErr).toBeNull();
    expect(agentRead).toBeNull(); // filtered out by RLS, not an error

    const { data: adminRead, error: adminReadErr } = await adminClient
      .from("chat_log")
      .select("id")
      .eq("id", adminOwnRow!.id)
      .single();
    expect(adminReadErr).toBeNull();
    expect(adminRead?.id).toBe(adminOwnRow!.id);

    await admin.from("chat_log").delete().eq("id", adminOwnRow!.id);
  });

  it("fn_chat_log_sales_feedback writes as the calling agent, not a spoofed id", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: newId, error } = await client.rpc("fn_chat_log_sales_feedback", {
      p_company_id: companyId,
      p_outcome: "interested",
      p_comment: "RLS test via chat tool",
    });
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("sales_feedback")
      .select("agent_id, outcome, comment")
      .eq("id", newId as string)
      .single();
    expect(row?.agent_id).toBe(agentId);
    expect(row?.outcome).toBe("interested");

    await admin.from("sales_feedback").delete().eq("id", newId as string);
  });

  it("fn_chat_search_companies and fn_chat_get_company_brief return real data under RLS", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: agentEmail, password });

    const { data: company } = await admin.from("companies").select("name").eq("id", companyId).single();

    const { data: searchResults, error: searchErr } = await client.rpc("fn_chat_search_companies", {
      p_query: company!.name.slice(0, 5),
    });
    expect(searchErr).toBeNull();
    expect(searchResults!.some((r) => r.id === companyId)).toBe(true);

    const { data: brief, error: briefErr } = await client.rpc("fn_chat_get_company_brief", {
      p_company_id: companyId,
    });
    expect(briefErr).toBeNull();
    expect((brief as { company: { id: string } }).company.id).toBe(companyId);
  });
});
