// Free, zero-risk noise pre-filter for the legacy ticket-comment import
// (CLAUDE.md §14 item 135). Only ever matches the WHOLE normalized comment
// against this exact list - never a substring - so a longer comment that
// happens to CONTAIN one of these phrases plus real extra content (e.g.
// "nicht erreicht, hat aber Bremsenreiniger bestellt") is never touched and
// still goes to the real LLM classifier. Every phrase here was checked
// directly against real frequency data (2026-08-20/21) before inclusion -
// this is not a guess.
export function normalizeComment(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tier 1 - "no contact was made at all" - zero content beyond the fact that
// nobody answered. Real frequency: ~150,000 of 361,197 matched rows.
const NO_CONTACT_PHRASES = [
  "nicht erreicht",
  "kunde nicht erreicht",
  "anrufbeantworter",
  "kunde meldet sich nicht",
  "der kunde meldet sich nicht",
  "hat sich keiner gemeldet",
  "keine verbindung",
  "es hat sich niemand gemeldet",
  "der ansprechspartner wurde nicht erreicht",
  "ab niemand meldet sich",
  "keinen erreicht",
  "ap im moment nicht erreichbar",
  "geht leider nicht ran",
  "keiner meldet sich",
  "nicht erreicht niemand hat sich gemeldet",
  "es hat nicht geklingelt",
  "ansprechpartner im moment nicht da",
  "chef nicht da",
];

// Tier 2 - a real contact happened but the entire comment is a bare
// "no need"/"no time"/pure-reschedule statement with zero elaboration (no
// product mentioned, no reason given) - per Anis's own framing, this is
// exactly the "demotivating, no real content" class to leave out. Real
// frequency: ~36,000 more rows. Deliberately does NOT include short/cryptic
// entries like "ab" or "ne" alone - too ambiguous to auto-drop safely, left
// for the real LLM classifier instead.
const BARE_NO_NEED_PHRASES = [
  "kein bedarf",
  "der kunde hat kein bedarf zu zeit",
  "der kunde hat kein bedarf",
  "brauchen aktuell nichts",
  "brauchen aktuel nichts",
  "im moment besteht kein bedarf",
  "aktuell kein bedarf",
  "momentan brauchen nichts",
  "spater wieder melden",
  "morgen wieder melden",
  "urlaub",
  "keine zeit",
];

const SAFE_NOISE_SET = new Set([...NO_CONTACT_PHRASES, ...BARE_NO_NEED_PHRASES]);

/** True if this comment can be safely dropped as noise WITHOUT spending any
 * LLM classification call - only ever true for an exact, whole-comment
 * match against the reviewed list above. */
export function isFreeNoise(comment) {
  return SAFE_NOISE_SET.has(normalizeComment(comment));
}
