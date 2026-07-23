"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type SkippedRow = { rowNumber: number; reason: string };
type Result =
  | { ok: true; parsed: number; written: number; skippedCount: number; skippedSample: SkippedRow[] }
  | { ok: false; error: string };

export function VisImportForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setPending(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/vis-import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Unbekannter Fehler" });
      } else {
        setResult({ ok: true, ...data });
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileName(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">VIS-Liste (.xlsx)</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            required
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-sm file:font-medium"
          />
        </label>
        <Button type="submit" disabled={!fileName || pending} className="self-start">
          {pending ? "Wird importiert…" : "Importieren"}
        </Button>
      </form>

      {pending ? (
        <p className="text-sm text-muted-foreground">
          Import läuft — bei der vollen Liste (~13.500 Zeilen) kann das eine Weile dauern, bitte Seite offen lassen.
        </p>
      ) : null}

      {result && !result.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {result.error}
        </p>
      ) : null}

      {result && result.ok ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <span>
              Zeilen gelesen: <span className="font-medium tabular-nums">{result.parsed}</span>
            </span>
            <span>
              Übernommen: <span className="font-medium tabular-nums">{result.written}</span>
            </span>
            <span>
              Übersprungen: <span className="font-medium tabular-nums">{result.skippedCount}</span>
            </span>
          </div>
          {result.skippedSample.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Erste übersprungene Zeilen (fehlende Kundennummer/Name/Gebiet):
              </p>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Zeile</th>
                      <th className="px-3 py-1.5 font-medium">Grund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.skippedSample.map((s) => (
                      <tr key={s.rowNumber}>
                        <td className="px-3 py-1.5 tabular-nums">{s.rowNumber}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
