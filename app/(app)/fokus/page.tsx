import Link from "next/link";

import { FocusItemRemoveButton } from "@/components/focus-item-remove-button";
import { FocusListActivateButton } from "@/components/focus-list-activate-button";
import { FocusListManage } from "@/components/focus-list-manage";
import { FocusProductSellForm } from "@/components/focus-product-sell-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

type CompanyItemRow = {
  id: string;
  note: string | null;
  companies: {
    id: string;
    name: string;
    kundennummer: string;
    ort: string | null;
    gebiet: string | null;
  } | null;
};

type ProductItemRow = {
  id: string;
  note: string | null;
  products: { id: string; name: string; sku: string; category_name: string | null } | null;
};

export default async function FokusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: activeList }] = await Promise.all([
    user ? supabase.from("profiles").select("role").eq("id", user.id).single() : Promise.resolve({ data: null }),
    supabase.from("focus_lists").select("id, name, note, created_at").eq("active", true).maybeSingle(),
  ]);

  const isAdmin = profile?.role === "admin";

  const { data: allLists } = isAdmin
    ? await supabase.from("focus_lists").select("id, name, active, created_at").order("created_at", { ascending: false })
    : { data: null };

  const [{ data: companyItems }, { data: productItems }] = activeList
    ? await Promise.all([
        supabase
          .from("focus_list_items")
          .select("id, note, companies(id, name, kundennummer, ort, gebiet)")
          .eq("focus_list_id", activeList.id)
          .order("created_at"),
        supabase
          .from("focus_list_products")
          .select("id, note, products(id, name, sku, category_name)")
          .eq("focus_list_id", activeList.id)
          .order("created_at"),
      ])
    : [{ data: null }, { data: null }];

  const companyRows = (companyItems ?? []) as unknown as CompanyItemRow[];
  const productRows = (productItems ?? []) as unknown as ProductItemRow[];

  const productsByCategory = new Map<string, ProductItemRow[]>();
  for (const row of productRows) {
    if (!row.products) continue;
    const category = row.products.category_name ?? "Ohne Kategorie";
    if (!productsByCategory.has(category)) productsByCategory.set(category, []);
    productsByCategory.get(category)!.push(row);
  }
  const categories = [...productsByCategory.keys()].sort();

  const productIds = productRows.map((r) => r.products?.id).filter((id): id is string => !!id);
  const soldCounts = new Map<string, number>();
  if (activeList && productIds.length > 0) {
    const { data: soldRows } = await supabase
      .from("sales_feedback")
      .select("product_id")
      .in("product_id", productIds)
      .eq("outcome", "sold")
      .gte("created_at", activeList.created_at);
    for (const row of soldRows ?? []) {
      if (!row.product_id) continue;
      soldCounts.set(row.product_id, (soldCounts.get(row.product_id) ?? 0) + 1);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Fokus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aktuelle Fokusliste - kuratiert vom Admin.
          </p>
        </div>
        {isAdmin ? (
          <Link href="/fokus/neu" className={buttonVariants({ variant: "default" })}>
            Neue Liste erstellen
          </Link>
        ) : null}
      </div>

      {!activeList ? (
        <p className="text-sm text-muted-foreground">Aktuell keine aktive Fokusliste.</p>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>{activeList.name}</CardTitle>
                {activeList.note ? (
                  <p className="text-sm text-muted-foreground">{activeList.note}</p>
                ) : null}
              </div>
              {isAdmin ? <FocusListManage listId={activeList.id} name={activeList.name} /> : null}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Katalog des Fokus</CardTitle>
              <p className="text-sm text-muted-foreground">
                {productRows.length} Produkte in {categories.length}{" "}
                {categories.length === 1 ? "Kategorie" : "Kategorien"} - das lernt und drückt das ganze Team diese
                Runde.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {productRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Diese Liste enthält noch keine Produkte.</p>
              ) : (
                categories.map((category) => (
                  <div key={category}>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {category} ({productsByCategory.get(category)!.length})
                    </h3>
                    <ul className="flex flex-col divide-y rounded-lg border">
                      {productsByCategory.get(category)!.map((row) =>
                        row.products ? (
                          <li key={row.id} className="flex flex-col gap-2 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <Link href={`/katalog/${row.products.id}`} className="font-medium hover:underline">
                                  {row.products.name}
                                </Link>
                                <div className="text-sm text-muted-foreground">
                                  {row.products.sku}
                                  {row.note ? ` · ${row.note}` : ""}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge variant={soldCounts.get(row.products.id) ? "success" : "muted"}>
                                  {soldCounts.get(row.products.id) ?? 0}× verkauft
                                </Badge>
                                {user ? (
                                  <FocusProductSellForm productId={row.products.id} agentId={user.id} />
                                ) : null}
                                {isAdmin ? <FocusItemRemoveButton table="focus_list_products" id={row.id} /> : null}
                              </div>
                            </div>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Firmen in dieser Liste</CardTitle>
            </CardHeader>
            <CardContent>
              {companyRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Diese Liste enthält noch keine Firmen.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <ul className="divide-y">
                    {companyRows.map((row) =>
                      row.companies ? (
                        <li key={row.id} className="flex items-center gap-2 px-2">
                          <Link
                            href={`/firmen/${row.companies.id}`}
                            className="flex flex-1 items-center justify-between gap-4 px-2 py-3 transition-colors hover:bg-accent"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{row.companies.name}</span>
                              <div className="text-sm text-muted-foreground">
                                {row.companies.kundennummer} · {row.companies.ort}
                                {row.note ? ` · ${row.note}` : ""}
                              </div>
                            </div>
                            {row.companies.gebiet ? (
                              <Badge variant="secondary" className="shrink-0">
                                {row.companies.gebiet}
                              </Badge>
                            ) : null}
                          </Link>
                          {isAdmin ? <FocusItemRemoveButton table="focus_list_items" id={row.id} /> : null}
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {isAdmin && allLists && allLists.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Alle Fokuslisten</CardTitle>
            <p className="text-sm text-muted-foreground">Verwalten, aktivieren oder löschen.</p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {allLists.map((list) => (
                <li key={list.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    {list.active ? <Badge variant="success">Aktiv</Badge> : null}
                    <span className="font-medium">{list.name}</span>
                    <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(list.created_at))}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!list.active ? <FocusListActivateButton listId={list.id} /> : null}
                    <FocusListManage listId={list.id} name={list.name} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
