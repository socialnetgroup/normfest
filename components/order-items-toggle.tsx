"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type OrderItem = {
  id: string;
  description_raw: string | null;
  sku_raw: string | null;
  qty: number | null;
  net_amount: number | null;
  product_id: string | null;
  productName: string | null;
};

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// Anis (2026-08-14): "se nista ne moze kliknuti na to, pa ne znas o cemu
// prica tool" - the order row only ever showed "N Position(en)", with no
// way to see what was actually on the invoice. Toggle reveals the real
// line items (product name if matched, else the raw invoice description -
// same "never silently invent a match" discipline as the rest of the
// invoice-import pipeline, §14 item 71).
export function OrderItemsToggle({ items }: { items: OrderItem[] }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {open ? "Positionen ausblenden" : `${items.length} Position${items.length === 1 ? "" : "en"} anzeigen`}
      </button>
      {open ? (
        <ul className="mt-1.5 flex flex-col gap-1 border-l-2 border-l-muted pl-3">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {it.product_id && it.productName ? (
                  <Link href={`/katalog/${it.product_id}`} className="text-primary hover:underline">
                    {it.productName}
                  </Link>
                ) : (
                  <span>{it.description_raw ?? it.sku_raw ?? "Position"}</span>
                )}
                {it.qty ? <span className="text-muted-foreground"> ×{it.qty}</span> : null}
              </span>
              {it.net_amount != null ? <span className="shrink-0 text-muted-foreground">{eur.format(it.net_amount)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
