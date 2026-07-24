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

export type DailyRevenueRow = { agentId: string; date: string; revenue: number; dayOff: boolean };

/** Groups daily performance rows by date and runs computeDailyBonus per day,
 * returning date -> agentId -> bonusKm. Needs EVERY agent's row for a given
 * date to compute team revenue/thresholds correctly -- never call this with
 * a single agent's rows only. */
export function computeBonusByDate(
  rows: DailyRevenueRow[],
  thresholds: BonusThreshold[],
  minContributionPct: number,
  minQualifyingAgents: number,
): Map<string, Map<string, number>> {
  const byDate = new Map<string, DailyRevenueRow[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const result = new Map<string, Map<string, number>>();
  for (const [date, dayRows] of byDate) {
    const agentsInput: BonusAgentInput[] = dayRows.map((r) => ({
      agentId: r.agentId,
      name: "",
      revenue: r.revenue,
      dayOff: r.dayOff,
    }));
    const { results } = computeDailyBonus(agentsInput, thresholds, minContributionPct, minQualifyingAgents);
    const dayMap = new Map<string, number>();
    for (const res of results) dayMap.set(res.agentId, res.bonusKm);
    result.set(date, dayMap);
  }
  return result;
}

export function shiftDate(date: string, deltaDays: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
