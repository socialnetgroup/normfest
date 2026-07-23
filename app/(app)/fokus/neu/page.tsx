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

  const { data: minSoldSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "focus_winner_min_sold")
    .single();
  const minSold = Number(minSoldSetting?.value ?? 1);

  const { data: winnerRows } = await supabase
    .from("product_winner_stats")
    .select("product_id, sold_count, total_qty, total_value, products(id, name, sku, category_name)")
    .gte("sold_count", minSold)
    .order("sold_count", { ascending: false })
    .limit(20);

  const winners = (winnerRows ?? [])
    .filter((w) => w.products)
    .map((w) => ({
      id: w.products!.id,
      name: w.products!.name,
      sku: w.products!.sku,
      category_name: w.products!.category_name,
      sold_count: w.sold_count ?? 0,
    }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Neue Fokusliste</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Erstellt eine neue aktive Liste und ersetzt die bisherige.
        </p>
      </div>
      <FocusListCreateForm createdBy={user.id} winners={winners} />
    </div>
  );
}
