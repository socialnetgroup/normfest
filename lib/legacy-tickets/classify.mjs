// Shared classification prompt/schema for the legacy ticket-comment import
// (CLAUDE.md §14 item 135). Anis's own definition: "useful" = a real sale,
// shown interest, or any concretely informative content about a customer's
// situation/products discussed - anything that would help an agent next
// time. "Noise" = pure call-logistics with no real content (didn't answer,
// answering machine, "call back later" with nothing else) - "sve sto
// demotivise, izostavi."
export const MODEL_TASK = "bulk";

// Trimmed for token cost (2026-08-21, real ~184k-row batch, budget-
// constrained) after the first two real test passes already confirmed
// quality - kept every rule that changed a real test result, cut only
// redundant phrasing.
export function buildClassifyPrompt(comment) {
  return (
    `Notiz eines Vertriebsmitarbeiters (Verbrauchsmaterial für Kfz-Werkstätten) nach einem ` +
    `Kundenanruf: "${comment}"\n\n` +
    `useful=true wenn: echte Bestellung/Verkauf (auch nur ein Wort wie "Bestellung"/"bestellt"/ ` +
    `"verkauft" allein zählt bereits als useful, ohne weitere Details nötig), Interesse an ` +
    `Produkten, konkrete Produktnamen die angeboten wurden (auch ohne Interesse - die Info allein ` +
    `zählt), Infos über Kunde/Bedarf, ein genannter Einwand (zu teuer, hat Lieferant), oder sonst ` +
    `echter Inhalt.\n` +
    `useful=false wenn: nicht erreicht, Anrufbeantworter, keine Info, reine Anruf-Logistik.`
  );
}

export function buildClassifySchema() {
  return {
    type: "object",
    properties: { useful: { type: "boolean" } },
    required: ["useful"],
    additionalProperties: false,
  };
}

/** Builds one Message Batches API request item for one legacy comment row. */
export function buildClassifyBatchRequest(row, model) {
  return {
    custom_id: row.id,
    params: {
      model,
      max_tokens: 50,
      messages: [{ role: "user", content: buildClassifyPrompt(row.comment) }],
      output_config: { format: { type: "json_schema", schema: buildClassifySchema() } },
    },
  };
}
