import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";

import { getAnthropicClient, getModel } from "@/lib/ai/provider.mjs";
import { runChatTurn } from "@/lib/chat/core.mjs";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

// M7 — AI assistant (CLAUDE.md §10, §13). Chat tools run through the
// user's own session (createClient(), not the admin client) so every RPC
// call is subject to normal RLS — §3.2.4 "chat tools = security invoker
// RPCs under user JWT". The tool loop itself lives in lib/chat/core.mjs,
// shared with scripts/chat-acceptance-test.mjs so both exercise the exact
// same logic; this route only handles auth, budget, SSE wiring, and
// chat_log persistence.
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };
type CompanyContext = { id: string; name: string } | null;

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  companyContext: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  const parsedBody = chatRequestSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return new Response("Bad request: invalid body", { status: 400 });
  }
  const history: ChatMessage[] = parsedBody.data.messages;
  const companyContext: CompanyContext = parsedBody.data.companyContext ?? null;

  const lastMessage = history[history.length - 1];
  if (lastMessage.role !== "user" || !lastMessage.content.trim()) {
    return new Response("Bad request: last message must be a non-empty user message", { status: 400 });
  }

  const { data: budgetSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "chat_daily_token_budget")
    .maybeSingle();
  const dailyBudget = typeof budgetSetting?.value === "number" ? budgetSetting.value : 200000;

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: usageRows } = await supabase
    .from("chat_log")
    .select("input_tokens, output_tokens")
    .eq("agent_id", user.id)
    .gte("created_at", startOfDay.toISOString());
  const usedToday = (usageRows ?? []).reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );
  if (usedToday >= dailyBudget) {
    return new Response(JSON.stringify({ error: "daily_budget_exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase.from("chat_log").insert({ agent_id: user.id, role: "user", content: lastMessage.content });

  const anthropic = getAnthropicClient() as Anthropic;
  const model = getModel("chat") as string;
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const { assistantText, pendingAction, inputTokens, outputTokens } = await runChatTurn({
          anthropic,
          model,
          supabase,
          isAdmin,
          companyContext,
          messages,
          onText: (delta: string) => send("text", { delta }),
        });

        if (pendingAction) {
          send("pending_action", pendingAction);
        }

        await supabase.from("chat_log").insert({
          agent_id: user.id,
          role: "assistant",
          content: assistantText,
          tool_calls: pendingAction ? ([pendingAction] as unknown as Json) : null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          model,
        });

        send("done", {});
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
