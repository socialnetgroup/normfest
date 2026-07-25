import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// `(app)/layout.tsx` and nearly every page underneath each independently
// called `supabase.auth.getUser()` (a real network round trip to Supabase
// Auth, not free) plus their own `profiles` role query - 21 getUser() calls
// and 17 profile queries across the codebase, confirmed via grep, meaning
// every single navigation paid for at least 2 of each. `cache()` memoizes
// this per server-render pass, so calling it from the layout and again from
// the page underneath only ever hits the network once per request.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .single();

  return { user, profile };
});
