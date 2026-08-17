import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { FloatingAssistant } from "@/components/floating-assistant";
import { HeartbeatPing } from "@/components/heartbeat-ping";
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

  // report@ role (2026-08-17) is a single-page, read-only "viewing angle"
  // account - the AI-Assistent tools and in-app heartbeat aren't relevant to
  // it (no per-agent presence to track, and its chat tools would return
  // little given fn_company_visible() was deliberately NOT widened for this
  // role, see the report-role migration's own comment).
  const isReport = profile?.role === "report";

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <AppSidebar
        isAdmin={profile?.role === "admin"}
        isReport={isReport}
        userLabel={profile?.full_name ?? profile?.email ?? user.email ?? ""}
        logoutAction={logout}
      />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      {!isReport ? (
        <>
          <FloatingAssistant />
          <HeartbeatPing />
        </>
      ) : null}
    </div>
  );
}
