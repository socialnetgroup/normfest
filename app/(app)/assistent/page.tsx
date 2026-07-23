import { ChatAssistant } from "@/components/chat-assistant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function AssistentPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company } = await searchParams;
  const supabase = await createClient();

  const companyContext = company
    ? await supabase
        .from("companies")
        .select("id, name")
        .eq("id", company)
        .maybeSingle()
        .then(({ data }) => data)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Assistent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fragen zu Firmen, Produkten, Markenfokus, Skript und Wissen — mit Quellenangabe.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <ChatAssistant companyContext={companyContext} />
        </CardContent>
      </Card>
    </div>
  );
}
