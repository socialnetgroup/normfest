"use client";

import { Delete, Phone } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
] as const;

export function SoftphoneDialpad() {
  const [number, setNumber] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex min-h-11 items-center justify-center rounded-lg bg-muted/40 px-3">
        <span className="font-heading text-xl tracking-wide tabular-nums">
          {number || <span className="text-muted-foreground">Nummer eingeben</span>}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {KEYS.map(([digit, letters]) => (
          <button
            key={digit}
            type="button"
            onClick={() => setNumber((n) => n + digit)}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border bg-background py-2.5",
              "transition-colors hover:bg-accent active:bg-accent",
            )}
          >
            <span className="font-heading text-lg font-semibold tabular-nums">{digit}</span>
            <span className="h-3 text-[9px] tracking-widest text-muted-foreground uppercase">{letters}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={!number}
          onClick={() => setNumber((n) => n.slice(0, -1))}
          aria-label="Letzte Ziffer löschen"
        >
          <Delete className="size-4" />
        </Button>
        <Button type="button" className="flex-1 gap-2" disabled title="Noch nicht mit einem Dialer verbunden">
          <Phone className="size-4" />
          Anrufen
        </Button>
      </div>
    </div>
  );
}
