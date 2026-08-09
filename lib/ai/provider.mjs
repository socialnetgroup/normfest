// Provider-agnostic model-tier adapter (CLAUDE.md §3.2.9): every AI-using
// feature routes through here instead of hardcoding a model string, so cost
// tier can be swapped/benchmarked in one place. Plain .mjs (not .ts) so both
// Next.js routes and Node CLI scripts can import it without transpilation —
// same reason lib/enrichment/*.mjs is plain JS.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

// Image generation (2026-08-09, Fokus flyer AI hero/category art) - a
// separate provider from the text tiers above, so it gets its own constant
// rather than being forced into the bulk/analyze/chat enum. "medium" quality
// is the deliberate default: OpenAI's real per-image pricing (verified
// 2026-08-09, not assumed) is roughly $0.03/image at medium vs. $0.13/image
// at high for gpt-image-1.5 - a full flyer regeneration (1 hero + up to ~8
// category accents) costs cents at medium, low-single-digit-dollars at high.
export const IMAGE_MODEL = "gpt-image-1.5";
export const IMAGE_QUALITY = "medium";

export function getOpenAIClient() {
  return new OpenAI();
}
