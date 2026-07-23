import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NavLink } from "@/components/nav-link";
import { createClient } from "@/lib/supabase/server";

import { logout } from "./actions";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/firmen", label: "Firmen" },
  { href: "/katalog", label: "Katalog" },
  { href: "/fokus", label: "Fokus" },
  { href: "/feedback/neu", label: "Feedback" },
];

const ADMIN_NAV_ITEMS = [
  { href: "/admin/team", label: "Team" },
  { href: "/admin/enrichment", label: "Enrichment" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .single();

  const navItems = profile?.role === "admin" ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-6 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Social Net" width={30} height={30} priority />
            <span className="font-heading text-[15px] font-semibold tracking-tight">
              Normfest
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {profile?.full_name ?? profile?.email ?? user.email}
          </span>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Abmelden
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
