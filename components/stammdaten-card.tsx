"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium">{value ?? "-"}</dd>
    </div>
  );
}

type Props = {
  companyId: string;
  nameZwei: string | null;
  kundennummer: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  telefon: string | null;
  telefon2: string | null;
  telefon3: string | null;
  email: string | null;
  website: string | null;
  gebiet: string | null;
  gebietAgentName: string | null;
  altesGebiet: string | null;
  verband: string | null;
};

// Alan's pilot feedback (2026-08-08): Stammdaten needs to be manually
// editable (a wrong phone number caught mid-call should be fixable on the
// spot) and moved to the first visible card on the profile. Deliberately
// scoped to contact fields only (telefon/telefon_2/telefon_3/email/website)
// via fn_update_company_contact - true VIS master-data fields (name,
// kundennummer, address) stay read-only/VIS-owned, same "enrichment never
// overwrites imported master data" principle as everywhere else (§3.2.6).
export function StammdatenCard(props: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [telefon, setTelefon] = useState(props.telefon ?? "");
  const [telefon2, setTelefon2] = useState(props.telefon2 ?? "");
  const [telefon3, setTelefon3] = useState(props.telefon3 ?? "");
  const [email, setEmail] = useState(props.email ?? "");
  const [website, setWebsite] = useState(props.website ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function startEdit() {
    setTelefon(props.telefon ?? "");
    setTelefon2(props.telefon2 ?? "");
    setTelefon3(props.telefon3 ?? "");
    setEmail(props.email ?? "");
    setWebsite(props.website ?? "");
    setErrorMessage(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_update_company_contact", {
      p_company_id: props.companyId,
      p_telefon: telefon,
      p_telefon_2: telefon2,
      p_telefon_3: telefon3,
      p_email: email,
      p_website: website,
    });
    setSaving(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" />
          Stammdaten
        </CardTitle>
        {editing ? (
          <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(false)} aria-label="Abbrechen">
            <X className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" onClick={startEdit} aria-label="Bearbeiten">
            <Pencil className="size-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="telefon">Telefon</Label>
                <Input id="telefon" value={telefon} onChange={(e) => setTelefon(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="telefon2">Telefon 2</Label>
                <Input id="telefon2" value={telefon2} onChange={(e) => setTelefon2(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="telefon3">Telefon 3</Label>
                <Input id="telefon3" value={telefon3} onChange={(e) => setTelefon3(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="email">E-Mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" size="sm" onClick={save} disabled={saving}>
                {saving ? "Speichern..." : "Speichern"}
              </Button>
              {errorMessage ? (
                <span className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            {props.nameZwei ? <Field label="Name 2" value={props.nameZwei} /> : null}
            <Field label="Kundennummer" value={props.kundennummer} />
            <Field label="Strasse" value={props.strasse} />
            <Field label="PLZ / Ort" value={`${props.plz ?? ""} ${props.ort ?? ""}`} />
            <Field label="Land" value={props.land} />
            {props.verband ? <Field label="Verband" value={props.verband} /> : null}
            <Field label="Telefon" value={props.telefon} />
            {props.telefon2 ? <Field label="Telefon 2" value={props.telefon2} /> : null}
            {props.telefon3 ? <Field label="Telefon 3" value={props.telefon3} /> : null}
            <Field label="E-Mail" value={props.email} />
            {props.website ? (
              <Field
                label="Website"
                value={
                  <a href={props.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {props.website}
                  </a>
                }
              />
            ) : null}
            <Field
              label="Gebiet"
              value={
                <>
                  {props.gebiet}
                  {props.gebietAgentName ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">({props.gebietAgentName})</span>
                  ) : null}
                </>
              }
            />
            <Field label="Altes Gebiet" value={props.altesGebiet} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
