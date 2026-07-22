"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export function LogSaleForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setStatus("error");
      setErrorMessage("Bitte einen gültigen Betrag eingeben.");
      return;
    }

    setStatus("saving");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_log_sale", { p_amount: value });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("done");
    setAmount("");
    router.refresh();
    // TODO (someday, per Anis): confetti animation scaled to deal size —
    // amount is already known client-side right here, no extra data needed.
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="sale-amount" className="text-xs text-muted-foreground">
          Verkauf eintragen (€)
        </label>
        <Input
          id="sale-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="z.B. 150"
          className="w-32"
          required
        />
      </div>
      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Speichern..." : "Eintragen"}
      </Button>
      {status === "done" ? (
        <span className="text-sm text-primary" role="status">
          Gespeichert!
        </span>
      ) : null}
      {status === "error" && errorMessage ? (
        <span className="text-sm text-destructive" role="alert">
          {errorMessage}
        </span>
      ) : null}
    </form>
  );
}
