import { notFound } from "next/navigation";

import { FocusListCreateForm } from "@/components/focus-list-create-form";
import { createClient } from "@/lib/supabase/server";

export default async function NeueFokuslistePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Neue Fokusliste</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Erstellt eine neue aktive Liste und ersetzt die bisherige.
        </p>
      </div>
      <FocusListCreateForm createdBy={user.id} />
    </div>
  );
}
