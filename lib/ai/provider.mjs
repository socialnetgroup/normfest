// Provider-agnostic model-tier adapter (CLAUDE.md §3.2.9): every AI-using
// feature routes through here instead of hardcoding a model string, so cost
// tier can be swapped/benchmarked in one place. Plain .mjs (not .ts) so both
// Next.js routes and Node CLI scripts can import it without transpilation —
// same reason lib/enrichment/*.mjs is plain JS.
import Anthropic from "@anthropic-ai/sdk";

// bulk: cheap-tier extraction/distillation (catalog PDF, website text).
// analyze: quote-fidelity enrichment ANALYZE step (M5).
// chat: assistant conversations + tool use (M7) — needs reliable tool-use
// and instruction-following, so stays at the same tier as analyze for now.
export const MODEL_TIERS = {
  bulk: "claude-haiku-4-5",
  analyze: "claude-sonnet-5",
  chat: "claude-sonnet-5",
};

export function getModel(task) {
  const model = MODEL_TIERS[task];
  if (!model) throw new Error(`Unknown AI task tier: ${task}`);
  return model;
}

export function getAnthropicClient() {
  return new Anthropic();
}
