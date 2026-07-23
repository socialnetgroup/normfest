// M7 — shared chat tool-loop logic (CLAUDE.md §10). Plain .mjs, same reason
// as lib/enrichment/*.mjs: both app/api/chat/route.ts (SSE, streams to a
// browser) and scripts/chat-acceptance-test.mjs (CLI, no streaming) need the
// exact same tool-calling behavior — duplicating it would let the two drift.
export const CONFIRM_ONLY_TOOLS = new Set(["log_sales_feedback", "request_enrichment"]);

export const TOOLS = [
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

export function systemPrompt({ isAdmin, companyContext }) {
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
    "- get_objection_cards liefert jede Karte in DE UND BS zusammen. Wenn du eine Karte präsentierst, führe IMMER mit der Sprache des Agenten (aus seiner letzten Nachricht erkennbar), nicht standardmäßig mit Deutsch — das gilt auch, wenn der Rest deiner Antwort schon in dieser Sprache ist.",
    `\nDieser Agent ist ${isAdmin ? "Admin" : "kein Admin"} — request_enrichment ${isAdmin ? "steht ihm zur Verfügung" : "biete ihm daher nicht aktiv an, sondern verweise auf Admin/TL"}.`,
    companyContext
      ? `\nDer Agent schaut sich gerade das Profil von "${companyContext.name}" an (company_id: ${companyContext.id}). Wenn sich die Frage erkennbar darauf bezieht, nutze diese ID direkt mit get_company_brief statt erst zu suchen.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function executeReadTool(supabase, name, input) {
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

/**
 * Runs the full tool-calling loop for one user turn. `messages` is mutated
 * in place (assistant/tool_result turns appended) so the caller can persist
 * or re-send it. `onText` is optional — the SSE route uses it to stream
 * deltas to the browser; the CLI acceptance-test script omits it and just
 * reads the returned assistantText.
 */
export async function runChatTurn({ anthropic, model, supabase, isAdmin, companyContext, messages, onText, maxTurns = 6 }) {
  let assistantText = "";
  let pendingAction = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastMessage = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const anthropicStream = anthropic.messages.stream({
      model,
      max_tokens: 2000,
      system: systemPrompt({ isAdmin, companyContext }),
      tools: TOOLS,
      messages,
    });

    anthropicStream.on("text", (delta) => {
      assistantText += delta;
      if (onText) onText(delta);
    });

    const message = await anthropicStream.finalMessage();
    lastMessage = message;
    totalInputTokens += message.usage.input_tokens;
    totalOutputTokens += message.usage.output_tokens;
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") break;

    const toolUseBlocks = message.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const input = block.input ?? {};

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
          content: `Fehler: ${err.message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!assistantText.trim()) {
    // §10 M7 finding (2026-07-23): this happened once in the acceptance set with
    // no way to tell why — log enough to diagnose it if/when it recurs.
    console.error("runChatTurn: empty assistantText", {
      stop_reason: lastMessage?.stop_reason,
      block_types: lastMessage?.content?.map((b) => b.type),
      turns_used: messages.filter((m) => m.role === "assistant").length,
    });
    assistantText =
      "Entschuldigung, ich konnte keine abschließende Antwort erzeugen. Bitte versuche es erneut oder formuliere die Frage anders.";
    if (onText) onText(assistantText);
  }

  return { assistantText, pendingAction, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
