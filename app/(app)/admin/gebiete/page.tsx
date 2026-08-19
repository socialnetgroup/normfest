import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

// Anis (2026-08-19): "u admin u settingsima napraviti samo jednu listu,
// koji gebiet pripada kojem agentu" - a simple read-only reference table,
// no new schema needed (agents.gebiet is already the real source of truth
// used everywhere else in this app, e.g. fn_search_companies/§14 items
// 16/30).
export default async function GebietePage() {
  const { profile } = await getCurrentUser();
  if (profile?.role !== "admin") notFound();

  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("full_name, gebiet, active")
    .order("gebiet");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Gebiete</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welches Gebiet gehört zu welchem Agenten.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{agents?.length ?? 0} Gebiete</CardTitle>
        </CardHeader>
        <CardContent>
          {!agents || agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Agenten gefunden.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Gebiet</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agents.map((a) => (
                    <tr key={`${a.gebiet}-${a.full_name}`}>
                      <td className="px-3 py-2 font-medium">{a.gebiet ?? "-"}</td>
                      <td className="px-3 py-2">{a.full_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.active ? "Aktiv" : "Inaktiv"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
