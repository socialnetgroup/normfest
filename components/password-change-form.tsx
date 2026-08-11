"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

/** Self-service password change - Anis, 2026-08-11: "do the option to set
 * your own Password after 1st logging" (new agent accounts start on a
 * shared temp password). The password itself goes through Supabase Auth's
 * own auth.updateUser({password}) under the caller's existing session (no
 * old-password re-entry needed - that's Supabase's standard behavior for a
 * user changing their own already-authenticated account); fn_clear_
 * must_change_password() only clears the app-level forced-flow flag once
 * that succeeds. */
export function PasswordChangeForm({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);
      return;
    }
    if (password !== confirm) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setPending(false);
      setError(updateErr.message);
      return;
    }

    if (mustChange) {
      await supabase.rpc("fn_clear_must_change_password");
    }

    setPending(false);
    setDone(true);
    router.refresh();
    if (mustChange) {
      router.push("/");
    }
  }

  if (done && !mustChange) {
    return <p className="text-sm text-success-foreground">Passwort erfolgreich geändert.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-sm">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Neues Passwort</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_LENGTH}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Passwort bestätigen</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={MIN_LENGTH}
          required
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Speichern..." : "Passwort speichern"}
      </Button>
    </form>
  );
}
