"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
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
  Headphones,
  Phone,
  MessageSquare,
  ClipboardCheck,
  Tags,
  Copy,
  ListChecks,
  BarChart3,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  CalendarCheck,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/firmen", label: "Firmen", icon: Building2 },
  { href: "/dialer", label: "Dialer", icon: Phone, badge: "Bald" },
  { href: "/katalog", label: "Katalog", icon: Package },
  { href: "/fokus", label: "Fokus", icon: Target },
  // Alan's pilot feedback (2026-08-08) / admin-menu scoping audit: the
  // /feedback page itself has always been team-shared (sales_feedback's
  // existing shared-read RLS, same data the Dashboard's "Feedback diese
  // Woche" tile already links to) - it only had a persistent nav entry in
  // the Admin section, so agents had no way in except remembering that
  // tile. Moved to the shared nav to match the page's real visibility.
  { href: "/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/wissen", label: "Wissen", icon: BookOpen },
  { href: "/skript", label: "Skript", icon: FileText },
  { href: "/assistent", label: "Assistent", icon: Sparkles },
];

const SETTINGS_ITEMS = [
  { href: "/admin/enrichment", label: "Enrichment", icon: Wand2 },
  { href: "/admin/anreicherung-uebersicht", label: "Anreicherung-Übersicht", icon: BarChart3 },
  { href: "/admin/vis-import", label: "VIS Import", icon: Upload },
  { href: "/admin/brand-profiles", label: "Marken-Profile", icon: Tags },
  { href: "/admin/katalog-dedup", label: "Katalog-Dedup", icon: Copy },
  { href: "/admin/katalog-qualitaet", label: "Katalog-Qualität", icon: BarChart3 },
];

// Anis, 2026-08-06: "stavi mogucnost da menu u aplikaciji se moze ugasiti
// iako je full screen" - the sidebar was previously always-visible on
// desktop (only the mobile drawer could close). Persisted so the choice
// survives navigation/reload, not just a per-session toggle.
//
// useSyncExternalStore rather than useState+useEffect: localStorage is a
// mutable external source read outside React, and this is exactly the API
// React ships for that - getServerSnapshot returns the SSR-safe default
// (expanded) so there's no hydration mismatch, and the real persisted value
// takes over immediately after mount without an effect-driven setState.
const DESKTOP_COLLAPSED_KEY = "normfest-sidebar-collapsed";
const DESKTOP_COLLAPSED_EVENT = "normfest-sidebar-collapsed-change";

function subscribeToDesktopCollapsed(onChange: () => void) {
  window.addEventListener(DESKTOP_COLLAPSED_EVENT, onChange);
  return () => window.removeEventListener(DESKTOP_COLLAPSED_EVENT, onChange);
}

function getDesktopCollapsedSnapshot() {
  return localStorage.getItem(DESKTOP_COLLAPSED_KEY) === "1";
}

function getDesktopCollapsedServerSnapshot() {
  return false;
}

function setDesktopCollapsedPersisted(value: boolean) {
  localStorage.setItem(DESKTOP_COLLAPSED_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(DESKTOP_COLLAPSED_EVENT));
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  badge,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  badge?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <Badge variant="warning" className="shrink-0">
          {badge}
        </Badge>
      ) : null}
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const desktopCollapsed = useSyncExternalStore(
    subscribeToDesktopCollapsed,
    getDesktopCollapsedSnapshot,
    getDesktopCollapsedServerSnapshot,
  );

  function toggleDesktopCollapsed() {
    setDesktopCollapsedPersisted(!desktopCollapsed);
  }

  // Adjusting state during render (not in an effect) on navigation, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
        <Link href="/" className="flex items-center gap-2.5" onClick={closeMobile}>
          <Image src="/logo.png" alt="Social Net" width={24} height={24} priority />
          <span className="font-heading text-sm font-semibold tracking-tight">Normfest</span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Menü öffnen"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      ) : null}

      {/* Reopen button - lives outside <aside> since the aside itself
          collapses to zero width and would take its own button with it. */}
      {desktopCollapsed ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Menü einblenden"
          onClick={toggleDesktopCollapsed}
          className="fixed top-4 left-4 z-40 hidden md:flex"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-72 max-w-[85vw] flex-col border-r bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200 ease-in-out",
          "md:static md:z-auto md:max-w-none md:!translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          desktopCollapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : "md:w-60",
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/" className="flex items-center gap-2.5" onClick={closeMobile}>
            <Image src="/logo.png" alt="Social Net" width={28} height={28} priority />
            <span className="font-heading text-[15px] font-semibold tracking-tight">Normfest</span>
          </Link>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Menü ausblenden"
              onClick={toggleDesktopCollapsed}
              className="hidden md:inline-flex"
            >
              <PanelLeftClose className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Menü schließen"
              className="md:hidden"
              onClick={closeMobile}
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={closeMobile} />
          ))}

          {!isAdmin ? (
            <NavItem
              href="/meine-ergebnisse"
              label="Meine Ergebnisse"
              icon={BarChart3}
              active={isActive(pathname, "/meine-ergebnisse")}
              onNavigate={closeMobile}
            />
          ) : null}

          {isAdmin ? (
            <>
              <div className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Admin
              </div>
              <NavItem
                href="/admin/reviews"
                label="Offene Reviews"
                icon={ListChecks}
                active={isActive(pathname, "/admin/reviews")}
                onNavigate={closeMobile}
              />
              <NavItem
                href="/admin/team"
                label="Team"
                icon={Users}
                active={isActive(pathname, "/admin/team")}
                onNavigate={closeMobile}
              />
              <NavItem
                href="/admin/anwesenheit"
                label="Anwesenheit"
                icon={CalendarCheck}
                active={isActive(pathname, "/admin/anwesenheit")}
                onNavigate={closeMobile}
              />
              <NavItem
                href="/admin/qa-bewertungen"
                label="QA-Bewertungen"
                icon={ClipboardCheck}
                active={isActive(pathname, "/admin/qa-bewertungen")}
                onNavigate={closeMobile}
              />
              <NavItem
                href="/admin/qa-anrufe"
                label="QA-Anrufe"
                icon={Headphones}
                active={isActive(pathname, "/admin/qa-anrufe")}
                badge="Bald"
                onNavigate={closeMobile}
              />
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
                    <NavItem
                      key={item.href}
                      {...item}
                      active={isActive(pathname, item.href)}
                      onNavigate={closeMobile}
                    />
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
    </>
  );
}
