import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  max,
  className,
  markers,
}: {
  value: number;
  max: number;
  className?: string;
  markers?: { position: number; label: string }[];
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div className={cn(markers?.length ? "pt-4" : undefined, "relative w-full", className)}>
      {markers?.map((m) => (
        <span
          key={m.label}
          className="absolute top-0 -translate-x-1/2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
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
