// Groups adjacent rows sharing the same non-null batch_id (§14 item 69's
// "Weitere Position" follow-up, 2026-08-14) - rows from one multi-position
// submit are always written back-to-back and queried in the same
// created_at-desc order, so a simple adjacency scan is enough; no need to
// bucket by id across the whole page.
export function groupFeedbackRows<T extends { batch_id: string | null }>(rows: T[]): T[][] {
  const groups: T[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.batch_id && last && last[0].batch_id === row.batch_id) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}
