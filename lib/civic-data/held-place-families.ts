import type { BallotSet } from "../ballot/types.ts";
import type { VotingSitesFile } from "../ballot/voting-sites.ts";
import { VOTING_SITES_CONTRACT } from "../ballot/voting-sites-data-plane.ts";
import { ELECTION_DATES, type ElectionDates } from "../ballot/election-dates.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { FEDERAL_DIRECTORY_SCOPE, type FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { FundingSnapshot } from "../funding/types.ts";
import type { StateMoneySnapshot } from "../funding/state-money.ts";
import { isRenderable } from "../funding/state-money-reader.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../funding/data-plane.ts";
import { requiredRoutineContract } from "./contracts.ts";
import { readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../state-rollcalls/authority.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";
import { officialFilingIssue, type OfficialFiling } from "./official-filings.ts";
import { readPromotedCivicData, readPromotedCivicDataBatch, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import type { HeldPlaceCapture } from "./held-place-capture.ts";
import { electionFieldIssue, type PublishedElectionField } from "./election-fields.ts";

/** Canonical published families, plus the existing explicitly adopted election calendars. */
export interface HeldPlaceFamilies {
  readonly rosters?: readonly OfficeholderSet[];
  readonly ballots?: readonly BallotSet[];
  readonly votingSites?: VotingSitesFile | null;
  readonly funding?: FundingSnapshot | null;
  readonly stateMoney?: readonly StateMoneySnapshot[];
  readonly filings?: readonly OfficialFiling[];
  readonly electionDates?: readonly ElectionDates[];
  readonly electionFields?: readonly PublishedElectionField[];
}

function value<T>(read: CivicDataReadResult<T>): T | null {
  if (read.kind === "PROMOTED") return read.value;
  if (read.kind === "NOT_RECORDED") return null;
  throw new Error(`HELD_PLACE_READ_FAILED:${read.metadata.recordClass}:${read.metadata.scope}:${read.kind}`);
}

export async function readHeldPlaceFamilies(divisionIds: readonly string[], options: PromotedCivicDataReadOptions): Promise<HeldPlaceFamilies> {
  const states = new Set(divisionIds.flatMap(id => /\/state:([^/]+)/.exec(id)?.[1].toUpperCase() ?? []));
  const ballotContracts = ["az-sos-ballot", "nh-curated-ballot"] as const;
  const manualBallots = ballotContracts.map(id => requiredManualProductionContract(id))
    .filter(contract => states.has(contract.scope.slice(3, 5)));
  const stateTargets = OFFICIAL_STATE_LEGISLATOR_TARGETS.filter(target => states.has(target.state));
  const moneyScopes = (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[])
    .filter(state => states.has(state)).map(state => STATE_CAMPAIGN_FINANCE_SOURCES[state].scope);
  const nj = requiredRoutineContract("nj-morris-filing");
  const filings = requiredManualProductionContract("official-filings");
  const navigation = requiredManualProductionContract("ballot-navigation");
  const fec = requiredRoutineContract("fec-funding");
  const [federal, legislators, ballots, njBallot, votingSites, funding, money, filingRead, navigationRead] = await Promise.all([
    readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE, options),
    Promise.all(stateTargets.map(target => readOfficialStateLegislatorsProjection(target.jurisdiction, options))),
    readPromotedCivicDataBatch<{ ballot: BallotSet }>("BALLOT_CANDIDACY", manualBallots.map(contract => contract.scope), options),
    states.has("NJ") ? readPromotedCivicData<{ ballot: BallotSet }>(nj.recordClass, nj.scope, options) : null,
    readPromotedCivicData<VotingSitesFile>(VOTING_SITES_CONTRACT.recordClass, VOTING_SITES_CONTRACT.scope, options),
    readPromotedCivicData<FundingSnapshot>(fec.recordClass, fec.scope, options),
    readPromotedCivicDataBatch<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", moneyScopes, options),
    readPromotedCivicData<CuratedReaderProjection>(filings.recordClass, filings.scope, options),
    readPromotedCivicData<CuratedReaderProjection>(navigation.recordClass, navigation.scope, options),
  ]);
  return {
    rosters: [value(federal)?.roster, ...legislators.map(read => value(read)?.roster)].filter((row): row is OfficeholderSet => row !== undefined),
    ballots: [...ballots, ...(njBallot ? [njBallot] : [])].flatMap(read => value(read)?.ballot ?? []),
    votingSites: value(votingSites), funding: value(funding), stateMoney: money.flatMap(read => value(read) ?? []),
    filings: (value(filingRead)?.records ?? []).filter(row => officialFilingIssue(row) === null) as unknown as OfficialFiling[],
    electionDates: ELECTION_DATES.filter(row => states.has(row.state)),
    electionFields: (value(navigationRead)?.records ?? []).filter(row => electionFieldIssue(row) === null) as unknown as PublishedElectionField[],
  };
}

/** No names, state-wide money expansion, or original-job/ZIP filters participate in joins. */
export function projectHeldPlaceFamilies(divisionIds: readonly string[], registry: RegistryRuntimeReadModel | null, families: HeldPlaceFamilies): HeldPlaceCapture {
  const wanted = new Set(divisionIds);
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>();
  const held: HeldPlaceCapture["held"][number][] = [];
  const targets = new Map<string, readonly string[]>();
  const subject = (id: string, kind: HeldPlaceCapture["subjects"][number]["kind"], divisions: readonly string[], label: string) => {
    if (!divisions.some(division => wanted.has(division))) return false;
    const previous = subjects.get(id);
    subjects.set(id, { id, kind, divisionIds: [...new Set([...(previous?.divisionIds ?? []), ...divisions])], label });
    targets.set(id, [...new Set([...(targets.get(id) ?? []), ...divisions])]);
    return true;
  };
  const field = (subjectId: string, checklistId: string, item: unknown, sourceUrl: string | null, checkedAt: string, hours: number, state: "published" | "held" = "published") => {
    const checked = Date.parse(checkedAt);
    if (item === null || item === undefined || !sourceUrl || !Number.isFinite(checked)) return;
    held.push({ subjectId, checklistId, state, sourceUrl, checkedAt, freshUntil: new Date(checked + hours * 3_600_000).toISOString(), value: item });
  };
  for (const roster of families.rosters ?? []) {
    const divisionsByHolder = new Map<string, string[]>();
    for (const row of roster.divisions) divisionsByHolder.set(row.officeholderId, [...(divisionsByHolder.get(row.officeholderId) ?? []), row.ocdId]);
    for (const holder of roster.officeholders) {
      const divisions = divisionsByHolder.get(holder.id) ?? [];
      if (!subject(holder.id, "seat", divisions, holder.officeTitle)) continue;
      const add = (id: string, item: unknown) => field(holder.id, id, item, holder.provenance.sourceUrl, holder.provenance.collectedAt, 24);
      add("OFF-04", { name: holder.name, office: holder.officeTitle });
      add("OFF-08", { profile: holder.websiteUrl, source: holder.provenance.sourceUrl });
      if (holder.termStart || holder.termEnd) add("OFF-06", { start: holder.termStart, end: holder.termEnd });
      if (holder.email || holder.phone || holder.contactFormUrl) add("OFF-09", { email: holder.email, phone: holder.phone, contactFormUrl: holder.contactFormUrl });
      if (holder.partyLabel) add("OFF-11", holder.partyLabel);
    }
  }
  for (const row of registry?.statewideExecutives ?? []) {
    const holder = row.holder;
    if (!subject(holder.id, "seat", [row.stateOcdId], holder.officeTitle)) continue;
    const add = (id: string, item: unknown) => field(holder.id, id, item, row.sourceUrl, row.collectedAt, 30 * 24);
    add("OFF-04", { name: holder.name, office: holder.officeTitle });
    add("OFF-08", { profile: holder.websiteUrl, source: row.sourceUrl });
    if (holder.termEnd) add("OFF-06", { end: holder.termEnd });
    if (holder.email || holder.phone || holder.contactFormUrl) add("OFF-09", { email: holder.email, phone: holder.phone, contactFormUrl: holder.contactFormUrl });
    if (holder.partyLabel && row.partySourceUrl) field(holder.id, "OFF-11", holder.partyLabel, row.partySourceUrl, row.collectedAt, 30 * 24);
  }
  // Exact membership/candidacy bridges also let a finance target reach every served division.
  for (const body of registry?.registry.bodies ?? []) {
    const divisions = [body.ocdId, ...(body.alsoServesOcdIds ?? [])].filter((id): id is string => id !== null);
    if (!divisions.some(id => wanted.has(id))) continue;
    for (const roster of registry?.bodyRosters ?? []) if (roster.bodyId === body.id) {
      for (const member of roster.members) targets.set(member.id, divisions);
    }
  }
  for (const bridge of registry?.officialCandidacies?.rows ?? []) {
    if (bridge.status === "RESOLVED" && bridge.candidacy && bridge.holder.divisions.some(id => wanted.has(id))) {
      targets.set(bridge.candidacy.candidacyId, bridge.holder.divisions);
    }
  }
  for (const ballot of families.ballots ?? []) {
    for (const contest of ballot.contests) {
      const divisions = [contest.ocdId];
      if (!subject(contest.id, "contest", divisions, contest.title)) continue;
      const add = (id: string, item: unknown) => field(contest.id, id, item, contest.provenance.sourceUrl, contest.provenance.collectedAt, 24);
      add("ELE-01", ballot.election);
      add("ELE-04", { office: contest.title, divisionId: contest.ocdId, termYears: contest.termYears, voteFor: contest.voteFor });
      for (const candidate of ballot.candidacies.filter(row => row.contestId === contest.id)) {
        subject(candidate.id, "contest", divisions, `${candidate.givenName} ${candidate.familyName}`);
        field(candidate.id, "CAN-01", { id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}` }, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, 24);
        field(candidate.id, "CAN-02", { contestId: contest.id, electionId: contest.electionId, office: contest.title, divisionId: contest.ocdId }, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, 24);
        if (candidate.incumbent !== null) field(candidate.id, "CAN-03", candidate.incumbent, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, 24);
      }
      for (const measure of ballot.measures.filter(row => row.contestId === contest.id)) {
        field(contest.id, "ELE-11", { question: measure.questionText, divisionId: contest.ocdId }, measure.provenance.sourceUrl, measure.provenance.collectedAt, 24);
      }
    }
  }
  for (const jurisdiction of families.votingSites?.jurisdictions ?? []) {
    if (jurisdiction.refusal || !jurisdiction.sites.length || !subject(`voting-sites:${jurisdiction.ocdId}`, "deadline", [jurisdiction.ocdId], jurisdiction.name)) continue;
    field(`voting-sites:${jurisdiction.ocdId}`, "ELE-09", { model: jurisdiction.model, election: jurisdiction.election, sites: jurisdiction.sites }, jurisdiction.sourceUrl, jurisdiction.collectedAt, 24);
  }
  for (const calendar of families.electionDates ?? []) {
    const division = `ocd-division/country:us/state:${calendar.state.toLowerCase()}`;
    for (const step of calendar.steps) {
      const id = `election-calendar:${calendar.state}:${calendar.electionDay}:${step.label}`;
      if (!subject(id, "deadline", [division], step.label)) continue;
      // Version-adopted source facts are held on their actual date, never relabeled as a fresh canonical publication.
      field(id, /filing|certification/i.test(step.label) ? "ELE-06" : "ELE-08", step, calendar.sourceUrl, calendar.collectedAt, 24, "held");
    }
  }
  for (const row of families.electionFields ?? []) {
    if (electionFieldIssue(row) !== null || !subject(row.id, row.value.fieldKind === "certified_outcome" ? "contest" : "deadline", [row.value.divisionId], row.value.quote)) continue;
    field(row.id, row.value.fieldKind === "certified_outcome" ? "ELE-15" : row.value.fieldKind.endsWith("_lookup") ? "ELE-09" : "ELE-08", row.value,
      row.value.url, row.value.collectedAt, 7 * 24);
  }
  const moneyDivisions = (keys: readonly string[]) => [...new Set(keys.flatMap(key => targets.get(key) ?? []))];
  for (const record of families.funding?.candidates ?? []) {
    const divisions = moneyDivisions(record.targetKeys);
    const id = `fec:${record.fecCandidateId}:${record.principalCommitteeId ?? "unrecorded"}:${record.cycle}`;
    if (!subject(id, "funding", divisions, record.name)) continue;
    const add = (key: string, item: unknown) => field(id, key, item, record.provenance.sourceUrl, record.provenance.collectedAt, 24);
    add("CAM-01", { authority: "FEC", candidateId: record.fecCandidateId });
    if (record.principalCommitteeId) add("CAM-02", { committeeId: record.principalCommitteeId, candidateId: record.fecCandidateId, targetKeys: record.targetKeys });
    add("CAM-05", { amount: record.totals.receipts, coverageEndDate: record.totals.coverageEndDate, cycle: record.cycle });
    add("CAM-06", { amount: record.totals.disbursements, coverageEndDate: record.totals.coverageEndDate, cycle: record.cycle });
    add("CAM-07", { cashOnHand: record.totals.cashOnHand, coverageEndDate: record.totals.coverageEndDate, cycle: record.cycle });
  }
  for (const snapshot of families.stateMoney ?? []) for (const record of snapshot.records) {
    if (!isRenderable(record)) continue;
    const divisions = moneyDivisions(record.targetKeys);
    const id = `state-money:${record.jurisdiction}:${record.electionYear}:${record.committeeId ?? record.targetKeys.join("+")}`;
    if (!subject(id, "funding", divisions, record.registeredName || record.candidateNameAsFiled)) continue;
    const add = (key: string, item: unknown) => field(id, key, item, record.provenance.sourceUrl, record.checkedAt, 24);
    add("CAM-01", { agency: record.agency, filingsUrl: record.filingsUrl });
    if (record.committeeId && record.match.allThreeAgree) add("CAM-02", { committeeId: record.committeeId, name: record.registeredName, targetKeys: record.targetKeys });
    if (record.filingState !== "FILED") continue;
    if (record.totals.coveringPeriod) add("CAM-03", record.totals.coveringPeriod);
    if (record.totals.receipts !== null) add("CAM-05", { amount: record.totals.receipts, period: record.totals.coveringPeriod });
    if (record.totals.expenditures !== null) add("CAM-06", { amount: record.totals.expenditures, period: record.totals.coveringPeriod });
    if (record.totals.cashOnHand !== null) add("CAM-07", { cashOnHand: record.totals.cashOnHand, period: record.totals.coveringPeriod });
  }
  for (const filing of families.filings ?? []) {
    if (officialFilingIssue(filing) !== null || !subject(filing.id, filing.kind === "CAMPAIGN_FINANCE_FILING" ? "funding" : "contest", [filing.ocdId], filing.bodyName)) continue;
    const add = (id: string, item: unknown) => field(filing.id, id, item, filing.documentUrl, filing.collectedAt, 24);
    if (filing.kind === "CANDIDATE_FILING_DOCUMENT") {
      add("CAN-01", { name: filing.facts.candidateName, document: filing.documentUrl });
      // A filing is not certification, and its body ID never invents a contest join.
    } else {
      if (filing.facts.committeeId) add("CAM-02", { committeeId: filing.facts.committeeId, name: filing.facts.committeeName });
      add("CAM-03", { period: filing.facts.filingPeriod, filingDate: filing.facts.filingDate, reportType: filing.facts.reportType });
      for (const [key, id] of [["receipts", "CAM-05"], ["expenditures", "CAM-06"], ["cashOnHand", "CAM-07"]] as const) {
        if (filing.facts[key] !== undefined) add(id, { amount: filing.facts[key], period: filing.facts.filingPeriod, currency: filing.facts.currency });
      }
    }
  }
  return { subjects: [...subjects.values()], held };
}
