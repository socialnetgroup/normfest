import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const ACCENT_BAR: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  secondary: "bg-muted-foreground/40",
};

const ACCENT_TEXT: Record<string, string> = {
  primary: "text-primary",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  secondary: "text-foreground",
};

export function StatTile({
  label,
  value,
  accent = "secondary",
  href,
  sub,
  trend,
}: {
  label: string;
  value: string;
  accent?: "primary" | "success" | "warning" | "secondary";
  href?: string;
  /** Optional smaller second line under the label, e.g. "Heute: 3" - for a
   * related, finer-grained number shown at a glance alongside the main value. */
  sub?: string;
  /** Optional up/down trend badge next to the value, e.g. "über Ø heute" -
   * only pass this for comparisons with a real, defensible baseline (a
   * genuine average/target/prior-period figure already computed elsewhere),
   * never a fabricated or misleading ratio (Anis, 2026-08-21: "sto vise
   * stvari vizualizirati na jedan pogled, gdje smo sta smo gdje idemo"). */
  trend?: { direction: "up" | "down"; label: string };
}) {
  const content = (
    <>
      <div className={cn("absolute inset-y-0 left-0 w-1", ACCENT_BAR[accent])} />
      <div className="pl-2">
        <div className="flex items-baseline gap-1.5">
          <div className={cn("font-heading text-2xl font-bold tabular-nums", ACCENT_TEXT[accent])}>{value}</div>
          {trend ? (
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs font-semibold",
                trend.direction === "up" ? "text-success" : "text-destructive",
              )}
            >
              {trend.direction === "up" ? (
                <ArrowUpRight className="size-3.5" />
              ) : (
                <ArrowDownRight className="size-3.5" />
              )}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground/70">{sub}</div> : null}
        {trend ? (
          <div
            className={cn(
              "mt-0.5 text-xs font-medium",
              trend.direction === "up" ? "text-success" : "text-destructive",
            )}
          >
            {trend.label}
          </div>
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="relative block overflow-hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-accent"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10">{content}</div>
  );
}
