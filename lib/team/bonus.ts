// Shared daily-bonus math, used by the Team Dashboard overview and the
// per-day drill-down (§14 item 7) — kept in one place so the two never drift.
export type BonusThreshold = { team_revenue: number; bonus_km: number };

export type BonusAgentInput = { agentId: string; name: string; revenue: number; dayOff: boolean };

export function computeDailyBonus(
  agents: BonusAgentInput[],
  thresholds: BonusThreshold[],
  minContributionPct: number,
  minQualifyingAgents: number,
) {
  const active = agents.filter((a) => !a.dayOff);
  const teamRevenue = active.reduce((sum, a) => sum + a.revenue, 0);

  const sortedThresholds = [...thresholds].sort((a, b) => a.team_revenue - b.team_revenue);
  let thresholdReached: BonusThreshold | null = null;
  for (const t of sortedThresholds) {
    if (teamRevenue >= t.team_revenue) thresholdReached = t;
  }
  const budget = thresholdReached?.bonus_km ?? 0;

  const withContribution = active.map((a) => ({
    ...a,
    contributionPct: teamRevenue > 0 ? (a.revenue / teamRevenue) * 100 : 0,
  }));
  const qualifying = withContribution.filter((a) => a.revenue > 0 && a.contributionPct >= minContributionPct);
  const qualifyingSumPct = qualifying.reduce((sum, a) => sum + a.contributionPct, 0);
  const enoughQualifiers = qualifying.length >= minQualifyingAgents;

  const results = withContribution
    .map((a) => {
      const qualifies = a.revenue > 0 && a.contributionPct >= minContributionPct;
      const bonusKm =
        enoughQualifiers && qualifies && budget > 0 && qualifyingSumPct > 0
          ? Math.round((a.contributionPct / qualifyingSumPct) * budget * 100) / 100
          : 0;
      return { ...a, qualifies, bonusKm };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    teamRevenue,
    thresholdReached,
    budget,
    qualifyingCount: qualifying.length,
    minQualifyingAgents,
    enoughQualifiers,
    results,
  };
}

export function shiftDate(date: string, deltaDays: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
