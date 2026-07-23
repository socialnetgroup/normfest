"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function BrandFocusVerifyButton({
  companyId,
  brand,
  verifierId,
  alreadyVerified,
}: {
  companyId: string;
  brand: string;
  verifierId: string;
  alreadyVerified: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function verify() {
    setPending(true);
    const supabase = createClient();
    // §3.2.6: enrichment fills empty master-data fields only, never overwrites.
    await supabase.from("companies").update({ brand_focus: brand }).eq("id", companyId).is("brand_focus", null);
    await supabase
      .from("company_enrichment")
      .update({ verified: true, verified_by: verifierId, verified_at: new Date().toISOString() })
      .eq("company_id", companyId);
    setPending(false);
    setDone(true);
    router.refresh();
  }

  if (alreadyVerified || done) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        Bestätigt
      </span>
    );
  }

  return (
    <Button type="button" variant="outline" size="xs" onClick={verify} disabled={pending}>
      {pending ? "..." : "Bestätigen"}
    </Button>
  );
}
