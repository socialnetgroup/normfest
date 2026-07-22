import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFmt = new Intl.DateTimeFormat("de-DE");

function money(value: number | null) {
  return value === null ? "—" : eur.format(value);
}

function date(value: string | null) {
  return value === null ? "—" : dateFmt.format(new Date(value));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: company, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !company) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {company.name}
          </h1>
          {company.call_priority ? (
            <Badge variant="warning">Zuerst anrufen</Badge>
          ) : null}
          {company.do_not_contact ? <Badge variant="muted">Gesperrt</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {company.kundennummer} · {company.branche_name} ·{" "}
          {company.plz} {company.ort}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stammdaten</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Name 2" value={company.name_2} />
              <Field label="Kundennummer" value={company.kundennummer} />
              <Field label="Strasse" value={company.strasse} />
              <Field label="PLZ / Ort" value={`${company.plz ?? ""} ${company.ort ?? ""}`} />
              <Field label="Land" value={company.land} />
              <Field label="Telefon" value={company.telefon} />
              <Field label="E-Mail" value={company.email} />
              <Field
                label="Gebiet"
                value={
                  <>
                    {company.gebiet}
                    {company.gebiet_agent_name ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        ({company.gebiet_agent_name})
                      </span>
                    ) : null}
                  </>
                }
              />
              <Field label="Altes Gebiet" value={company.legacy_gebiet} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Segmentierung</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Branche" value={`${company.branche_code ?? ""} ${company.branche_name ?? ""}`} />
              <Field label="Cluster" value={company.cluster} />
              <Field label="Verband" value={company.verband} />
              <Field label="Gruppe" value={company.gruppe} />
              <Field label="Klasse" value={company.size_class} />
              <Field label="Potential" value={money(company.potential_value)} />
              <Field
                label="Potential-Ausschöpfung"
                value={company.potential_utilization_pct !== null ? `${company.potential_utilization_pct}%` : null}
              />
              <Field label="Mahnstufe" value={company.dunning_level} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Umsatz</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Vor-Vorjahr" value={money(company.revenue_prior_prior_year)} />
              <Field label="Vorjahr" value={money(company.revenue_prior_year)} />
              <Field label="Laufendes Jahr" value={money(company.revenue_current_year)} />
              <Field label="Laufendes Jahr (D&S/Cod.)" value={money(company.revenue_current_year_ds_cod)} />
              <Field label="Prognose" value={money(company.revenue_forecast)} />
              <Field label="Plus/Minus" value={money(company.revenue_delta)} />
              <Field label="Anzahl Aufträge" value={company.order_count} />
              <Field label="Anzahl Artikel" value={company.article_count} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivität</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Letzter Besuch" value={date(company.last_visit_date)} />
              <Field label="Letzter Kontakt" value={date(company.last_contact_date)} />
              <Field label="Letzte Rechnung" value={company.last_invoice_period} />
              <Field label="Letzte Kundenbewertung" value={date(company.last_review_date)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notizen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Kommt in M2 (Feedback-Erfassung + Notizen).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
