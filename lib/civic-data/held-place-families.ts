import { readStateAuthorityProjection } from "./state-reader.ts";
import type { StateAuthorityFamily } from "../meetings/edge-artifacts.ts";
import { REGISTRY_STATES, stateBallotScope } from "./state-scopes.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";
import type { BallotSet } from "../ballot/types.ts";
import { type GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { VotingSitesFile } from "../ballot/voting-sites.ts";
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
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import type { HeldPlaceCapture } from "./held-place-capture.ts";
import { electionFieldIssue, type PublishedElectionField } from "./election-fields.ts";
import { heldPlaceValue as value, readPlacePointerSlice } from "./held-place-slices.ts";
import type { PlaceCaptureKind } from "../coverage/place-owed.ts";
import type { CandidateProfilesProjection } from "./manual-projections.ts";
import { currentExtraction, type CandidateDocument, type CandidateCorpus } from "../candidates/corpus.ts";
import { candidateDescriptionQualityIssue } from "../candidates/blurbs.ts";
import { deriveCandidateUniverse } from "../hunt/candidate-universe.ts";
import { campaignSiteSubjects, type LineupContest } from "../candidates/campaign-site-subjects.ts";
import { composeCampaignLinks,
  type DerivedCampaignSitesProjection, type DerivedCampaignSiteRecord } from "./derived-campaign-sites.ts";
import { FRESHNESS_HOURS } from "../coverage/checklist-map.ts";

export interface HeldPlaceFamilies {
  readonly rosters?: readonly OfficeholderSet[];
  readonly ballots?: readonly BallotSet[];
  readonly votingSites?: VotingSitesFile | null;
  readonly funding?: FundingSnapshot | null;
  readonly stateMoney?: readonly StateMoneySnapshot[];
  readonly filings?: readonly OfficialFiling[];
  readonly electionDates?: readonly ElectionDates[];
  readonly electionFields?: readonly PublishedElectionField[];
  readonly candidateProfiles?: CandidateProfilesProjection | null;
  readonly candidatePublications?: readonly CandidateDocument[];
  readonly candidateLineups?: readonly LineupContest[];
  readonly derivedCampaignSites?: readonly DerivedCampaignSiteRecord[];
}

function candidatePlan(divisionIds: readonly string[], ballots: readonly BallotSet[], lineups: readonly LineupContest[]) {
  const groups = new Map<string, BallotSet[]>();
  for (const ballot of ballots) {
    const key = `${ballot.election.state}:${ballot.election.date.slice(0, 4)}`;
    groups.set(key, [...(groups.get(key) ?? []), ballot]);
  }
  const universes = [...groups.values()].map(rows => deriveCandidateUniverse({ stateCode: rows[0].election.state,
    cycle: Number(rows[0].election.date.slice(0, 4)), generatedBy: "published place ballot", generatedOn: rows[0].election.date,
    documents: rows.map(ballot => ({ path: ballot.election.id,
      contests: ballot.contests.filter(row => divisionIds.includes(row.ocdId)), candidacies: ballot.candidacies })),
    stores: { huntState: {}, cards: {}, links: {}, linkHunts: [] } }));
  return campaignSiteSubjects({ universes, lineups });
}

function placeBallot(ballot: BallotSet, divisions: ReadonlySet<string>): BallotSet {
  const contests = ballot.contests.filter(row => divisions.has(row.ocdId));
  const ids = new Set(contests.map(row => row.id));
  const candidacies = ballot.candidacies.filter(row => ids.has(row.contestId));
  const candidateIds = new Set(candidacies.map(row => row.id));
  return { ...ballot, contests, candidacies,
    absences: ballot.absences.filter(row => divisions.has(row.ocdId)),
    ...(ballot.removals ? { removals: ballot.removals.filter(row => ids.has(row.contestId)) } : {}),
    ...(ballot.measureAnalyses ? { measureAnalyses: { ...ballot.measureAnalyses, analyses: ballot.measureAnalyses.analyses.filter(row => ids.has(row.contestId)) } } : {}),
    ...(ballot.filingCandidacies ? { filingCandidacies: ballot.filingCandidacies.filter(row => ids.has(row.contestId)) } : {}),
    ...(ballot.measures ? { measures: ballot.measures.filter(row => ids.has(row.contestId)) } : {}),
    ...(ballot.measureRecords ? { measureRecords: ballot.measureRecords.filter(row => ids.has(row.contestId)) } : {}),
    ...(ballot.contacts ? { contacts: ballot.contacts.filter(row => candidateIds.has(row.candidacyId)) } : {}),
    ...(ballot.heldContests ? { heldContests: ballot.heldContests.filter(row => divisions.has(row.ocdId)) } : {}),
    ...(ballot.generalLineup ? { generalLineup: { ...ballot.generalLineup, contests: ballot.generalLineup.contests.filter(row => ids.has(row.contestId)) } } : {}),
  };
}

export async function readHeldPlaceFamilies(divisionIds: readonly string[], options: PromotedCivicDataReadOptions, registry?: RegistryRuntimeReadModel | null): Promise<HeldPlaceFamilies> {
  const sliced = registry !== undefined, divisions = new Set(divisionIds);
  const targets = [...new Set([...(registry?.bodyRosters.flatMap(roster => roster.members.map(member => member.id)) ?? []),
    ...(registry?.officialCandidacies.rows.flatMap(row => row.status === "RESOLVED" && row.candidacy ? [row.candidacy.candidacyId] : []) ?? [])])];
  const read = <T>(recordClass: Parameters<typeof readPlacePointerSlice>[0], scope: string) => sliced
    ? readPlacePointerSlice<T>(recordClass, scope, divisionIds, [], targets)
    : readPromotedCivicData<T>(recordClass, scope, options);
  const stateRead = async <T>(family: Exclude<StateAuthorityFamily, "registry-runtime" | "campaign-finance">, recordClass: Parameters<typeof readPlacePointerSlice>[0], state: string) =>
    options.store ? readPromotedCivicData<T>(recordClass, stateBallotScope(family === "candidate-publications" ? "candidate-corpus" : family, state), options)
      : (await readStateAuthorityProjection<T>(family, state)).result;
  const states = new Set(statesForRegistryDivisions(divisionIds));
  const stateTargets = OFFICIAL_STATE_LEGISLATOR_TARGETS.filter(target => states.has(target.state));
  const moneyScopes = (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[])
    .filter(state => states.has(state)).map(state => STATE_CAMPAIGN_FINANCE_SOURCES[state].scope);
  const filings = requiredManualProductionContract("official-filings"), navigation = requiredManualProductionContract("ballot-navigation");
  const fec = requiredRoutineContract("fec-funding");
  const [federal, legislators] = await Promise.all([
    read<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE),
    Promise.all(stateTargets.map(target => readOfficialStateLegislatorsProjection(target.jurisdiction, options))),
  ]);
  const rosters = [value(federal)?.roster, ...legislators.map(read => value(read)?.roster)].filter((row): row is OfficeholderSet => row !== undefined);
  targets.push(...rosters.flatMap(roster => roster.divisions.filter(row => divisions.has(row.ocdId)).map(row => row.officeholderId)));
  const [funding, money, filingRead, navigationRead] = await Promise.all([
    read<FundingSnapshot>(fec.recordClass, fec.scope),
    Promise.all(moneyScopes.map(scope => read<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", scope))),
    read<CuratedReaderProjection>(filings.recordClass, filings.scope),
    read<CuratedReaderProjection>(navigation.recordClass, navigation.scope),
  ]);
  const ballots: BallotSet[] = [], candidateLineups: LineupContest[] = [], candidatePublications: CandidateDocument[] = [], derivedCampaignSites: DerivedCampaignSiteRecord[] = [];
  let candidateProfiles: CandidateProfilesProjection | null = null, votingSites: VotingSitesFile | null = null;
  for (const state of states) {
    if (!(REGISTRY_STATES as readonly string[]).includes(state)) continue;
    const held = value(await stateRead<GenericBallotProjection>("ballot-contests", "BALLOT_CANDIDACY", state));
    const ownBallots = Object.values(held?.ballots ?? {}).map(ballot => placeBallot(ballot, divisions));
    ballots.push(...ownBallots);
    const lineups = ownBallots.flatMap(ballot => ballot.generalLineup?.contests ?? []);
    candidateLineups.push(...lineups);
    const plan = candidatePlan(divisionIds, ownBallots, lineups);
    const readerKeys = new Set([...plan.values()].flatMap(row => [row.candidacyId, ...row.readerKeys]));
    const voting = value(await stateRead<VotingSitesFile>("voting-sites", "VOTING_SITE", state));
    if (voting) votingSites = { ...voting, jurisdictions: [...((votingSites as VotingSitesFile | null)?.jurisdictions ?? []), ...voting.jurisdictions.filter(row => divisions.has(row.ocdId))] };
    if (!readerKeys.size) continue;
    const profile = value(await stateRead<CandidateProfilesProjection>("candidate-profiles", "CANDIDATE_PROFILE", state));
    if (profile) candidateProfiles = { ...profile,
      cards: { ...profile.cards, cards: { ...(candidateProfiles as CandidateProfilesProjection | null)?.cards.cards, ...Object.fromEntries(Object.entries(profile.cards.cards).filter(([key]) => readerKeys.has(key))) },
        hunts: [...((candidateProfiles as CandidateProfilesProjection | null)?.cards.hunts ?? []), ...profile.cards.hunts.filter(row => readerKeys.has(row.key))] },
      links: { ...profile.links, links: { ...(candidateProfiles as CandidateProfilesProjection | null)?.links.links, ...Object.fromEntries(Object.entries(profile.links.links).filter(([key]) => readerKeys.has(key))) },
        hunts: [...((candidateProfiles as CandidateProfilesProjection | null)?.links.hunts ?? []), ...profile.links.hunts.filter(row => readerKeys.has(row.key))] } };
    const corpus = value(await stateRead<CandidateCorpus>("candidate-publications", "CANDIDATE_PUBLICATION", state));
    candidatePublications.push(...(corpus?.documents ?? []).filter(row => readerKeys.has(row.candidateKey)));
    const derived = value(await stateRead<DerivedCampaignSitesProjection>("candidate-campaign-sites-derived", "CURATED_READER_RECORD", state));
    derivedCampaignSites.push(...(derived?.records ?? []).filter(row => readerKeys.has(row.id) || readerKeys.has(row.candidacyId)));
  }
  return { rosters, ballots, candidateLineups, candidateProfiles, candidatePublications, derivedCampaignSites,
    votingSites, funding: value(funding), stateMoney: money.flatMap(read => value(read) ?? []),
    filings: (value(filingRead)?.records ?? []).filter(row => officialFilingIssue(row) === null) as unknown as OfficialFiling[],
    electionDates: ELECTION_DATES.filter(row => states.has(row.state)),
    electionFields: (value(navigationRead)?.records ?? []).filter(row => electionFieldIssue(row) === null) as unknown as PublishedElectionField[] };
}

/** No names, state-wide money expansion, or original-job/ZIP filters participate in joins. */
export function projectHeldPlaceFamilies(divisionIds: readonly string[], registry: RegistryRuntimeReadModel | null, families: HeldPlaceFamilies): HeldPlaceCapture {
  const wanted = new Set(divisionIds);
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>();
  const held: HeldPlaceCapture["held"][number][] = [];
  const targets = new Map<string, readonly string[]>();
  const subject = (id: string, kind: HeldPlaceCapture["subjects"][number]["kind"], divisions: readonly string[], label: string, captureKind?: PlaceCaptureKind) => {
    if (!divisions.some(division => wanted.has(division))) return false;
    const previous = subjects.get(id);
    subjects.set(id, { id, kind, divisionIds: [...new Set([...(previous?.divisionIds ?? []), ...divisions])], label,
      ...(captureKind ? { captureKind } : previous?.captureKind ? { captureKind: previous.captureKind } : {}) });
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
      const captureKind = holder.level === "FEDERAL" && holder.id.startsWith("congress:") ? "federal-legislator"
        : holder.level === "STATE" && divisions.some(id => /\/sld[ul]:/.test(id)) ? "state-legislator" : undefined;
      if (!subject(holder.id, "seat", divisions, holder.officeTitle, captureKind)) continue;
      const add = (id: string, item: unknown) => field(holder.id, id, item, holder.provenance.sourceUrl, holder.provenance.collectedAt, FRESHNESS_HOURS.daily);
      add("OFF-04", { name: holder.name, office: holder.officeTitle });
      add("OFF-08", { profile: holder.websiteUrl, source: holder.provenance.sourceUrl });
      if (holder.termStart || holder.termEnd) add("OFF-06", { start: holder.termStart, end: holder.termEnd });
      if (holder.email || holder.phone || holder.contactFormUrl) add("OFF-09", { email: holder.email, phone: holder.phone, contactFormUrl: holder.contactFormUrl });
      if (holder.partyLabel) add("OFF-11", holder.partyLabel);
    }
  }
  for (const row of registry?.statewideExecutives ?? []) {
    const holder = row.holder;
    if (!subject(holder.id, "seat", [row.stateOcdId], holder.officeTitle, "executive")) continue;
    const add = (id: string, item: unknown) => field(holder.id, id, item, row.sourceUrl, row.collectedAt, FRESHNESS_HOURS.registryRecord);
    add("OFF-04", { name: holder.name, office: holder.officeTitle });
    add("OFF-08", { profile: holder.websiteUrl, source: row.sourceUrl });
    if (holder.termEnd) add("OFF-06", { end: holder.termEnd });
    if (holder.email || holder.phone || holder.contactFormUrl) add("OFF-09", { email: holder.email, phone: holder.phone, contactFormUrl: holder.contactFormUrl });
    if (holder.partyLabel && row.partySourceUrl) field(holder.id, "OFF-11", holder.partyLabel, row.partySourceUrl, row.collectedAt, FRESHNESS_HOURS.registryRecord);
  }
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
      if (!subject(contest.id, "contest", divisions, contest.title, contest.type === "MEASURE" ? "measure" : "race")) continue;
      const add = (id: string, item: unknown) => field(contest.id, id, item, contest.provenance.sourceUrl, contest.provenance.collectedAt, FRESHNESS_HOURS.daily);
      add("ELE-01", ballot.election);
      add("ELE-04", { office: contest.title, divisionId: contest.ocdId, termYears: contest.termYears, voteFor: contest.voteFor });
      const candidates = ballot.candidacies.filter(row => row.contestId === contest.id);
      if (contest.candidateListComplete === true) add("ELE-07", { candidates: candidates.map(row => ({ id: row.id, name: `${row.givenName} ${row.familyName}` })) });
      for (const candidate of candidates) {
        subject(candidate.id, "contest", divisions, `${candidate.givenName} ${candidate.familyName}`, "candidate");
        field(candidate.id, "CAN-01", { id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}` }, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, FRESHNESS_HOURS.daily);
        field(candidate.id, "CAN-02", { contestId: contest.id, electionId: contest.electionId, office: contest.title, divisionId: contest.ocdId }, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, FRESHNESS_HOURS.daily);
        if (candidate.incumbent !== null) field(candidate.id, "CAN-03", candidate.incumbent, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, FRESHNESS_HOURS.daily);
        if (candidate.websiteUrl) for (const id of ["CAN-04", "CAN-05"]) field(candidate.id, id,
          { kind: "campaign", url: candidate.websiteUrl, statedBy: "official candidate list" }, candidate.provenance.sourceUrl, candidate.provenance.collectedAt, FRESHNESS_HOURS.daily);
      }
      for (const measure of ballot.measures.filter(row => row.contestId === contest.id)) {
        field(contest.id, "ELE-11", { question: measure.questionText, divisionId: contest.ocdId }, measure.provenance.sourceUrl, measure.provenance.collectedAt, FRESHNESS_HOURS.daily);
      }
    }
  }
  const plan = candidatePlan(divisionIds, families.ballots ?? [], families.candidateLineups ?? []);
  const keySubjects = new Map<string, string[]>();
  for (const row of plan.values()) {
    const ballotIds = row.readerKeys.filter(key => subjects.get(key)?.captureKind === "candidate");
    for (const key of [row.candidacyId, ...row.readerKeys]) keySubjects.set(key,
      [...new Set([...(keySubjects.get(key) ?? []), ...ballotIds])]);
  }
  const profiles = families.candidateProfiles;
  const derived = (families.derivedCampaignSites ?? []).filter(record => {
    const row = plan.get(record.candidacyId);
    return row?.readerKeys.includes(record.id);
  });
  const composed = composeCampaignLinks(profiles?.links?.links ?? {}, derived);
  const date = (text: string | null | undefined) => text?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? "";
  const onCandidate = (key: string, id: string, item: unknown, url: string | null, checkedAt: string) => {
    for (const subjectId of keySubjects.get(key) ?? []) field(subjectId, id, item, url, checkedAt, FRESHNESS_HOURS.weekly);
  };
  for (const [key, card] of Object.entries(profiles?.cards?.cards ?? {})) {
    if (!keySubjects.has(key)) continue;
    if (card.bio?.trim() && card.bioSourceLabel?.trim()) onCandidate(key, "CAN-16",
      { quote: card.bio, attribution: card.bioSourceLabel, readerKey: key }, card.bioSourceUrl, date(card.bioSourceLabel));
    for (const contact of ["phone", "email"] as const) {
      const contactValue = card[contact];
      if (!contactValue?.trim()) continue;
      const campaign = composed.links[key]?.campaign;
      const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9@]/g, "");
      const verified = campaign?.verification && normalized(campaign.verification).includes(normalized(contactValue));
      const note = contact === "phone" ? card.phoneSource : null;
      const noteUrl = note?.match(/https?:\/\/[^\s)]+/)?.[0];
      // A biography page, an office switchboard or a curated date cannot certify a campaign contact.
      if (verified && campaign) onCandidate(key, "CAN-06", { [contact]: contactValue, kind: "campaign", verification: campaign.verification }, campaign.url, campaign.attemptedAt);
      else if (campaign && noteUrl === campaign.url && date(note) && !card.phoneLabel) onCandidate(key, "CAN-06",
        { [contact]: contactValue, kind: "campaign", sourceNote: note }, noteUrl, date(note));
    }
  }
  for (const [key, links] of Object.entries(composed.links)) {
    if (!keySubjects.has(key)) continue;
    for (const kind of ["official", "campaign"] as const) {
      const link = links[kind];
      if (!link?.verification?.trim() || !date(link.attemptedAt)) continue;
      const evidence = kind === "campaign" && composed.derivedKeys.has(key) ? derived.find(row => row.id === key)?.campaign.evidence : undefined;
      const checkedAt = evidence?.readAt ?? link.attemptedAt;
      const fact = { kind, ...link, ...(evidence ? { evidence } : {}) };
      onCandidate(key, "CAN-18", fact, link.url, checkedAt);
      if (kind === "campaign") for (const id of ["CAN-04", "CAN-05"]) onCandidate(key, id, fact, link.url, checkedAt);
    }
  }
  const documents = currentExtraction([...(families.candidatePublications ?? []),
    ...derived.flatMap(record => composed.derivedKeys.has(record.id) ? (record.publications ?? []).map(row => row.document) : [])]);
  const latest = new Map<string, CandidateDocument>();
  for (const document of documents) {
    const key = `${document.candidateKey}|${document.documentUrl}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(document.retrievedAt) > Date.parse(previous.retrievedAt)) latest.set(key, document);
  }
  for (const document of latest.values()) {
    if (document.extraction !== "html" || !document.text?.trim() ||
        !["CAMPAIGN_SITE", "OFFICIAL_SITE"].includes(document.sourceClass)) continue;
    const evidence = derived.flatMap(record => record.publications ?? []).find(row => row.document.id === document.id)?.evidence;
    const fact = { documentId: document.id, contentHash: document.contentHash, sourceClass: document.sourceClass,
      basis: document.basis, extractorVersion: document.extractorVersion ?? 1, ...(evidence ? { evidence } : {}) };
    onCandidate(document.candidateKey, "CAN-12", fact, document.documentUrl, document.retrievedAt);
    if (document.metaDescription?.trim() && candidateDescriptionQualityIssue(document) === null) onCandidate(document.candidateKey, "CAN-16",
      { ...fact, quote: document.metaDescription, attribution: document.documentUrl }, document.documentUrl, document.retrievedAt);
    if (document.sourceRevision) onCandidate(document.candidateKey, "CAN-21",
      { ...fact, sourceRevision: document.sourceRevision, publicationDate: document.publicationDate ?? null }, document.documentUrl, document.retrievedAt);
  }
  for (const jurisdiction of families.votingSites?.jurisdictions ?? []) {
    if (jurisdiction.refusal || !jurisdiction.sites.length || !subject(`voting-sites:${jurisdiction.ocdId}`, "deadline", [jurisdiction.ocdId], jurisdiction.name, "voting-sites")) continue;
    field(`voting-sites:${jurisdiction.ocdId}`, "ELE-09", { model: jurisdiction.model, election: jurisdiction.election, sites: jurisdiction.sites }, jurisdiction.sourceUrl, jurisdiction.collectedAt, FRESHNESS_HOURS.daily);
  }
  for (const calendar of families.electionDates ?? []) {
    const division = `ocd-division/country:us/state:${calendar.state.toLowerCase()}`;
    for (const step of calendar.steps) {
      const id = `election-calendar:${calendar.state}:${calendar.electionDay}:${step.label}`;
      const filing = /filing|certification/i.test(step.label);
      if (!subject(id, "deadline", [division], step.label, filing ? "filing-deadline" : "voting-deadline")) continue;
      // Version-adopted source facts are held on their actual date, never relabeled as a fresh canonical publication.
      field(id, filing ? "ELE-06" : "ELE-08", step, calendar.sourceUrl, calendar.collectedAt, 24, "held");
    }
  }
  for (const row of families.electionFields ?? []) {
    if (electionFieldIssue(row) !== null) continue;
    const captureKind = row.value.fieldKind === "certified_outcome" ? "election-result"
      : row.value.fieldKind.endsWith("_lookup") ? "election-navigation"
      : ["registration_deadline", "early_voting"].includes(row.value.fieldKind) ? "voting-deadline" : undefined;
    if (!subject(row.id, row.value.fieldKind === "certified_outcome" ? "contest" : "deadline", [row.value.divisionId], row.value.quote, captureKind)) continue;
    field(row.id, row.value.fieldKind === "certified_outcome" ? "ELE-15" : row.value.fieldKind.endsWith("_lookup") ? "ELE-09" : "ELE-08", row.value,
      row.value.url, row.value.collectedAt, FRESHNESS_HOURS.weekly);
  }
  const moneyDivisions = (keys: readonly string[]) => [...new Set(keys.flatMap(key => targets.get(key) ?? []))];
  for (const record of families.funding?.candidates ?? []) {
    const divisions = moneyDivisions(record.targetKeys);
    const id = `fec:${record.fecCandidateId}:${record.principalCommitteeId ?? "unrecorded"}:${record.cycle}`;
    if (!subject(id, "funding", divisions, record.name, "federal-campaign-finance")) continue;
    const add = (key: string, item: unknown) => field(id, key, item, record.provenance.sourceUrl, record.provenance.collectedAt, FRESHNESS_HOURS.daily);
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
    if (!subject(id, "funding", divisions, record.registeredName || record.candidateNameAsFiled, "state-campaign-finance")) continue;
    const add = (key: string, item: unknown) => field(id, key, item, record.provenance.sourceUrl, record.checkedAt, FRESHNESS_HOURS.daily);
    add("CAM-01", { agency: record.agency, filingsUrl: record.filingsUrl });
    if (record.committeeId && record.match.allThreeAgree) add("CAM-02", { committeeId: record.committeeId, name: record.registeredName, targetKeys: record.targetKeys });
    if (record.filingState !== "FILED") continue;
    if (record.totals.coveringPeriod) add("CAM-03", record.totals.coveringPeriod);
    if (record.totals.receipts !== null) add("CAM-05", { amount: record.totals.receipts, period: record.totals.coveringPeriod });
    if (record.totals.expenditures !== null) add("CAM-06", { amount: record.totals.expenditures, period: record.totals.coveringPeriod });
    if (record.totals.cashOnHand !== null) add("CAM-07", { cashOnHand: record.totals.cashOnHand, period: record.totals.coveringPeriod });
  }
  for (const filing of families.filings ?? []) {
    if (officialFilingIssue(filing) !== null || !subject(filing.id, filing.kind !== "CANDIDATE_FILING_DOCUMENT" ? "funding" : "contest", [filing.ocdId], filing.bodyName,
      filing.kind !== "CANDIDATE_FILING_DOCUMENT" ? "campaign-finance" : "candidate")) continue;
    const add = (id: string, item: unknown) => field(filing.id, id, item, filing.documentUrl, filing.collectedAt, FRESHNESS_HOURS.daily);
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
