"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogCallButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function handleClick() {
    setStatus("saving");
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_log_call");

    if (error) {
      setStatus("error");
      return;
    }

    setStatus("idle");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={status === "saving"}>
      <Phone className="size-3.5" />
      {status === "saving" ? "..." : "Anruf zählen"}
    </Button>
  );
}
