/**
 * How many times a day each runner check may open the live site in a browser.
 * Every other visit goes to the runner's own copy of the same release, so the
 * live site (and its Netlify credits and database reads) is touched only by a
 * few real-site checks a day: what a copy on the runner cannot see (the CDN,
 * edge functions, Netlify headers, real network speed).
 *
 * The count is kept per check and per UTC day (the file that holds it is read and written by scripts/site.mts).
 */
/** Admin setting: live-site browser visits per check per day. Zero keeps every check on the runner's own copy. */
export const LIVE_VISITS_SETTING = "runner.liveSiteVisitsPerDay";
export const LIVE_VISITS_DEFAULT = 3;

export interface LiveVisitLedger {
  readonly day: string;
  readonly counts: Readonly<Record<string, number>>;
}

const dayOf = (nowIso: string) => nowIso.slice(0, 10);

/** Spend one live visit for `label` if its allowance for the day has room. */
export function takeLiveVisit(ledger: LiveVisitLedger | null, label: string, nowIso: string, perDay: number): { live: boolean; ledger: LiveVisitLedger } {
  const day = dayOf(nowIso);
  const counts = ledger?.day === day ? ledger.counts ?? {} : {};
  const used = counts[label] ?? 0;
  if (!(perDay > used)) return { live: false, ledger: { day, counts } };
  return { live: true, ledger: { day, counts: { ...counts, [label]: used + 1 } } };
}
