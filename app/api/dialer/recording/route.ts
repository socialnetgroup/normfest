import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Real fix (2026-08-19, Anis: "Abspielen von Calls funktioniert iwie noch
// nicht") for the inline recording player added in §14 items 109/112:
// playing worked correctly in local dev (http://localhost) but silently
// failed in production. Root cause: the app is served over
// https://normfest.social-net.ba, but the real recording URLs the dialer
// returns are plain http:// (e.g. http://95.179.153.33/RECORDINGS/MP3/...).
// A browser loading an http:// media resource from an https:// page either
// auto-upgrades the request to https (which the recording server doesn't
// serve, so it just fails) or blocks it outright as mixed content - neither
// produces a visible error, matching "nothing happens" exactly. Routing
// playback through this same-origin (https) proxy sidesteps mixed content
// entirely: the browser only ever talks to our own HTTPS origin, and this
// route does the real http:// fetch server-side, where mixed-content rules
// don't apply.
//
// Only the dialer's own recording host is allowed as a target - this is an
// authenticated proxy, but still shouldn't become an open relay for
// arbitrary URLs (SSRF risk) just because a caller is logged in.
const ALLOWED_HOSTS = ["95.179.153.33", "socialnet.dialer.ba"];

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targetUrl = new URL(request.url).searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  }

  // Forward Range requests so the <audio> element can seek/start playback
  // without waiting for the full file (some browsers require partial-
  // content support to begin playing at all).
  const range = request.headers.get("range");
  const upstream = await fetch(parsed.toString(), {
    headers: range ? { range } : undefined,
  }).catch((err: unknown) => {
    return err instanceof Error ? err : new Error(String(err));
  });

  if (upstream instanceof Error) {
    return NextResponse.json({ error: `upstream fetch failed: ${upstream.message}` }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: `upstream returned ${upstream.status}` }, { status: 502 });
  }

  // Real second cause found live (2026-08-19, checked the actual proxied
  // response headers before assuming the mixed-content fix alone was
  // enough): the dialer server itself serves every recording with
  // `Content-Type: application/forcedownload` - not a browser quirk, the
  // upstream genuinely tells the browser "download this," which is exactly
  // why the original plain <a href target="_blank"> links never played
  // audibly either (§14 item 112's own note on this, confirmed as the real
  // mechanism, not just theorized). All of these files are real MP3s (the
  // URL path is always .../RECORDINGS/MP3/...), so the type is hardcoded
  // here rather than trusted from upstream - and any Content-Disposition
  // upstream sent is deliberately NOT forwarded, since that could still
  // force a download prompt even with a corrected Content-Type.
  const headers = new Headers();
  headers.set("Content-Type", "audio/mpeg");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes");
  headers.set("Cache-Control", "private, max-age=3600");

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
