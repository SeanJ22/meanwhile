import { smallDonorSentence } from "./small-donors.ts";
import { mayRenderFiledName } from "./donor-privacy.ts";

export interface FiledOrganizationAmount {
  readonly kind: "COMMITTEE_OR_ORGANIZATION";
  readonly filedName: string;
  readonly filedType: string | null;
  readonly amount: number;
  readonly sourceUrl: string;
}
/** Publisher aggregates and report/cycle lines only; no private donor rows. */
export interface StateMoneyFunding {
  readonly organizations: readonly FiledOrganizationAmount[];
  readonly individualItemized: number | null;
  readonly individualUnitemized: number | null;
  readonly individualTotal: number | null;
  readonly scope: "ELECTION_CYCLE" | "REPORT_PERIOD" | "UNKNOWN";
}
export function stateMoneyFundingIssue(value: unknown): string | null {
  const row = value as StateMoneyFunding;
  if (!row || !Array.isArray(row.organizations) || !["ELECTION_CYCLE", "REPORT_PERIOD", "UNKNOWN"].includes(row.scope) ||
    [row.individualItemized, row.individualUnitemized, row.individualTotal].some(amount => amount !== null &&
      (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0))) return "Filed contributor aggregates are unreadable.";
  if (row.organizations.some(org => !org || !mayRenderFiledName(org) || !org.filedName?.trim() ||
    !(org.filedType === null || typeof org.filedType === "string") || typeof org.amount !== "number" || !Number.isFinite(org.amount) ||
    !/^https:\/\//.test(org.sourceUrl) || Object.keys(org).some(key => !["kind", "filedName", "filedType", "amount", "sourceUrl"].includes(key)))) {
    return "A contributor row is not a filed organization amount.";
  }
  return null;
}
/** Re-check at the display boundary; never trust a cast to erase a donor class. */
export function filedOrganizations(funding: StateMoneyFunding | undefined): readonly FiledOrganizationAmount[] {
  if (!funding || stateMoneyFundingIssue(funding)) return [];
  return funding.organizations.filter(mayRenderFiledName).slice().sort((a, b) => b.amount - a.amount || a.filedName.localeCompare(b.filedName));
}
export function stateSmallDonorSentence(funding: StateMoneyFunding | undefined): string | null {
  if (!funding || funding.scope !== "ELECTION_CYCLE" || stateMoneyFundingIssue(funding)) return null;
  return smallDonorSentence(funding.individualItemized, funding.individualUnitemized);
}
