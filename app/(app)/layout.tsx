import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { FloatingAssistant } from "@/components/floating-assistant";
import { HeartbeatPing } from "@/components/heartbeat-ping";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  const isAdmin = profile?.role === "admin";

  // Unread agent_evaluations count for the sidebar's "Bewertungen" badge
  // (2026-08-19, §14 item 109's follow-up) - a plain count() under the
  // agent_evaluations_select_own RLS policy, cheap (a real agent gets ~1
  // new evaluation/month), so this runs on every navigation without needing
  // its own RPC. Admins/report have no agent_evaluations of their own -
  // skip the query entirely for them rather than run a pointless request.
  let unreadEvaluationCount: number | undefined;
  if (!isAdmin && !isReport) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("agent_evaluations")
      .select("id", { count: "exact", head: true })
      .is("viewed_at", null);
    unreadEvaluationCount = count ?? 0;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <AppSidebar
        isAdmin={isAdmin}
        isReport={isReport}
        userLabel={profile?.full_name ?? profile?.email ?? user.email ?? ""}
        logoutAction={logout}
        unreadEvaluationCount={unreadEvaluationCount}
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
