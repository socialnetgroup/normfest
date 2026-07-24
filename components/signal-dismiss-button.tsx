"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function SignalDismissButton({
  companyId,
  type,
  productId,
}: {
  companyId: string;
  type: string;
  productId?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function dismiss() {
    setPending(true);
    const supabase = createClient();
    await supabase.rpc("fn_dismiss_signal", {
      p_company_id: companyId,
      p_type: type,
      p_product_id: productId ?? undefined,
    });
    setPending(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }}
      disabled={pending}
      aria-label="Erledigt - ausblenden"
      title="Erledigt - ausblenden"
      className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-success/15 hover:text-success-foreground disabled:opacity-50"
    >
      <X className="size-3.5" />
    </button>
  );
}
