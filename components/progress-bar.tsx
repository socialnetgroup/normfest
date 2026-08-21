import { cn } from "@/lib/utils";

export type ProgressBarMarker = {
  position: number;
  label: string;
  /** Optional color/weight override for this marker's label, e.g.
   * "text-destructive" or "text-success font-bold" - defaults to the plain
   * muted-foreground styling every other marker uses. */
  className?: string;
  /** Renders this marker's label in its own row above the regular markers,
   * so it can't visually collide with a nearby regular marker (e.g. a
   * "Projiziert" figure landing close to the floor/target ticks). */
  elevated?: boolean;
};

export function ProgressBar({
  value,
  max,
  className,
  markers,
}: {
  value: number;
  max: number;
  className?: string;
  markers?: ProgressBarMarker[];
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const hasElevated = markers?.some((m) => m.elevated);

  return (
    <div
      className={cn(markers?.length ? (hasElevated ? "pt-8" : "pt-4") : undefined, "relative w-full", className)}
    >
      {markers?.map((m) => (
        <span
          key={m.label}
          className={cn(
            "absolute -translate-x-1/2 text-xs whitespace-nowrap tabular-nums",
            m.elevated ? "top-0" : hasElevated ? "top-4" : "top-0",
            m.className ?? "text-muted-foreground",
          )}
          style={{ left: `${Math.min(100, (m.position / max) * 100)}%` }}
        >
          {m.label}
        </span>
      ))}
      <div className="relative h-2.5 w-full rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
        {markers?.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 h-2.5 w-px bg-foreground/30"
            style={{ left: `${Math.min(100, (m.position / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
