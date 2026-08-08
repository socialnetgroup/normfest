"use client";

import { useState } from "react";
import { X, Copy, Check } from "lucide-react";

import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Row = { company_id: string; company_name: string; email: string };

// Outlook's "An:"-field expects semicolon-separated addresses by default -
// Anis: "keep in mind they would send through outlook" (2026-08-08).
// `children` (the E-Mail-Vorlage template) renders between the copy-box and
// the delete-list - Anis, 2026-08-09: "email vorlage nach oben shieben,
// position 2 nach emails, die email loschen teil am ende". Both halves stay
// inside this one component (not split into page-level siblings) so they
// keep sharing the same `rows` state - a deleted row disappears from the
// copy-box textarea immediately, not just the list below.
export function EmailListClient({ rows: initialRows, children }: { rows: Row[]; children?: React.ReactNode }) {
  const [rows, setRows] = useState(initialRows);
  const [copied, setCopied] = useState(false);

  const emailList = rows.map((r) => r.email).join("; ");

  async function copy() {
    await navigator.clipboard.writeText(emailList);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function exclude(companyId: string) {
    setRows((prev) => prev.filter((r) => r.company_id !== companyId));
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("email_list_exclusions").insert({ company_id: companyId, excluded_by: user?.id });
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine E-Mail-Adressen gefunden.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {rows.length} E-Mail-Adresse{rows.length === 1 ? "" : "n"} (Semikolon-getrennt, für Outlooks
              &quot;An:&quot;-Feld)
            </span>
            <Button type="button" size="sm" variant="outline" onClick={copy} className="shrink-0">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Kopiert!" : "Kopieren"}
            </Button>
          </div>
          <textarea
            readOnly
            value={emailList}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-24 w-full resize-y rounded-lg border border-input bg-muted/30 p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      )}

      {children}

      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.company_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.company_name}</p>
                <p className="truncate text-muted-foreground">{r.email}</p>
              </div>
              <ConfirmButton
                size="icon-xs"
                variant="ghost"
                onConfirm={() => exclude(r.company_id)}
                aria-label="Aus Liste entfernen (zweimal klicken zum Bestätigen)"
                className="shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3.5" />
              </ConfirmButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
