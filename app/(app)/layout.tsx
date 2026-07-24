import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { FloatingAssistant } from "@/components/floating-assistant";
import { createClient } from "@/lib/supabase/server";

import { logout } from "./actions";

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

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        isAdmin={profile?.role === "admin"}
        userLabel={profile?.full_name ?? profile?.email ?? user.email ?? ""}
        logoutAction={logout}
      />
      <main className="min-w-0 flex-1 overflow-y-auto p-6 md:p-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      <FloatingAssistant />
    </div>
  );
}
