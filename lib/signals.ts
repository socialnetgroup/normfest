export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  focus_list_push: "Fokusliste",
  feedback_replenishment: "Nachbestellung fällig",
  brand_profile_match: "Marken-Fokus",
  seasonal_push: "Saisonartikel",
  new_product_match: "Neuheit",
  external_opportunity: "Externe Chance",
  category_gap: "Kategorie-Lücke",
  replenishment_due: "Nachbestellung fällig",
  dormant_winback: "Reaktivierung",
  cross_sell: "Cross-Sell",
  upsell_pack: "Upsell",
  declining_volume: "Umsatzrückgang",
  revenue_trend_risk: "Umsatzrückgang",
  first_order_followup: "Erstbestellung-Nachfassen",
  basket_expansion: "Warenkorb-Ausbau",
};

export function signalTypeLabel(type: string) {
  return SIGNAL_TYPE_LABELS[type] ?? type;
}

const RISK_TYPES = new Set(["declining_volume", "revenue_trend_risk", "dormant_winback"]);
const OPPORTUNITY_TYPES = new Set([
  "cross_sell",
  "upsell_pack",
  "new_product_match",
  "seasonal_push",
  "external_opportunity",
  "brand_profile_match",
  "category_gap",
  "basket_expansion",
  "first_order_followup",
]);

/** Badge color for a signal type: risk (warning), opportunity (success), else neutral. */
export function signalTypeVariant(type: string): "warning" | "success" | "secondary" {
  if (RISK_TYPES.has(type)) return "warning";
  if (OPPORTUNITY_TYPES.has(type)) return "success";
  return "secondary";
}

/**
 * Picks a top-N slice from an already tier/score-sorted signal list, but
 * caps how many any single type can contribute first - a flat top-N would
 * let a high-volume type (cross_sell: 200k+ rows project-wide, up to 15 per
 * company) crowd out lower-volume/lower-score types (seasonal_push,
 * new_product_match, etc.) whenever both are present for the same company.
 * Anis (2026-08-19): noticed seasonal signals disappearing and suggested
 * exactly this - "pro typ 3-4 anzeigen". Caps first, then re-sorts the
 * survivors by the caller's own ordering (input order) so within-type
 * priority (tier, score) is preserved.
 */
export function selectDiverseSignals<T extends { type: string }>(
  sorted: T[],
  maxTotal: number,
  maxPerType: number,
): T[] {
  const perTypeCount = new Map<string, number>();
  const kept: T[] = [];
  for (const s of sorted) {
    const count = perTypeCount.get(s.type) ?? 0;
    if (count >= maxPerType) continue;
    perTypeCount.set(s.type, count + 1);
    kept.push(s);
    if (kept.length >= maxTotal) break;
  }
  return kept;
}
