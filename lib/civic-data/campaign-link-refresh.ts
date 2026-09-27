/** Publication may refresh the evidence for an unchanged URL without a human
 * step. A different URL is an unresolved identity/source conflict, not an
 * automatic replacement. Day-only old evidence cannot establish same-day order. */
export function campaignLinkRefreshIssue(
  prior: { readonly url: string; readonly attemptedAt: string } | null | undefined,
  next: { readonly url: string; readonly attemptedAt: string },
): string | null {
  if (!prior) return null;
  try {
    if (new URL(prior.url).href !== new URL(next.url).href) return "CONFLICTING_CAMPAIGN_URL: verify which of the different source URLs is current";
  } catch { return "CAMPAIGN_URL_INVALID: repair the malformed URL before changing the held link"; }
  const day = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  };
  const before = day(prior.attemptedAt), after = day(next.attemptedAt);
  if (before === null || after === null) return "CAMPAIGN_READ_DATE_UNVERIFIED: establish the observation dates before replacing evidence";
  return after > before ? null : "CAMPAIGN_READ_NOT_NEWER: retain the equally recent or newer verified evidence";
}
