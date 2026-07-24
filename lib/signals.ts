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
