"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Generic, reusable email template (2026-08-09), Anis: "add a generic email
// template too in the E-Mail-List maybe after the list" - a fixed, editable-
// by-nobody-yet boilerplate subject+body an agent can copy alongside the
// address list for a manual Outlook send. Not tied to a specific focus list
// or personalized per company - deliberately generic per the ask.
const SUBJECT = "Aktuelle Fokus-Aktion bei Normfest – attraktive Konditionen für Ihre Werkstatt";
const BODY = `Sehr geehrte Damen und Herren,

anbei erhalten Sie unsere aktuelle Fokus-Aktion mit ausgewählten Produkten zu besonders attraktiven Konditionen (siehe angehängten Flyer).

Bei Fragen oder für ein individuelles Angebot stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
Ihr Normfest-Team`;

function CopyField({ label, value, rows }: { label: string; value: string; rows?: number }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button type="button" size="sm" variant="outline" onClick={copy} className="shrink-0">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Kopiert!" : "Kopieren"}
        </Button>
      </div>
      {rows ? (
        <textarea
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          rows={rows}
          className="w-full resize-y rounded-lg border border-input bg-muted/30 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      ) : (
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-input bg-muted/30 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
    </div>
  );
}

export function EmailTemplateBlock() {
  return (
    <div className="flex flex-col gap-4">
      <CopyField label="Betreff" value={SUBJECT} />
      <CopyField label="Text" value={BODY} rows={8} />
      <p className="text-xs text-muted-foreground">
        Generische Vorlage - vor dem Versand ggf. anpassen. Den Flyer als Anhang nicht vergessen (siehe
        &quot;Flyer (PDF) öffnen&quot; auf der Fokus-Seite).
      </p>
    </div>
  );
}
