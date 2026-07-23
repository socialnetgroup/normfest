"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Message = { role: "user" | "assistant"; content: string };
type PendingAction =
  | { action: "log_sales_feedback"; payload: LogFeedbackPayload }
  | { action: "request_enrichment"; payload: { company_id: string } };

type LogFeedbackPayload = {
  company_id: string;
  outcome: "sold" | "interested" | "rejected" | "not_relevant";
  product_id?: string;
  qty?: number;
  value_net?: number;
  objection?: string;
  comment?: string;
};

const OUTCOME_LABELS: Record<string, string> = {
  sold: "Verkauft",
  interested: "Interessiert",
  rejected: "Abgelehnt",
  not_relevant: "Nicht relevant",
};

function parseSseBuffer(buffer: string, onFrame: (event: string, data: unknown) => void) {
  const frames = buffer.split("\n\n");
  const remainder = frames.pop() ?? "";
  for (const frame of frames) {
    let event = "message";
    let dataLine = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    try {
      onFrame(event, JSON.parse(dataLine));
    } catch {
      // ignore malformed frame
    }
  }
  return remainder;
}

export function ChatAssistant({ companyContext }: { companyContext: { id: string; name: string } | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setErrorMessage(null);
    setPendingAction(null);
    setConfirmStatus("idle");
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, companyContext }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          setErrorMessage("Tages-Limit für den Assistenten erreicht. Bitte morgen wieder versuchen.");
        } else {
          setErrorMessage(`Fehler (${response.status})`);
        }
        setSending(false);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantIndex = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBuffer(buffer, (event, data) => {
          if (event === "text") {
            const delta = (data as { delta: string }).delta;
            setMessages((prev) => {
              if (assistantIndex === -1) {
                assistantIndex = prev.length;
                return [...prev, { role: "assistant", content: delta }];
              }
              const copy = [...prev];
              copy[assistantIndex] = { role: "assistant", content: copy[assistantIndex].content + delta };
              return copy;
            });
          } else if (event === "pending_action") {
            setPendingAction(data as PendingAction);
          } else if (event === "error") {
            setErrorMessage((data as { message: string }).message);
          }
        });
      }
    } catch {
      setErrorMessage("Verbindung zum Assistenten unterbrochen.");
    } finally {
      setSending(false);
    }
  }

  async function confirmLogFeedback(payload: LogFeedbackPayload) {
    setConfirmStatus("saving");
    setConfirmError(null);
    const response = await fetch("/api/chat/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log_sales_feedback", payload }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setConfirmStatus("error");
      setConfirmError(body.error ?? "Fehler beim Speichern.");
      return;
    }
    setConfirmStatus("done");
    setMessages((prev) => [...prev, { role: "assistant", content: "✅ Feedback gespeichert." }]);
    setPendingAction(null);
  }

  async function confirmEnrichment(companyId: string) {
    setConfirmStatus("saving");
    setConfirmError(null);
    const response = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setConfirmStatus("error");
      setConfirmError(body.error ?? "Fehler bei der Anreicherung.");
      return;
    }
    setConfirmStatus("done");
    setMessages((prev) => [...prev, { role: "assistant", content: "✅ Anreicherung abgeschlossen." }]);
    setPendingAction(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {companyContext ? (
        <p className="text-sm text-muted-foreground">
          Kontext: <span className="font-medium text-foreground">{companyContext.name}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Frag mich z.B. nach einer Firma, einem Einwand, einem Produkt oder Markenfokus.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end rounded-xl bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                : "self-start rounded-xl bg-muted px-3.5 py-2 text-sm whitespace-pre-line"
            }
          >
            {m.content}
          </div>
        ))}
      </div>

      {pendingAction ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bestätigung erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pendingAction.action === "log_sales_feedback" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{OUTCOME_LABELS[pendingAction.payload.outcome]}</Badge>
                {pendingAction.payload.qty ? <span>×{pendingAction.payload.qty}</span> : null}
                {pendingAction.payload.value_net ? <span>{pendingAction.payload.value_net} €</span> : null}
                {pendingAction.payload.objection ? <span>Einwand: {pendingAction.payload.objection}</span> : null}
                {pendingAction.payload.comment ? <span>{pendingAction.payload.comment}</span> : null}
              </div>
            ) : (
              <p className="text-sm">KI-Anreicherung für diese Firma jetzt anstoßen (Google + Website + Analyse).</p>
            )}
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={confirmStatus === "saving"}
                onClick={() =>
                  pendingAction.action === "log_sales_feedback"
                    ? confirmLogFeedback(pendingAction.payload)
                    : confirmEnrichment(pendingAction.payload.company_id)
                }
              >
                {confirmStatus === "saving" ? "Wird ausgeführt..." : "Bestätigen"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingAction(null)}>
                Abbrechen
              </Button>
              {confirmStatus === "error" && confirmError ? (
                <span className="text-sm text-destructive">{confirmError}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Frage an den Assistenten..."
          disabled={sending}
          className="h-10"
        />
        <Button type="submit" disabled={sending || !input.trim()} className="h-10">
          {sending ? "..." : "Senden"}
        </Button>
      </form>
    </div>
  );
}
