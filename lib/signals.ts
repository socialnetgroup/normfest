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
