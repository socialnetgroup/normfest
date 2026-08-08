import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";

// Alan's pilot feedback (2026-08-08): wants an "Anrufen" button on the
// Firmenprofil header so click-to-call is visually in place, but it stays
// non-functional until the hybrid-dialer integration (CLAUDE.md §14 item 13
// roadmap - softphone/click-to-call is explicitly phase 2 there). Disabled,
// not wired to anything, so it can't be clicked into a broken state.
export function AnrufenPlaceholderButton() {
  return (
    <Button type="button" variant="outline" size="sm" disabled title="Bald verfügbar (Hybrid-Dialer)">
      <Phone className="size-3.5" />
      Anrufen
    </Button>
  );
}
