/** Source filing facts, kept separate from certified ballot membership and
 * candidate/committee joins. Those existing publishers retain their burdens. */
export const OFFICIAL_FILING_CLASSES = ["CANDIDATE_FILING_DOCUMENT", "CAMPAIGN_FINANCE_FILING", "CAMPAIGN_FINANCE_DOCUMENT"] as const;
export type OfficialFilingClass = typeof OFFICIAL_FILING_CLASSES[number];
export interface OfficialFiling {
  readonly id: string;
  readonly kind: OfficialFilingClass;
  readonly bodyId: string;
  readonly ocdId: string;
  readonly bodyName: string;
  readonly jurisdictionName: string;
  readonly sourceUrl: string;
  readonly documentUrl: string;
  readonly collectedAt: string;
  readonly verifiedAt: string;
  readonly facts: Readonly<Record<string, string | number>>;
}
const financeFields = ["candidateName", "committeeName", "committeeId", "filingPeriod", "filingDate", "reportType", "currency", "amount", "receipts", "expenditures", "cashOnHand"];
const fields = {
  CANDIDATE_FILING_DOCUMENT: ["candidateName", "office", "electionDate", "filingDate", "filingStatus", "party"],
  CAMPAIGN_FINANCE_FILING: financeFields,
  CAMPAIGN_FINANCE_DOCUMENT: financeFields,
} as const;
export function officialFilingIssue(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Filing is not an object.";
  const row = value as OfficialFiling;
  if (!(OFFICIAL_FILING_CLASSES as readonly string[]).includes(row.kind) || !row.id || !row.bodyId || !row.bodyName || !row.jurisdictionName ||
    !row.ocdId?.startsWith("ocd-division/") || !row.sourceUrl?.startsWith("https://") || !row.documentUrl?.startsWith("https://") ||
    !Number.isFinite(Date.parse(row.collectedAt)) || !Number.isFinite(Date.parse(row.verifiedAt))) return "Filing identity, territory, source or date is missing.";
  for (const address of [row.sourceUrl, row.documentUrl]) {
    try { const url = new URL(address); if (url.username || url.password || url.protocol !== "https:") return "Filing source is not public HTTPS."; }
    catch { return "Filing source URL is invalid."; }
  }
  if (!row.facts || typeof row.facts !== "object" || Array.isArray(row.facts)) return "Filing facts are missing.";
  const allowed = fields[row.kind] as readonly string[];
  if (Object.entries(row.facts).some(([key, value]) => !allowed.includes(key) ||
    !(typeof value === "string" && value.trim() || typeof value === "number" && Number.isFinite(value)))) return "Filing has an unsupported or empty fact.";
  const required = row.kind === "CANDIDATE_FILING_DOCUMENT" ? ["candidateName", "office"]
    : row.kind === "CAMPAIGN_FINANCE_FILING" ? ["filingPeriod"] : [];
  if (row.kind !== "CANDIDATE_FILING_DOCUMENT" && !["candidateName", "committeeName"].some(key => typeof row.facts[key] === "string" && String(row.facts[key]).trim())) return "Filing subject is missing.";
  if (required.some(key => typeof row.facts[key] !== "string" || !String(row.facts[key]).trim())) return "Filing required facts are missing.";
  const amounts = ["amount", "receipts", "expenditures", "cashOnHand"].filter(key => row.facts[key] !== undefined);
  if (row.kind === "CAMPAIGN_FINANCE_FILING" && amounts.length === 0) return "Money amount is missing; publish the filing document instead.";
  if (row.kind === "CAMPAIGN_FINANCE_DOCUMENT" && amounts.length > 0) return "Filing document cannot carry incomplete Money facts.";
  if (amounts.length && (row.facts.currency !== "USD" || amounts.some(key => typeof row.facts[key] !== "number"))) return "Financial amounts require numeric values and a verified USD currency.";
  return null;
}

/** A government body's association is not blanket geographic coverage. */
export function filingsForDivisions(rows: readonly OfficialFiling[], divisions: readonly string[]): readonly OfficialFiling[] {
  const scope = new Set(divisions);
  return rows.filter(row => scope.has(row.ocdId) && officialFilingIssue(row) === null);
}
