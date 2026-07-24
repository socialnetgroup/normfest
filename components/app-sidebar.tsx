"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Package,
  Target,
  BookOpen,
  FileText,
  Sparkles,
  Users,
  Settings,
  ChevronDown,
  Upload,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/firmen", label: "Firmen", icon: Building2 },
  { href: "/katalog", label: "Katalog", icon: Package },
  { href: "/fokus", label: "Fokus", icon: Target },
  { href: "/wissen", label: "Wissen", icon: BookOpen },
  { href: "/skript", label: "Skript", icon: FileText },
  { href: "/assistent", label: "Assistent", icon: Sparkles },
];

const SETTINGS_ITEMS = [
  { href: "/admin/enrichment", label: "Enrichment", icon: Wand2 },
  { href: "/admin/vis-import", label: "VIS Import", icon: Upload },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

export function AppSidebar({
  isAdmin,
  userLabel,
  logoutAction,
}: {
  isAdmin: boolean;
  userLabel: string;
  logoutAction: () => void;
}) {
  const pathname = usePathname();
  const settingsActive = SETTINGS_ITEMS.some((i) => isActive(pathname, i.href));
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
        <Image src="/logo.png" alt="Social Net" width={28} height={28} priority />
        <span className="font-heading text-[15px] font-semibold tracking-tight">Normfest</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} />
        ))}

        {isAdmin ? (
          <>
            <div className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Admin
            </div>
            <NavItem href="/admin/team" label="Team" icon={Users} active={isActive(pathname, "/admin/team")} />
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                settingsActive
                  ? "text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Settings className="size-4 shrink-0" />
              Settings
              <ChevronDown
                className={cn("ml-auto size-3.5 shrink-0 transition-transform", settingsOpen && "rotate-180")}
              />
            </button>
            {settingsOpen ? (
              <div className="ml-4 flex flex-col gap-0.5 border-l pl-3">
                {SETTINGS_ITEMS.map((item) => (
                  <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </nav>

      <div className="flex flex-col gap-2 border-t px-4 py-4">
        <span className="truncate text-xs text-muted-foreground">{userLabel}</span>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Abmelden
          </Button>
        </form>
      </div>
    </aside>
  );
}
