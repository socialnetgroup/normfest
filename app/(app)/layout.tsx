import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { FloatingAssistant } from "@/components/floating-assistant";
import { getCurrentUser } from "@/lib/auth";

import { logout } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
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
