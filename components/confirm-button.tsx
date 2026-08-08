"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type ButtonProps = React.ComponentProps<typeof Button>;

// Anis (2026-08-08): "misslicked and deleted 1 Feedback and now cant revert
// it" - the browser's native window.confirm() (used by every destructive
// action in this app so far) is too easy to reflexively click through
// without reading. Replaces it with a click-to-arm pattern: first click
// arms the button (turns destructive-red, shows a warning icon/label, no
// side effect yet), a second deliberate click within `armedMs` actually
// runs the action; it auto-disarms if nothing happens, so a single misclick
// can never delete anything - a genuine second, differently-styled click is
// required. Supports both icon-only buttons (pass an icon as children,
// confirmIcon defaults to a warning triangle) and text buttons (pass a
// label as children, confirmLabel overrides the armed-state text).
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel,
  confirmIcon,
  armedMs = 3500,
  variant = "ghost",
  disabled,
  className,
  "aria-label": ariaLabel,
  ...props
}: {
  onConfirm: () => void | Promise<void>;
  children: React.ReactNode;
  confirmLabel?: React.ReactNode;
  confirmIcon?: React.ReactNode;
  armedMs?: number;
} & Omit<ButtonProps, "onClick" | "children"> &
  VariantProps<typeof buttonVariants>) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function handleClick(e: React.MouseEvent) {
    // Delete buttons are often nested inside a clickable row/Link (e.g. a
    // list item linking to a detail page) - never let either the arming
    // click or the confirming click bubble into that navigation.
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), armedMs);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <Button
      type="button"
      variant={armed ? "destructive" : variant}
      onClick={handleClick}
      disabled={disabled}
      className={cn(armed && "animate-pulse", className)}
      aria-label={armed ? "Bestätigen zum Löschen" : ariaLabel}
      {...props}
    >
      {armed ? (confirmLabel ?? confirmIcon ?? <AlertTriangle className="size-3.5" />) : children}
    </Button>
  );
}
