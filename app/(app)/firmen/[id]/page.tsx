import { Activity, Building2, Layers, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandFocusVerifyButton } from "@/components/brand-focus-verify-button";
import { EnrichNowButton } from "@/components/enrich-now-button";
import { FeedbackForm } from "@/components/feedback-form";
import { signalTypeLabel, signalTypeVariant } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const ratingFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFmt = new Intl.DateTimeFormat("de-DE");
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

const OUTCOME_LABELS: Record<string, string> = {
  sold: "Verkauft",
  interested: "Interessiert",
  rejected: "Abgelehnt",
  not_relevant: "Nicht relevant",
};

function money(value: number | null) {
  return value === null ? "-" : eur.format(value);
}

function date(value: string | null) {
  return value === null ? "-" : dateFmt.format(new Date(value));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "-"}</dd>
    </div>
  );
}

function IconTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      {children}
    </CardTitle>
  );
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: company, error }, { data: userData }, { data: feedbackHistory }, { data: signals }, { data: enrichment }] =
    await Promise.all([
      supabase.from("companies").select("*").eq("id", id).single(),
      supabase.auth.getUser(),
      supabase
        .from("sales_feedback")
        .select("id, outcome, qty, value_net, objection, comment, created_at, products(name), profiles(full_name)")
        .eq("company_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("signals")
        .select("id, type, score, reason, tier, origin, products(name)")
        .eq("company_id", id)
        .order("score", { ascending: false }),
      supabase.from("company_enrichment").select("*").eq("company_id", id).maybeSingle(),
    ]);

  if (error || !company) {
    notFound();
  }

  const agentId = userData.user!.id;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", agentId).single();
  const isAdmin = profile?.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border-l-4 bg-card p-5 ring-1 ring-foreground/10",
          company.call_priority ? "border-l-warning" : "border-l-primary",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {company.name}
          </h1>
          {company.call_priority ? (
            <Badge variant="warning">Zuerst anrufen</Badge>
          ) : null}
          {company.do_not_contact ? <Badge variant="muted">Gesperrt</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{company.kundennummer}</span> · {company.branche_name} ·{" "}
          {company.plz} {company.ort}
        </p>
        <Link
          href={`/assistent?company=${company.id}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Sparkles className="size-3.5" />
          Im Assistenten fragen →
        </Link>
      </div>

      {(enrichment && (enrichment.places_place_id || enrichment.strengths?.length || enrichment.weaknesses?.length)) ||
      isAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Firmenbrief</CardTitle>
              <p className="text-sm text-muted-foreground">
                Laut Google-Bewertungen{enrichment?.places_website ? " & Website" : ""} - KI-Analyse, nicht
                verifiziert wo nicht markiert.
              </p>
            </div>
            {isAdmin ? <EnrichNowButton companyId={company.id} /> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!enrichment || (!enrichment.places_place_id && !enrichment.strengths?.length) ? (
              <p className="text-sm text-muted-foreground">Noch nicht angereichert.</p>
            ) : null}
            {enrichment && enrichment.places_rating !== null ? (
              <p className="text-sm">
                <span className="font-medium">{ratingFmt.format(enrichment.places_rating)}/5</span>{" "}
                <span className="text-muted-foreground">
                  ({enrichment.places_review_count ?? 0} Bewertungen)
                  {enrichment.places_website ? (
                    <>
                      {" · "}
                      <a
                        href={enrichment.places_website}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Website
                      </a>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}

            {enrichment?.strengths && enrichment.strengths.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Stärken</p>
                <ul className="list-disc pl-5 text-sm">
                  {enrichment.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {enrichment?.weaknesses && enrichment.weaknesses.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Schwächen</p>
                <ul className="list-disc pl-5 text-sm">
                  {enrichment.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {enrichment?.brand_focus_guess && enrichment.brand_focus_guess.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Markenfokus (KI-Vermutung)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {enrichment.brand_focus_guess.map((brand, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Badge variant="secondary">{brand}</Badge>
                      {userData.user ? (
                        <BrandFocusVerifyButton
                          companyId={company.id}
                          brand={brand}
                          verifierId={userData.user.id}
                          alreadyVerified={enrichment.verified || !!company.brand_focus}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                {company.brand_focus ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stammdaten-Markenfokus: {company.brand_focus}
                  </p>
                ) : null}
              </div>
            ) : null}

            {enrichment?.external_opportunities && Array.isArray(enrichment.external_opportunities) && enrichment.external_opportunities.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Externe Chancen
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {(
                    enrichment.external_opportunities as {
                      category: string;
                      reason: string;
                      quote: string;
                      evidence_source?: "review" | "website" | "name_branche";
                      matched_products?: { id: string; sku: string; name: string }[];
                    }[]
                  ).map((o, i) => (
                    <li key={i}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{o.category}</span>
                        {o.evidence_source ? (
                          <Badge variant={o.evidence_source === "name_branche" ? "muted" : "secondary"}>
                            {o.evidence_source === "name_branche"
                              ? "laut Firmenname/Branche"
                              : o.evidence_source === "website"
                                ? "laut Website"
                                : "laut Bewertung"}
                          </Badge>
                        ) : null}
                      </div>
                      {o.reason}
                      <p className="mt-0.5 text-xs text-muted-foreground italic">&ldquo;{o.quote}&rdquo;</p>
                      {o.matched_products && o.matched_products.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {o.matched_products.map((p) => (
                            <Link
                              key={p.id}
                              href={`/katalog/${p.id}`}
                              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                            >
                              {p.name} ({p.sku})
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {signals && signals.length > 0 ? (
        <Card>
          <CardHeader>
            <IconTitle icon={Sparkles}>Empfehlungen</IconTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {signals.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={signalTypeVariant(s.type)}>{signalTypeLabel(s.type)}</Badge>
                      {(s.products as { name: string } | null)?.name ? (
                        <span className="font-medium">{(s.products as { name: string }).name}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-muted-foreground">{s.reason}</p>
                  </div>
                  <Badge variant={s.tier === 1 ? "muted" : "secondary"} className="shrink-0">
                    Tier {s.tier}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <IconTitle icon={Building2}>Stammdaten</IconTitle>
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
                label="Website"
                value={
                  company.website ? (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {company.website}
                    </a>
                  ) : null
                }
              />
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
            <IconTitle icon={Layers}>Segmentierung</IconTitle>
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
            <IconTitle icon={TrendingUp}>Umsatz</IconTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Vor-Vorjahr" value={money(company.revenue_prior_prior_year)} />
              <Field label="Vorjahr" value={money(company.revenue_prior_year)} />
              <Field label="Laufendes Jahr" value={money(company.revenue_current_year)} />
              <Field label="Laufendes Jahr (D&S/Cod.)" value={money(company.revenue_current_year_ds_cod)} />
              <Field label="Prognose" value={money(company.revenue_forecast)} />
              <Field
                label="Plus/Minus"
                value={
                  company.revenue_delta === null ? null : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        company.revenue_delta < 0 ? "text-destructive" : "text-success-foreground",
                      )}
                    >
                      {company.revenue_delta < 0 ? (
                        <TrendingDown className="size-3.5" />
                      ) : (
                        <TrendingUp className="size-3.5" />
                      )}
                      {money(company.revenue_delta)}
                    </span>
                  )
                }
              />
              <Field label="Anzahl Aufträge" value={company.order_count} />
              <Field label="Anzahl Artikel" value={company.article_count} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <IconTitle icon={Activity}>Aktivität</IconTitle>
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
          <CardTitle>Feedback erfassen</CardTitle>
        </CardHeader>
        <CardContent>
          <FeedbackForm companyId={company.id} agentId={agentId} />
        </CardContent>
      </Card>

      {feedbackHistory && feedbackHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Feedback-Verlauf</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {feedbackHistory.map((f) => (
                <li key={f.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        f.outcome === "sold"
                          ? "success"
                          : f.outcome === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {OUTCOME_LABELS[f.outcome] ?? f.outcome}
                    </Badge>
                    {(f.products as { name: string } | null)?.name ? (
                      <span className="font-medium">
                        {(f.products as { name: string }).name}
                      </span>
                    ) : null}
                    {f.qty ? <span className="text-muted-foreground">×{f.qty}</span> : null}
                    {f.value_net ? <span className="text-muted-foreground">{eur.format(f.value_net)}</span> : null}
                  </div>
                  {f.objection ? (
                    <p className="mt-1 text-muted-foreground">Einwand: {f.objection}</p>
                  ) : null}
                  {f.comment ? <p className="mt-1 text-muted-foreground">{f.comment}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(f.profiles as { full_name: string | null } | null)?.full_name ?? "-"} ·{" "}
                    {dateTimeFmt.format(new Date(f.created_at))}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
