/** Candidate/event history owns retry state; a success or a different failure ends the streak. */
export function repeatedFailureStreak(rows: readonly { readonly failureCode: string | null; readonly failureDetail: string | null }[]): number {
  const signature = (row: typeof rows[number]) => row.failureCode === null ? null
    : `${row.failureCode}:${/\bHTTP(?: status)?[: ]+(\d{3})\b/i.exec(row.failureDetail ?? "")?.[1] ?? ""}:${(row.failureDetail ?? "").replace(/[a-f0-9]{32,}|\d+/gi, "#")}`;
  const latest = rows[0] && signature(rows[0]);
  if (!latest) return 0;
  const end = rows.findIndex(row => signature(row) !== latest);
  return end < 0 ? rows.length : end;
}

export function failureRetryMs(baseMs: number, clock: { readonly failureStreak?: number; readonly lastAttemptedAt?: string; readonly lastSucceededObservedAt?: string } | undefined): number {
  const succeeded = Date.parse(clock?.lastSucceededObservedAt ?? "");
  const attempted = Date.parse(clock?.lastAttemptedAt ?? "");
  const streak = Number.isFinite(succeeded) && succeeded >= attempted ? 0 : clock?.failureStreak ?? 0;
  return Math.min(86_400_000, baseMs * 2 ** Math.min(16, Math.max(0, streak - 1)));
}
