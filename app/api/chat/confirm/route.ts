import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// M7 — executes the one write tool the chat assistant can propose
// (§3.2.5 "confirm-before-write UX"). Runs through the user's own session,
// so fn_chat_log_sales_feedback's security-invoker RLS still applies —
// this route is a confirmation gate, not a privilege escalation.
const payloadSchema = z.object({
  company_id: z.string().uuid(),
  outcome: z.enum(["sold", "rejected", "not_relevant", "keine_zeit", "nicht_besucht"]),
  product_id: z.string().uuid().optional(),
  qty: z.number().int().optional(),
  value_net: z.number().optional(),
  objection: z.string().optional(),
  comment: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { action?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "log_sales_feedback") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const p = parsed.data;

  const { data, error } = await supabase.rpc("fn_chat_log_sales_feedback", {
    p_company_id: p.company_id,
    p_outcome: p.outcome,
    p_product_id: p.product_id,
    p_qty: p.qty,
    p_value_net: p.value_net,
    p_objection: p.objection,
    p_comment: p.comment,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data });
}
