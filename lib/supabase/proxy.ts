import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/types";

// "/api/cron" isn't literally public - Vercel Cron requests carry no user
// session at all (no cookies), so the redirect-to-login logic below would
// otherwise 302 every cron trigger before it ever reaches the route. Each
// route under /api/cron enforces its own auth via a CRON_SECRET bearer
// check instead (see app/api/cron/dialer-snapshot/route.ts).
const PUBLIC_PATHS = ["/login", "/api/cron"];

// New accounts (agents created via scripts/*, flagged must_change_password)
// must set their own real password before touching anything else - exempt
// /konto itself (the page that does it) and every /api route (an API
// request should hit its own handler, never get HTML-redirected).
const MUST_CHANGE_PASSWORD_EXEMPT_PATHS = ["/login", "/konto", "/api"];

// report@ role (2026-08-17, Anis: "a kinda of viewing angle") gets /bericht
// (+ /bericht/[agentId] drill-down, same prefix) and /dialer ("stavi pored
// izvjestaja i /dialer... bukvalno sve sto se vidi u admin /dialer stavi u
// report" - literally the same admin Dialer page, widened to allow this
// role too), plus the two paths every role needs (own account, logout).
// Enforced here rather than only hiding the nav link, same discipline as
// must_change_password above: a route a user can't reach via the UI should
// also 404/redirect if they type the URL directly.
const REPORT_ALLOWED_PATHS = ["/bericht", "/dialer", "/konto", "/login", "/api"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  if (user) {
    const isExempt = MUST_CHANGE_PASSWORD_EXEMPT_PATHS.some((path) =>
      request.nextUrl.pathname.startsWith(path),
    );
    if (!isExempt) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password, role")
        .eq("id", user.id)
        .single();
      if (profile?.must_change_password) {
        const kontoUrl = request.nextUrl.clone();
        kontoUrl.pathname = "/konto";
        return NextResponse.redirect(kontoUrl);
      }
      if (profile?.role === "report" && !REPORT_ALLOWED_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
        const berichtUrl = request.nextUrl.clone();
        berichtUrl.pathname = "/bericht";
        return NextResponse.redirect(berichtUrl);
      }
    }
  }

  return response;
}
