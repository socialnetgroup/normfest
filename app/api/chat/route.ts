import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";

import { getAnthropicClient, getModel } from "@/lib/ai/provider.mjs";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

// M7 — AI assistant (CLAUDE.md §10, §13). Chat tools run through the
// user's own session (createClient(), not the admin client) so every RPC
// call is subject to normal RLS — §3.2.4 "chat tools = security invoker
// RPCs under user JWT". Read-only tools execute inline; log_sales_feedback
// and request_enrichment never execute here (§3.2.5) — they only produce a
// pending_action event for the client to render as a confirm card.
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };
type CompanyContext = { id: string; name: string } | null;

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
  companyContext: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});

const CONFIRM_ONLY_TOOLS = new Set(["log_sales_feedback", "request_enrichment"]);

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_companies",
    description:
      "Findet Firmen per Name oder Kundennummer. Nutze das, um eine vom Agenten genannte Firma zu einer company_id aufzulösen, bevor du get_company_brief aufrufst.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Firmenname (oder Teil davon) oder Kundennummer" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_company_brief",
    description:
      "Liefert das vollständige Firmenprofil: Stammdaten, letzte Feedback-Einträge (laut Agent-Feedback, kein Tier-2-Bestelldatum), aktuelle Empfehlungen/Signale, und KI-Anreicherung (Stärken/Schwächen/externe Chancen — jede mit wörtlichem Zitat als Beleg). Rufe das IMMER zuerst auf, bevor du irgendetwas Konkretes über eine Firma behauptest.",
    input_schema: {
      type: "object",
      properties: { company_id: { type: "string", description: "UUID der Firma" } },
      required: ["company_id"],
    },
  },
  {
    name: "get_brand_profile",
    description:
      "Liefert kuratierte Marke→Kategorie-Verbrauchsprofile (z.B. Mercedes-Motoren → höherer Ölverbrauch) für die Gesprächsvorbereitung.",
    input_schema: {
      type: "object",
      properties: { brand: { type: "string", description: "Automarke, z.B. 'Mercedes', 'VW', 'BMW'" } },
      required: ["brand"],
    },
  },
  {
    name: "search_products",
    description: "Durchsucht den Produktkatalog nach Name/Beschreibung, optional gefiltert nach Kategorie.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string", description: "Optional: exakter Kategoriename aus dem Katalog" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_kb",
    description:
      "Durchsucht Skript (Gesprächsleitfaden, 5-Phasen-Struktur, Formulierungen) und Wissen (Hintergrundwissen) per Volltextsuche.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        collection: { type: "string", enum: ["skript", "wissen"], description: "Optional: nur eine Sammlung durchsuchen" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_objection_cards",
    description:
      "Liefert alle dokumentierten Kundeneinwände mit eingeübten Antworten (DE + BS). Rufe das auf, sobald ein Einwand erwähnt wird oder danach gefragt wird, wie man ihn behandelt.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "log_sales_feedback",
    description:
      "Schlägt vor, ein Anrufergebnis zu erfassen (sold/interested/rejected/not_relevant). WICHTIG: Dieser Aufruf führt NICHTS aus — er zeigt dem Agenten nur eine Bestätigungskarte im Chat. Sag dem Agenten, dass er die Karte bestätigen muss; behaupte NIE, dass das Feedback schon gespeichert wurde.",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string" },
        outcome: { type: "string", enum: ["sold", "interested", "rejected", "not_relevant"] },
        product_id: { type: "string" },
        qty: { type: "integer" },
        value_net: { type: "number" },
        objection: { type: "string" },
        comment: { type: "string" },
      },
      required: ["company_id", "outcome"],
    },
  },
  {
    name: "request_enrichment",
    description:
      "Schlägt vor, die KI-Anreicherung (Google-Bewertungen, Website, Analyse) für eine Firma anzustoßen — kostet echtes Geld (Places + Anthropic API). Nur für Admins. Führt NICHTS aus — zeigt nur eine Bestätigungskarte.",
    input_schema: {
      type: "object",
      properties: { company_id: { type: "string" } },
      required: ["company_id"],
    },
  },
];

function systemPrompt({ isAdmin, companyContext }: { isAdmin: boolean; companyContext: CompanyContext }) {
  return [
    "Du bist der persönliche Sales Assistant für einen Normfest-Telesales-Agenten (Outbound, deutsche Kfz-Werkstätten).",
    "Antworte auf Deutsch, außer der Agent schreibt auf Bosnisch/Kroatisch/Serbisch — dann antworte in derselben Sprache.",
    "",
    "Grounding-Regeln (nicht verhandelbar):",
    "- Behaupte nichts Konkretes über eine Firma, ein Produkt, oder das Wissen/Skript, ohne vorher das passende Tool aufzurufen.",
    "- Fakten aus company_enrichment (Stärken/Schwächen/externe Chancen) sind KI-Interpretation externer Quellen — gib beim Antworten IMMER das mitgelieferte Zitat mit an, nicht nur die Behauptung.",
    "- Es gibt (noch) keine Tier-2-Bestelldaten (echte Rechnungen/Aufträge). Wenn nach dem letzten Kauf/der letzten Bestellung gefragt wird, antworte nur aus recent_feedback und kennzeichne es explizit als \"laut Agent-Feedback\" — oder sag klar, dass dazu keine Daten vorliegen. Erfinde nie ein Bestelldatum.",
    "- Wenn ein Tool keine Daten liefert, sag \"dazu habe ich keine Daten\" statt zu raten.",
    "- log_sales_feedback und request_enrichment führen bei Aufruf NICHTS aus — sie zeigen dem Agenten nur eine Bestätigungskarte. Sag danach explizit, dass die Bestätigung im Chat noch aussteht.",
    "- request_enrichment ist admin-only; wenn ein Nicht-Admin danach fragt, erkläre das und schlage vor, den Admin/TL zu fragen.",
    `\nDieser Agent ist ${isAdmin ? "Admin" : "kein Admin"} — request_enrichment ${isAdmin ? "steht ihm zur Verfügung" : "biete ihm daher nicht aktiv an, sondern verweise auf Admin/TL"}.`,
    companyContext
      ? `\nDer Agent schaut sich gerade das Profil von "${companyContext.name}" an (company_id: ${companyContext.id}). Wenn sich die Frage erkennbar darauf bezieht, nutze diese ID direkt mit get_company_brief statt erst zu suchen.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function executeReadTool(
  supabase: SupabaseClient<Database>,
  name: string,
  input: Record<string, unknown>,
) {
  switch (name) {
    case "search_companies":
      return (await supabase.rpc("fn_chat_search_companies", { p_query: String(input.query ?? "") })).data;
    case "get_company_brief":
      return (await supabase.rpc("fn_chat_get_company_brief", { p_company_id: String(input.company_id ?? "") })).data;
    case "get_brand_profile":
      return (await supabase.rpc("fn_chat_get_brand_profile", { p_brand: String(input.brand ?? "") })).data;
    case "search_products":
      return (
        await supabase.rpc("fn_chat_search_products", {
          p_query: String(input.query ?? ""),
          p_category: input.category ? String(input.category) : undefined,
        })
      ).data;
    case "search_kb":
      return (
        await supabase.rpc("fn_chat_search_kb", {
          p_query: String(input.query ?? ""),
          p_collection: input.collection ? String(input.collection) : undefined,
        })
      ).data;
    case "get_objection_cards":
      return (await supabase.rpc("fn_chat_list_objection_cards")).data;
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

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

      let assistantText = "";
      let pendingAction: { action: string; payload: unknown } | null = null;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      try {
        for (let turn = 0; turn < 6; turn++) {
          const anthropicStream = anthropic.messages.stream({
            model,
            max_tokens: 2000,
            system: systemPrompt({ isAdmin, companyContext }),
            tools: TOOLS,
            messages,
          });

          anthropicStream.on("text", (delta: string) => {
            assistantText += delta;
            send("text", { delta });
          });

          const message = await anthropicStream.finalMessage();
          totalInputTokens += message.usage.input_tokens;
          totalOutputTokens += message.usage.output_tokens;
          messages.push({ role: "assistant", content: message.content });

          if (message.stop_reason !== "tool_use") break;

          const toolUseBlocks = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of toolUseBlocks) {
            const input = (block.input ?? {}) as Record<string, unknown>;

            if (CONFIRM_ONLY_TOOLS.has(block.name)) {
              if (block.name === "request_enrichment" && !isAdmin) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "Nur Admins können eine Anreicherung anstoßen. Bitte den Admin/TL bitten.",
                });
                continue;
              }
              pendingAction = { action: block.name, payload: input };
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content:
                  "Vorschlag als Bestätigungskarte angezeigt. Noch NICHT ausgeführt — warte auf Bestätigung durch den Agenten.",
              });
              continue;
            }

            try {
              const result = await executeReadTool(supabase, block.name, input);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result ?? null),
              });
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: `Fehler: ${(err as Error).message}`,
                is_error: true,
              });
            }
          }

          messages.push({ role: "user", content: toolResults });
        }

        if (!assistantText.trim()) {
          assistantText =
            "Entschuldigung, ich konnte keine abschließende Antwort erzeugen. Bitte versuche es erneut oder formuliere die Frage anders.";
          send("text", { delta: assistantText });
        }

        if (pendingAction) {
          send("pending_action", pendingAction);
        }

        await supabase.from("chat_log").insert({
          agent_id: user.id,
          role: "assistant",
          content: assistantText,
          tool_calls: pendingAction ? ([pendingAction] as unknown as Json) : null,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
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
