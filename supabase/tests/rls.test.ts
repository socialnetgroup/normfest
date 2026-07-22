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
