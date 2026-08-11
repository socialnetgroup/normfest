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
        .select("must_change_password")
        .eq("id", user.id)
        .single();
      if (profile?.must_change_password) {
        const kontoUrl = request.nextUrl.clone();
        kontoUrl.pathname = "/konto";
        return NextResponse.redirect(kontoUrl);
      }
    }
  }

  return response;
}
