import { redirect } from "next/navigation";

import { StandaloneFeedbackFlow } from "@/components/standalone-feedback-flow";
import { getCurrentUser } from "@/lib/auth";

export default async function NeuFeedbackPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Feedback erfassen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Firma suchen, dann Ergebnis erfassen.
        </p>
      </div>
      <StandaloneFeedbackFlow />
    </div>
  );
}
