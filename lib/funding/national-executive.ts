import { readNationalPresident } from "../reader/national.ts";
import { whiteHouseOffice } from "../officials/white-house-offices.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { FundingAnswer, FundingDisplayData } from "./display.ts";
import { plainMoney } from "./plain-money.ts";
import { smallDonorSentence } from "./small-donors.ts";

/** President money is already part of the resident national people projection. */
export function nationalExecutiveFundingAnswer(target: string, roster: OfficeholderSet | null): FundingAnswer {
  if (!target.startsWith("white-house:") || !roster) return { kind: "none" };
  const country = new Set(roster.divisions.filter(link => link.ocdId === "ocd-division/country:us").map(link => link.officeholderId));
  const people = roster.officeholders.filter(person => person.id === target && country.has(person.id) && whiteHouseOffice(person.officeTitle) === "president"
    && person.memberships?.some(membership => membership.current === true && membership.divisionId === "ocd-division/country:us" && whiteHouseOffice(membership.officeTitle ?? person.officeTitle) === "president"));
  if (people.length !== 1) return { kind: "none" };
  const person = people[0], money = person.executive?.money;
  if (!money || !/^P\d{8}$/.test(money.candidateId) || !person.fecCandidateIds?.includes(money.candidateId) || !Number.isInteger(money.cycle) || money.cycle % 2 !== 0
    || !Number.isFinite(Date.parse(money.collectedAt)) || !money.totals.coverageEndDate) return { kind: "none" };
  let sourceUrl: string;
  try {
    const source = new URL(money.sourceUrl);
    if (source.protocol !== "https:" || source.hostname !== "www.fec.gov" || source.pathname !== `/data/candidate/${money.candidateId}/`) return { kind: "none" };
    sourceUrl = source.href;
    if (money.filingUrl) {
      const filing = new URL(money.filingUrl);
      if (filing.protocol === "https:" && filing.hostname === "docquery.fec.gov" && filing.pathname === "/cgi-bin/fecimg/" && /^\?\d+$/.test(filing.search)) sourceUrl = filing.href;
    }
  } catch { return { kind: "none" }; }
  const totals = money.totals;
  const data: FundingDisplayData = {
    fecCandidateId: money.candidateId, name: person.name, cycleLabel: `${money.cycle - 1}–${String(money.cycle).slice(2)}`,
    sentences: [], totals, contributors: [], contributorGroups: { organizations: [], individuals: [] }, contributorsShown: false,
    secondHop: {}, reportedThrough: totals.coverageEndDate, concentration: null, concentrationSentences: [], typeConcentrationSentences: [],
    sourceUrl, sourceOrg: "Federal Election Commission", collectedAt: money.collectedAt,
  };
  const figures = [totals.receipts === null ? null : `raised ${plainMoney(totals.receipts)}`, totals.disbursements === null ? null : `spent ${plainMoney(totals.disbursements)}`].filter(Boolean);
  if (figures.length) data.sentences.push(`This campaign has ${figures.join(" and ")} in the ${data.cycleLabel} election cycle.`);
  if (totals.cashOnHand !== null) data.sentences.push(`It has ${plainMoney(totals.cashOnHand)} on hand.`);
  const small = smallDonorSentence(totals.individualItemized, totals.individualUnitemized);
  if (small) data.sentences.push(small);
  return { kind: "funding", data };
}

/** Reuses the same cold-read promise and resident value every place page uses. */
export async function readNationalExecutiveFunding(target: string, read = readNationalPresident): Promise<FundingAnswer> {
  return nationalExecutiveFundingAnswer(target, await read());
}
