import { campaignFinanceRecordIssue } from "../funding/campaign-finance-reader.ts";
import { createHash } from "node:crypto";
import { officialFilingIssue } from "./official-filings.ts";
import { electionFieldIssue } from "./election-fields.ts";
import { translationProjectionProblems, type TranslationProjection } from "../translate/projection-contract.ts";
import { jurisdictionFromOcdId, US_JURISDICTIONS } from "../coverage/states.ts";
import { manualPayloadScope } from "./scoped-manual-contracts.ts";
import { specialDistrictBoundaryIssue } from "../registry/special-district-boundary.ts";
import { publicRecordIssue } from "./public-record-contract.ts";
import { governmentBudgetIssue } from "./government-budget-contract.ts";

import { genericBallotProblems, type GenericBallotProjection } from "../ballot/generic-projection.ts";
import { readerCandidateProfiles } from "../ballot/candidate-reader-privacy.ts";
import type { CandidateCardData } from "../ballot/candidate-cards.ts";
import type { CandidateLinks, RecordedHunt } from "../ballot/candidate-sites.ts";
import type { CandidateCorpus } from "../candidates/corpus.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import {
  everydayRoutingProjectionFromRecords,
  everydayRoutingProjectionProblems,
  type EverydayRoutingProjection,
  type EverydayRoutingRecord,
} from "../routing/everyday.ts";
import { canonicalCivicDataJson, civicRecordsFor } from "./changes.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import {
  directPositiveSourceUrls,
  reconcileSourceScopedMembers,
  type SourceScopedHeldFact,
  type SourceScopedMember,
} from "./manual-source-isolation.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "./read-model.ts";
import {
  crosswalkListIssues,
  crosswalkReceiptIssue,
  crosswalkRowIssue,
  type MeetingBodyCrosswalkRow,
} from "./meeting-body-crosswalk.ts";
import { manualSourceReceiptStructureIssue, sourceAuthority } from "./source-authority.ts";
import { manualSourceUrls } from "./manual-source-urls.ts";
import type {
  CivicRecordMember,
  IdentityEvidence,
  ManualSourceSetReceipt,
  RoutineCandidate,
} from "./types.ts";
import { sourceProjectionEvidence } from "./types.ts";
import { stanceRowIssue } from "./stance-rows.ts";

export const MANUAL_PROJECTION_CONTRACT_IDS = [
  "plain-english-translations",
  "public-records",
  "special-district-boundaries",
  "government-budgets",
  "campaign-finance",
  "ballot-contests",
  "candidate-profiles",
  "candidate-corpus",
  "officeholder-statements",
  "official-filings",
  "ballot-navigation",
  "stances",
  "campaign-sites",
  "member-offices",
  "venue-resolutions",
  "everyday-routing",
  "meeting-body-crosswalk",
] as const;
export type ManualProjectionContractId = (typeof MANUAL_PROJECTION_CONTRACT_IDS)[number];

export interface CandidateProfilesProjection {
  readonly cards: {
    readonly curatedAt: string;
    readonly note: string;
    readonly cards: Readonly<Record<string, CandidateCardData>>;
    readonly hunts: readonly { readonly key: string; readonly name: string; readonly note: string; readonly attemptedAt: string }[];
  };
  readonly links: {
    readonly curatedAt: string;
    readonly note: string;
    readonly links: Readonly<Record<string, CandidateLinks>>;
    readonly hunts: readonly RecordedHunt[];
  };
}

export interface CuratedReaderProjection {
  readonly kind: "official-filings" | "ballot-navigation" | "stances" | "campaign-sites" | "member-offices" | "venue-resolutions" | "everyday-routing" | "meeting-body-crosswalk" | "special-district-boundaries" | "public-records" | "government-budgets" | "campaign-finance";
  /** Stable exact members. Each family has its own contract, pointer, and LKG. */
  readonly records: readonly (Readonly<Record<string, unknown>> & { readonly id: string })[];
  readonly formatVersion?: number;
  readonly denominator?: Readonly<Record<string, number>>;
}

export type ManualProjectionPayload =
  | TranslationProjection
  | GenericBallotProjection
  | CandidateProfilesProjection
  | CandidateCorpus
  | StatementCorpus
  | CuratedReaderProjection;

export interface ManualProjectionPackage {
  readonly contractId: ManualProjectionContractId;
  readonly version: string;
  readonly sourceThrough: string;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly payload: ManualProjectionPayload;
}

export interface ManualProjectionPrior {
  readonly versionId: string;
  readonly payload: ManualProjectionPayload;
  readonly sourceReceipt: ManualSourceSetReceipt;
}

export function completeOfficialBallotContests(payload: GenericBallotProjection, receipt: ManualSourceSetReceipt) {
  return Object.values(payload.ballots).flatMap(ballot => ballot.contests.filter(contest =>
    contest.candidateListComplete === true && receipt.sources.some(source =>
      ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass) && source.reviewOutcome !== "BLOCKED" &&
      source.httpStatus === 200 && /^[a-f0-9]{64}$/.test(source.rawHash) &&
      [source.requestedUrl, source.finalUrl].includes(contest.provenance.sourceUrl ?? "") &&
      source.retrievedAt === contest.provenance.collectedAt))
    .map(contest => ({ ballot, contest })));
}

export interface ManualProjectionCandidateOptions {
  readonly prior?: ManualProjectionPrior | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown, key: string): readonly Record<string, unknown>[] {
  const held = object(value)?.[key];
  return Array.isArray(held)
    ? held.map(object).filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jurisdictionForCandidateKey(key: string): string {
  const slug = /^(?:ballot-)?([a-z]{2})-/.exec(key)?.[1];
  const state = US_JURISDICTIONS.find((row) => row.slug === slug);
  return state ? `US-${state.usps}` : "UNRESOLVED";
}

function receiptCoverageProblems(payload: unknown, receipt: ManualSourceSetReceipt): string[] {
  const receipted = new Set(receipt.sources.flatMap(manualSourceUrls));
  const held = object(payload);
  const citations = held?.kind === "ballot-navigation"
    ? new Set(rows(held, "records").flatMap(row => manualRecordSourceUrls(row)))
    : held?.kind === "ballot-contests" ? ballotProvenanceUrls(payload) : directPositiveSourceUrls(payload);
  const missing = [...citations].filter((url) => !receipted.has(url)).sort();
  return missing.map((url) => `The projection cites ${url} without exact-byte evidence in the reviewed source set.`);
}

function ballotProvenanceUrls(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.flatMap(row => [...ballotProvenanceUrls(row)]));
  const row = object(value);
  if (!row) return new Set();
  const citations = [string(row.sourceUrl), string(row.candidacySourceUrl), string(row.citesUrl), string(row.analysisUrl),
    ...rows(row, "sources").map(source => string(source.url)), string(object(row.canvass)?.url), string(object(row.retrieval)?.url),
    ...(Array.isArray(row.sourceUrls) ? row.sourceUrls.filter((url): url is string => typeof url === "string") : [])];
  return new Set([...citations.filter(Boolean), ...Object.values(row).flatMap(item => [...ballotProvenanceUrls(item)])]);
}

/** An official page's linked lookup is a fact on that page, not another acquired source. */
function manualRecordSourceUrls(record: unknown): readonly string[] {
  const row = object(record);
  if (row?.kind === "ELECTION_FIELD") return [string(object(row.value)?.url)].filter(Boolean);
  return [...directPositiveSourceUrls(record)];
}

function duplicateProblems(values: readonly string[], noun: string): string[] {
  const seen = new Set<string>();
  const duplicates = values.filter((value) => !value || seen.has(value) || !seen.add(value));
  return duplicates.length ? [`${noun} identifiers are empty or duplicated.`] : [];
}

interface BuiltProjection {
  readonly payload: ManualProjectionPayload;
  readonly records: readonly CivicRecordMember[];
  readonly identities: readonly IdentityEvidence[];
  readonly missingRequiredFields: readonly string[];
  readonly violations: readonly string[];
  readonly schemaVersion: string;
  readonly consumerChecks: readonly { readonly consumer: string; readonly passed: boolean; readonly detail: string }[];
  readonly factKind: string;
}

const SOURCE_ISOLATED_MANUAL_CONTRACTS = new Set<ManualProjectionContractId>([
  "candidate-profiles",
  "candidate-corpus",
  "officeholder-statements",
  "official-filings",
  "ballot-navigation",
  "stances",
  "campaign-sites",
  "member-offices",
  "venue-resolutions",
  "everyday-routing",
  "meeting-body-crosswalk",
  "public-records",
  "special-district-boundaries",
  "government-budgets",
  "campaign-finance",
]);

interface IsolatedManualProjection {
  readonly payload: ManualProjectionPayload;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly excludedFacts: readonly SourceScopedHeldFact[];
  readonly supportedCurrentSources: number;
  readonly rejectedCurrentMembers: number;
  readonly acceptedCurrentMembers: number;
}

function curatedRecordIssue(
  contractId: "official-filings" | "ballot-navigation" | "stances" | "campaign-sites" | "member-offices" | "venue-resolutions" | "everyday-routing" | "meeting-body-crosswalk" | "special-district-boundaries" | "public-records" | "government-budgets" | "campaign-finance",
  row: Record<string, unknown>,
): string | null {
  if (!string(row.id)) return `A ${contractId} row has no stable id.`;
  if (contractId === "special-district-boundaries") return specialDistrictBoundaryIssue(row);
  if (contractId === "public-records") return publicRecordIssue(row);
  if (contractId === "government-budgets") return governmentBudgetIssue(row);
  if (contractId === "campaign-finance") return campaignFinanceRecordIssue(row);
  if (contractId === "official-filings") return officialFilingIssue(row);
  if (contractId === "meeting-body-crosswalk") return crosswalkRowIssue(row);
  if (contractId === "everyday-routing") {
    const contact = object(row.contact);
    const kind = string(row.kind);
    if (kind === "CONTACT") {
      const zips = Array.isArray(contact?.zips) ? contact.zips : [];
      return !string(row.topicId) || !/^\d{5}$/.test(string(row.zip)) ||
          string(contact?.topicId) !== string(row.topicId) ||
          zips.length !== 1 || zips[0] !== row.zip ||
          string(contact?.verification) !== "PAGE_FETCHED" ||
          !/^https:\/\//.test(string(contact?.sourceUrl)) ||
          !Number.isFinite(Date.parse(string(contact?.collectedAt))) ||
          !(string(contact?.phone) || string(contact?.email) || string(contact?.requestUrl))
        ? `${string(row.id)} lacks its exact topic/ZIP, verified official source, or usable contact channel.`
        : null;
    }
    return kind !== "CONTACT_OWED" || string(row.disposition) !== "UNKNOWN" ||
        string(row.holdingStatus) !== "CONTACT_OWED" || !string(row.reason).trim() ||
        !/^https:\/\//.test(string(row.evidenceSourceUrl)) ||
        !Number.isFinite(Date.parse(string(row.reviewedAt)))
      ? `${string(row.id)} is not an explicit UNKNOWN/CONTACT_OWED source-hunt obligation.`
      : null;
  }
  if (contractId === "stances") return stanceRowIssue(row);
  if (contractId === "ballot-navigation") {
    if (row.kind === "ELECTION_FIELD") return electionFieldIssue(row);
    const value = object(row.value);
    return !["POLLING_PLACE_LINK", "REGISTRATION_LINK"].includes(string(row.kind)) ||
        !/^[A-Z]{2}$/.test(string(value?.state)) ||
        !/^https:\/\//.test(string(value?.url)) ||
        !Number.isFinite(Date.parse(string(value?.verifiedAt)))
      ? `${string(row.id)} lacks its exact kind, state, HTTPS route, or verification date.`
      : null;
  }
  if (contractId === "campaign-sites") {
    const site = object(row.site);
    return !/^https:\/\//.test(string(site?.url)) ||
        !string(site?.verification) ||
        !Number.isFinite(Date.parse(string(site?.attemptedAt)))
      ? `${string(row.id)} lacks an eligible exact identity, verified HTTPS site, or attempt date.`
      : null;
  }
  if (contractId === "member-offices") {
    const office = object(row.office);
    return row.kind !== "MEMBER_OFFICE" ||
        !string(row.officeholderId) ||
        !["CAPITOL", "DISTRICT"].includes(string(row.officeKind)) ||
        !/^https:\/\//.test(string(row.sourceUrl)) || !string(row.sourceOrg) ||
        !Number.isFinite(Date.parse(string(row.collectedAt))) ||
        typeof row.official !== "boolean" ||
        !(string(office?.address).trim() || string(office?.phone).trim() || string(office?.email).trim())
      ? `${string(row.id)} lacks its eligible member, office kind, HTTPS source, collection time, official flag, or an address, phone or email.`
      : null;
  }
  const bodyOcdId = row.bodyOcdId;
  return !string(row.sourceId) ||
      !string(row.match) ||
      !string(row.name) ||
      !(typeof bodyOcdId === "string" || bodyOcdId === null) ||
      (bodyOcdId === null && !string(row.tenant)) ||
      !Number.isFinite(row.lat) ||
      !Number.isFinite(row.lng) ||
      // No person reviews an automatic pin, so it must sit in the same United States box the matcher uses.
      Number(row.lat) < 18 || Number(row.lat) > 72 ||
      Number(row.lng) < -180 || Number(row.lng) > -65 ||
      !/^https:\/\//.test(string(row.addressSourceUrl)) ||
      !/^https:\/\//.test(string(row.coordinateSourceUrl)) ||
      !Number.isFinite(Date.parse(string(row.verifiedAt)))
    ? `${string(row.id)} lacks its exact source/body/raw-location key, cited address/coordinates, or review time.`
    : null;
}

function profileMembers(payload: ManualProjectionPayload): readonly SourceScopedMember[] {
  const held = object(payload);
  const cards = object(object(held?.cards)?.cards) ?? {};
  const links = object(object(held?.links)?.links) ?? {};
  return [
    ...Object.entries(cards).map(([key, record]) => ({ key: `profile:${key}:card`, record })),
    ...Object.entries(links).map(([key, record]) => ({ key: `profile:${key}:links`, record })),
  ];
}

function corpusMembers(payload: ManualProjectionPayload): readonly SourceScopedMember[] {
  return rows(payload, "documents").map((record) => ({ key: `document:${string(record.id)}`, record }));
}

function statementMembers(payload: ManualProjectionPayload): readonly SourceScopedMember[] {
  return rows(payload, "snapshots").map((record) => ({ key: `statement:${string(record.id)}`, record }));
}

function curatedMembers(payload: ManualProjectionPayload): readonly SourceScopedMember<Record<string, unknown>>[] {
  return rows(payload, "records").map((record) => ({ key: string(record.id), record }));
}

function sourceScopedMembers(
  contractId: ManualProjectionContractId,
  payload: ManualProjectionPayload,
): readonly SourceScopedMember[] {
  if (contractId === "candidate-profiles") return profileMembers(payload);
  if (contractId === "candidate-corpus") return corpusMembers(payload);
  if (contractId === "officeholder-statements") return statementMembers(payload);
  if (contractId === "official-filings" || contractId === "ballot-navigation" ||
      contractId === "stances" || contractId === "campaign-sites" || contractId === "member-offices" || contractId === "venue-resolutions" ||
      contractId === "everyday-routing" || contractId === "meeting-body-crosswalk" || contractId === "special-district-boundaries" || contractId === "public-records" || contractId === "government-budgets" || contractId === "campaign-finance") {
    return curatedMembers(payload);
  }
  return [];
}

function sourceScopedMemberIssue(
  contractId: ManualProjectionContractId,
  member: SourceScopedMember,
  receipt: ManualSourceSetReceipt,
): string | null {
  if (contractId === "candidate-profiles") {
    const candidateKey = member.key.replace(/^profile:/, "").replace(/:(?:card|links)$/, "");
    if (jurisdictionForCandidateKey(candidateKey) === "UNRESOLVED") {
      return `${member.key} has no supported exact jurisdiction prefix.`;
    }
    return object(member.record) === null ? `${member.key} is not a profile object.` : null;
  }
  if (contractId === "candidate-corpus") {
    const row = object(member.record);
    if (!row) return `${member.key} is not a candidate publication object.`;
    const id = string(row.id);
    const candidateKey = string(row.candidateKey);
    const documentUrl = string(row.documentUrl);
    const contentHash = string(row.contentHash);
    const retrievedAt = string(row.retrievedAt);
    const extraction = string(row.extraction);
    const extractionShapeValid = extraction === "html"
      ? Boolean(string(row.text).trim())
      : extraction === "failed" && row.text === null && Boolean(string(row.extractionNote).trim());
    const normalizedTextHashValid = extraction !== "html" || sha256(string(row.text)) === contentHash;
    if (!id || !candidateKey || id !== `${candidateKey}@${contentHash}` ||
        !["CAMPAIGN_SITE", "OFFICIAL_SITE"].includes(string(row.sourceClass)) ||
        !["HUNTED_AND_VERIFIED", "STATED_IN_FILING"].includes(string(row.basis)) ||
        !/^https:\/\//.test(documentUrl) || !SHA256_PATTERN.test(contentHash) ||
        !Number.isFinite(Date.parse(retrievedAt)) || !string(row.contentType) || !extractionShapeValid ||
        !normalizedTextHashValid) {
      return `${member.key} lacks its exact content-addressed id, candidate/source class, HTTPS document, normalized-text hash, retrieval time, content type, or truthful extraction outcome.`;
    }
    if (jurisdictionForCandidateKey(candidateKey) === "UNRESOLVED") {
      return `${member.key} has no supported exact candidate jurisdiction.`;
    }
    if (!receipt.sources.some((source) =>
      (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED" &&
      source.finalUrl === documentUrl &&
      source.rawHash === contentHash &&
      source.retrievedAt === retrievedAt
    )) {
      return `${member.key} is not bound to supported exact bytes and retrieval time for ${documentUrl}.`;
    }
    return null;
  }
  if (contractId === "officeholder-statements") {
    const row = object(member.record);
    if (!row) return `${member.key} is not a statement snapshot object.`;
    const id = string(row.id);
    const subjectId = string(row.subjectId);
    const url = string(row.url);
    const contentHash = string(row.contentHash);
    const retrievedAt = string(row.retrievedAt);
    const extraction = string(row.extraction);
    if (!id || !/^https:\/\//.test(url) ||
        !SHA256_PATTERN.test(contentHash) || !Number.isFinite(Date.parse(retrievedAt)) || !Number.isInteger(row.httpStatus) ||
        !["CAMPAIGN_SITE", "OFFICIAL_PAGE"].includes(string(row.kind)) ||
        !(extraction === "failed" || (extraction === "ok" && string(row.text).trim())) ||
        id !== `${subjectId}|${url}|${contentHash}`) {
      return `${member.key} lacks a valid identity, exact primary-publication version, or extraction outcome.`;
    }
    if (!receipt.sources.some((source) =>
      (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED" &&
      source.finalUrl === url &&
      source.rawHash === contentHash &&
      source.retrievedAt === retrievedAt &&
      source.httpStatus === row.httpStatus
    )) {
      return `${member.key} is not bound to supported exact bytes and retrieval time for ${url}.`;
    }
    return null;
  }
  if (contractId === "official-filings" || contractId === "ballot-navigation" ||
      contractId === "stances" || contractId === "campaign-sites" || contractId === "member-offices" || contractId === "venue-resolutions" ||
      contractId === "everyday-routing" || contractId === "meeting-body-crosswalk" || contractId === "special-district-boundaries" || contractId === "public-records" || contractId === "government-budgets" || contractId === "campaign-finance") {
    const row = object(member.record);
    if (!row) return `${member.key} is not a curated Reader record.`;
    const issue = curatedRecordIssue(contractId, row);
    // A crosswalk row cites exactly the receipted bytes of the pages it rests on.
    return issue ?? (contractId === "meeting-body-crosswalk" ? crosswalkReceiptIssue(row as unknown as MeetingBodyCrosswalkRow, receipt.sources) : null);
  }
  return null;
}

function uniqueRows(current: unknown, prior: unknown): readonly unknown[] {
  const byValue = new Map<string, unknown>();
  for (const row of [...(Array.isArray(prior) ? prior : []), ...(Array.isArray(current) ? current : [])]) {
    byValue.set(canonicalCivicDataJson(row), row);
  }
  return [...byValue.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => row);
}

function rebuildSourceScopedPayload(
  contractId: ManualProjectionContractId,
  currentPayload: ManualProjectionPayload,
  priorPayload: ManualProjectionPayload | null,
  members: readonly SourceScopedMember[],
): ManualProjectionPayload {
  const current = object(currentPayload) ?? {};
  const prior = object(priorPayload) ?? {};
  if (contractId === "candidate-profiles") {
    const currentCards = object(current.cards) ?? {};
    const currentLinks = object(current.links) ?? {};
    const priorCards = object(prior.cards) ?? {};
    const priorLinks = object(prior.links) ?? {};
    const cards: Record<string, unknown> = {};
    const links: Record<string, unknown> = {};
    for (const member of members) {
      const card = /^profile:(.+):card$/.exec(member.key);
      const link = /^profile:(.+):links$/.exec(member.key);
      if (card) cards[card[1]!] = member.record;
      if (link) links[link[1]!] = member.record;
    }
    return {
      cards: {
        curatedAt: string(currentCards.curatedAt) || string(priorCards.curatedAt),
        note: string(currentCards.note) || string(priorCards.note),
        cards,
        hunts: uniqueRows(currentCards.hunts, priorCards.hunts),
      },
      links: {
        curatedAt: string(currentLinks.curatedAt) || string(priorLinks.curatedAt),
        note: string(currentLinks.note) || string(priorLinks.note),
        links,
        hunts: uniqueRows(currentLinks.hunts, priorLinks.hunts),
      },
    } as CandidateProfilesProjection;
  }
  if (contractId === "candidate-corpus") {
    return {
      formatVersion: 1,
      fetchedAt: string(current.fetchedAt) || string(prior.fetchedAt),
      attempted: Number.isInteger(current.attempted) ? Number(current.attempted) : Number(prior.attempted) || 0,
      documents: members.map((member) => member.record),
      failures: uniqueRows(current.failures, prior.failures),
    } as CandidateCorpus;
  }
  if (contractId === "officeholder-statements") {
    return { snapshots: members.map((member) => member.record) } as StatementCorpus;
  }
  if (contractId === "everyday-routing") {
    return everydayRoutingProjectionFromRecords(
      members.map((member) => member.record as EverydayRoutingRecord),
    );
  }
  return {
    kind: string(current.kind) || contractId,
    records: members.map((member) => member.record),
  } as CuratedReaderProjection;
}

function sourceScopedProjection(
  input: ManualProjectionPackage,
  prior: ManualProjectionPrior | null,
): IsolatedManualProjection {
  const currentMembers = sourceScopedMembers(input.contractId, input.payload);
  const reconciled = reconcileSourceScopedMembers({
    sourceUrls: member => manualRecordSourceUrls(member.record),
    current: currentMembers,
    currentReceipt: input.sourceReceipt,
    prior: prior ? {
      members: sourceScopedMembers(input.contractId, prior.payload),
      sourceReceipt: prior.sourceReceipt,
    } : null,
    memberIssue: (member) => sourceScopedMemberIssue(input.contractId, member, input.sourceReceipt),
  });
  let selectedMembers = reconciled.members;
  let excludedFacts = reconciled.excludedFacts;
  if (input.contractId === "everyday-routing" && prior) {
    const currentByKey = new Map(currentMembers.map((member) => [member.key, member]));
    const provenContactCells = new Set(
      reconciled.members.flatMap((member) => {
        const current = currentByKey.get(member.key);
        const row = current?.record === member.record ? object(member.record) : null;
        return row?.kind === "CONTACT" ? [`${string(row.topicId)}|${string(row.zip)}`] : [];
      }),
    );
    const resolvedOwed = reconciled.members.filter((member) => {
      if (currentByKey.has(member.key)) return false;
      const row = object(member.record);
      return row?.kind === "CONTACT_OWED" &&
        provenContactCells.has(`${string(row.topicId)}|${string(row.zip)}`);
    });
    if (resolvedOwed.length > 0) {
      const resolvedKeys = new Set(resolvedOwed.map((member) => member.key));
      selectedMembers = reconciled.members.filter((member) => !resolvedKeys.has(member.key));
      excludedFacts = [
        ...reconciled.excludedFacts.filter((fact) => !resolvedKeys.has(fact.key)),
        ...resolvedOwed.map((member) => ({
          key: member.key,
          code: "CONTACT_OWED_RESOLVED_BY_SUPPORTED_CONTACT",
          detail: `${member.key} was replaced only because a current source-scoped verified contact now covers the same exact topic/ZIP cell.`,
          record: member.record,
        })),
      ];
    }
  }
  return {
    payload: rebuildSourceScopedPayload(input.contractId, input.payload, prior?.payload ?? null, selectedMembers),
    sourceReceipt: reconciled.promotionReceipt,
    excludedFacts: [
      ...input.sourceReceipt.sources
        .filter((source) => source.reviewOutcome === "BLOCKED")
        .map((source) => ({
          key: `source:${source.requestedUrl}`,
          code: "MANUAL_SOURCE_BLOCKED",
          detail: `${source.requestedUrl} was blocked and could not authorize any current member: ${source.failureDetail}.`,
          record: source,
        })),
      ...excludedFacts,
    ],
    supportedCurrentSources: reconciled.supportedCurrentSources,
    rejectedCurrentMembers: reconciled.rejectedCurrentMembers,
    acceptedCurrentMembers: reconciled.acceptedCurrentMembers,
  };
}

export async function readManualProjectionPrior(
  contractId: ManualProjectionContractId,
  store: CivicDataReadStore,
  now: string,
  scope?: string,
): Promise<ManualProjectionPrior | null> {
  const contract = requiredManualProductionContract(contractId);
  const read = await readPromotedCivicData<ManualProjectionPayload>(contract.recordClass, scope ?? contract.scope, {
    store,
    now,
    bypassCache: true,
  });
  if (read.kind === "NOT_RECORDED") return null;
  if (read.kind !== "PROMOTED") {
    const code = read.kind === "STORE_UNREACHABLE" ? read.code : "BOOTSTRAP_NOT_PERMITTED";
    throw new Error(`MANUAL_PROMOTION_BASE_UNAVAILABLE:${contractId}:${code}:${read.detail}`);
  }
  const candidate = await store.readCandidate(read.projection.versionId);
  const sourceReceipt = candidate?.candidate.retrieval.manualSourceReceipt;
  if (candidate && !sourceReceipt) return null;
  const issue = manualSourceReceiptStructureIssue(sourceReceipt);
  if (!candidate || !sourceReceipt || issue || sourceReceipt.sources.some((source) => source.reviewOutcome === "BLOCKED")) {
    throw new Error(`MANUAL_PROMOTION_BASE_PROOF_INVALID:${contractId}:${issue?.code ?? "SOURCE_RECEIPT_NOT_GOOD"}`);
  }
  return {
    versionId: read.projection.versionId,
    payload: read.value,
    sourceReceipt,
  };
}

function plainEnglishProjection(payload: ManualProjectionPayload): BuiltProjection {
  const value = payload as TranslationProjection;
  const problems = translationProjectionProblems(value);
  const records = Array.isArray(value?.records) ? value.records : [];
  return { payload, records: records.map(record => ({ key: record.id, record })),
    identities: records.map(record => ({ subjectId: record.subjectId, jurisdiction: `US-${jurisdictionFromOcdId(record.ocdId)?.usps ?? "UNRESOLVED"}`,
      identifiers: { record_id: record.id }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    missingRequiredFields: records.length ? [] : ["records"], violations: problems,
    schemaVersion: "plain-english-translations:1", factKind: "independently checked official-text translations",
    consumerChecks: [{ consumer: "ballot and Ask measure translation reader", passed: records.length > 0 && problems.length === 0,
      detail: `${records.length} source-bound translation(s) with independent sentence checks.` }] };
}

function genericBallotProjection(payload: ManualProjectionPayload): BuiltProjection {
  const value = payload as GenericBallotProjection;
  const ballots = Object.values(value?.ballots ?? {});
  const records = civicRecordsFor("BALLOT_CANDIDACY", value);
  return { payload, records, identities: ballots.flatMap(ballot => [
    ...ballot.contests.map(row => ({ subjectId: row.id, jurisdiction: `US-${ballot.election.state}`,
      identifiers: { contest_id: row.id }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    ...ballot.candidacies.map(row => ({ subjectId: row.id, jurisdiction: `US-${ballot.election.state}`,
      identifiers: { candidacy_id: row.id, contest_id: row.contestId }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    ...ballot.measures.map(row => ({ subjectId: row.id, jurisdiction: `US-${ballot.election.state}`,
      identifiers: { measure_id: row.id, contest_id: row.contestId }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    ...(ballot.measureRecords ?? []).map(row => ({ subjectId: row.contestId, jurisdiction: `US-${ballot.election.state}`,
      identifiers: { contest_id: row.contestId }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
  ]), missingRequiredFields: records.length ? [] : ["ballots.contests/candidacies"],
    violations: genericBallotProblems(value), schemaVersion: "ballot-contests:1",
    consumerChecks: [{ consumer: "generic state/election ballot Reader", passed: records.length > 0 && genericBallotProblems(value).length === 0,
      detail: `${ballots.length} state/election ballot(s) with independently verified contests and candidates.` }],
    factKind: "sourced official ballot contests and candidates" };
}

function profileProjection(payload: ManualProjectionPayload): BuiltProjection {
  payload = readerCandidateProfiles(payload as CandidateProfilesProjection);
  const held = object(payload);
  const cards = object(object(held?.cards)?.cards) ?? {};
  const links = object(object(held?.links)?.links) ?? {};
  const keys = [...new Set([...Object.keys(cards), ...Object.keys(links)])].sort();
  const records = keys.map((key) => ({ key: `profile:${key}`, record: { card: cards[key] ?? null, links: links[key] ?? null } }));
  const identities = keys.map((key) => ({
    subjectId: key,
    jurisdiction: jurisdictionForCandidateKey(key),
    identifiers: { candidate_key: key },
    matchBasis: "EXACT_SCOPED_ID" as const,
    ambiguous: false,
  }));
  return {
    payload,
    records,
    identities,
    missingRequiredFields: keys.length > 0 ? [] : ["cards.cards/links.links"],
    violations: identities.some((identity) => identity.jurisdiction === "UNRESOLVED")
      ? ["A candidate profile key has no supported exact jurisdiction prefix."]
      : [],
    schemaVersion: "candidate-profiles:1",
    consumerChecks: [
      { consumer: "/ballot candidate cards", passed: keys.length > 0, detail: `${Object.keys(cards).length} candidate card records; independently held link-only members do not invalidate them.` },
      { consumer: "Ask candidate profile evidence", passed: keys.length > 0, detail: `${Object.keys(links).length} verified candidate link records; independently held card-only members do not invalidate them.` },
    ],
    factKind: "owner-reviewed candidate biography, contact, and verified-link projection",
  };
}

function corpusProjection(payload: ManualProjectionPayload, receipt: ManualSourceSetReceipt): BuiltProjection {
  const held = object(payload);
  const documents = rows(held, "documents");
  const documentIds = documents.map((row) => string(row.id));
  const records = documents.map((record) => ({ key: `document:${string(record.id)}`, record }));
  const identities = documents.map((row) => ({
    subjectId: string(row.candidateKey),
    jurisdiction: jurisdictionForCandidateKey(string(row.candidateKey)),
    identifiers: { document_id: string(row.id), candidate_key: string(row.candidateKey) },
    matchBasis: "EXACT_SCOPED_ID" as const,
    ambiguous: false,
  }));
  const complete = documents.every((row) => receipt.sources.some((source) =>
    source.finalUrl === string(row.documentUrl) &&
    source.rawHash === string(row.contentHash) &&
    source.retrievedAt === string(row.retrievedAt)
  ));
  return {
    payload,
    records,
    identities,
    missingRequiredFields: documents.length > 0 && complete && documents.every((row) => row.id && row.candidateKey && row.documentUrl && row.contentHash && row.retrievedAt)
      ? []
      : ["documents.id/candidateKey/documentUrl/contentHash/retrievedAt"],
    violations: [
      ...duplicateProblems(documentIds, "Candidate document"),
      ...(identities.some((identity) => identity.jurisdiction === "UNRESOLVED") ? ["A candidate publication has no supported exact jurisdiction prefix."] : []),
    ],
    schemaVersion: `candidate-corpus:${string(held?.formatVersion) || "1"}`,
    consumerChecks: [
      { consumer: "/api/positions and Ask corpus search", passed: documents.length > 0, detail: `${documents.length} exact candidate publication versions.` },
      { consumer: "/ballot positions", passed: documents.every((row) => typeof row.extraction === "string"), detail: "Every document states its extraction outcome." },
    ],
    factKind: "owner-reviewed candidate-controlled and official publication versions",
  };
}

function officeholderStatementProjection(
  payload: ManualProjectionPayload,
  receipt: ManualSourceSetReceipt,
): BuiltProjection {
  const held = object(payload);
  const snapshots = rows(held, "snapshots");
  const ids = snapshots.map((row) => string(row.id));
  const identities = snapshots.map((row) => ({
    subjectId: string(row.subjectId),
    jurisdiction: "US",
    identifiers: {
      officeholder_id: string(row.subjectId),
      snapshot_id: string(row.id),
    },
    matchBasis: "EXACT_SCOPED_ID" as const,
    ambiguous: false,
  }));
  const complete = snapshots.every((row) => {
    const id = string(row.id);
    const subjectId = string(row.subjectId);
    const url = string(row.url);
    const contentHash = string(row.contentHash);
    const retrievedAt = string(row.retrievedAt);
    const extraction = string(row.extraction);
    return Boolean(
      id && subjectId && /^https:\/\//.test(url) && SHA256_PATTERN.test(contentHash) &&
      Number.isFinite(Date.parse(retrievedAt)) && Number.isInteger(row.httpStatus) &&
      (row.kind === "CAMPAIGN_SITE" || row.kind === "OFFICIAL_PAGE") &&
      (extraction === "failed" || (extraction === "ok" && string(row.text).trim())) &&
      id === `${subjectId}|${url}|${contentHash}` &&
      receipt.sources.some((source) =>
        source.finalUrl === url && source.rawHash === contentHash && source.retrievedAt === retrievedAt
      )
    );
  });
  return {
    payload,
    records: snapshots.map((record) => ({ key: `statement:${string(record.id)}`, record })),
    identities,
    missingRequiredFields: snapshots.length > 0 && complete
      ? []
      : ["snapshots.id/subjectId/url/contentHash/retrievedAt/httpStatus/extraction"],
    violations: duplicateProblems(ids, "Officeholder statement snapshot"),
    schemaVersion: "officeholder-statements:1",
    consumerChecks: [
      {
        consumer: "/api/positions and Ask statement search",
        passed: snapshots.length > 0 && complete,
        detail: `${snapshots.length} append-only primary-publication snapshot(s).`,
      },
    ],
    factKind: "owner-reviewed officeholder-controlled and official primary-publication snapshots",
  };
}

function curatedReaderProjection(
  contractId: "official-filings" | "ballot-navigation" | "stances" | "campaign-sites" | "member-offices" | "venue-resolutions" | "everyday-routing" | "meeting-body-crosswalk" | "special-district-boundaries" | "public-records" | "government-budgets" | "campaign-finance",
  payload: ManualProjectionPayload,
  sourceReceipt: ManualSourceSetReceipt,
): BuiltProjection {
  const held = object(payload);
  const records = rows(held, "records");
  const ids = records.map((row) => string(row.id));
  const shapeProblems: string[] = [];
  if (held?.kind !== contractId) shapeProblems.push(`The projection kind does not match ${contractId}.`);

  const referenceSources = sourceReceipt.sources.filter((source) => source.sourceClass === "REFERENCE_PUBLISHER");
  if (referenceSources.length > 0 && contractId === "member-offices") {
    if (records.some((row) => row.official !== false && referenceSources.some((source) => manualSourceUrls(source).includes(string(row.sourceUrl))))) {
      shapeProblems.push("A member office read from a reference publisher cannot be marked official.");
    }
  } else if (referenceSources.length > 0 && contractId !== "venue-resolutions") {
    shapeProblems.push(`REFERENCE_PUBLISHER evidence cannot authorize ${contractId} records.`);
  } else if (contractId === "venue-resolutions") {
    const coordinateUrls = new Set(records.map((row) => string(row.coordinateSourceUrl)).filter(Boolean));
    for (const source of referenceSources) {
      if (!coordinateUrls.has(source.requestedUrl) && !coordinateUrls.has(source.finalUrl)) {
        shapeProblems.push(`REFERENCE_PUBLISHER evidence may support only a cited venue coordinateSourceUrl: ${source.finalUrl}.`);
      }
    }
  }

  for (const row of records) {
    const issue = curatedRecordIssue(contractId, row);
    if (issue) shapeProblems.push(issue);
  }
  if (contractId === "everyday-routing") {
    shapeProblems.push(...everydayRoutingProjectionProblems(payload as EverydayRoutingProjection));
  }
  if (contractId === "meeting-body-crosswalk") {
    shapeProblems.push(...crosswalkListIssues(records).filter((issue) => issue.startsWith("CONFLICTING_EVIDENCE") || issue.endsWith("reviewed twice")));
    for (const row of records) {
      if (crosswalkRowIssue(row) !== null) continue;
      const issue = crosswalkReceiptIssue(row as unknown as MeetingBodyCrosswalkRow, sourceReceipt.sources);
      if (issue) shapeProblems.push(issue);
    }
  }

  const identities = records.map((row) => {
    const value = object(row.value);
    const subjectId = (contractId === "official-filings" || contractId === "campaign-finance") ? string(row.id) : contractId === "meeting-body-crosswalk" || contractId === "special-district-boundaries" || contractId === "public-records" || contractId === "government-budgets"
      ? string(row.bodyId)
      : contractId === "stances"
        ? string(row.personId)
        : contractId === "campaign-sites" || contractId === "member-offices"
        ? string(row.officeholderId)
        : contractId === "venue-resolutions"
          ? `${string(row.sourceId)}:${string(row.bodyOcdId) || string(row.tenant)}:${string(row.match)}`
          : contractId === "everyday-routing"
            ? `${string(row.topicId)}|${string(row.zip)}`
          : `${string(value?.state)}:${string(row.kind)}`;
    const identifiers: Record<string, string> = contractId === "everyday-routing"
      ? { record_id: string(row.id), topic_id: string(row.topicId), zip: string(row.zip) }
      : { record_id: string(row.id) };
    return {
      subjectId,
      jurisdiction: ["special-district-boundaries", "public-records", "government-budgets", "campaign-finance"].includes(contractId) ? row.ocdId === "ocd-division/country:us" ? "US" : `US-${jurisdictionFromOcdId(string(row.ocdId))?.usps ?? "UNRESOLVED"}` : contractId === "ballot-navigation" ? `US-${string(value?.state)}` : "US",
      identifiers,
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
    };
  });
  return {
    payload,
    records: records.map((record) => ({ key: string(record.id), record })),
    identities,
    missingRequiredFields: records.length > 0 ? [] : ["records"],
    violations: [...duplicateProblems(ids, "Curated Reader record"), ...shapeProblems],
    schemaVersion: `curated-reader-records:${contractId}:2`,
    consumerChecks: [{
      consumer: contractId === "official-filings" ? "/ballot official filing records" : contractId === "stances"
          ? "person card and Ask exact stance quotes"
        : contractId === "ballot-navigation"
          ? "ballot and where-to-vote official navigation"
          : contractId === "campaign-sites"
            ? "directory/map/ballot campaign-site binding"
            : contractId === "member-offices"
              ? "directory/ballot/map state legislator capitol and district offices"
            : contractId === "venue-resolutions"
              ? "meeting acquisition venue-resolution dependency"
              : contractId === "meeting-body-crosswalk"
                ? "derived meeting-source wiring: the exact body and the filter selecting its meetings"
                : "meetings preload/Ask/Admin everyday-service routing",
      passed: records.length > 0 && shapeProblems.length === 0,
      detail: `${records.length} exact ${contractId} record(s); this check has no software-suite or other-source input.`,
    }],
    factKind: `owner-reviewed ${contractId} Reader records`,
  };
}

export function manualProjectionCandidate(
  input: ManualProjectionPackage,
  options: ManualProjectionCandidateOptions = {},
): RoutineCandidate {
  if (!MANUAL_PROJECTION_CONTRACT_IDS.includes(input.contractId)) {
    throw new Error(`MANUAL_PROJECTION_CONTRACT_UNSUPPORTED:${input.contractId}`);
  }
  const sourceReceiptIssue = manualSourceReceiptStructureIssue(input.sourceReceipt);
  if (sourceReceiptIssue) {
    throw new Error(`MANUAL_SOURCE_RECEIPT_MALFORMED:${sourceReceiptIssue.code}:${sourceReceiptIssue.detail}`);
  }
  const contract = requiredManualProductionContract(input.contractId);
  const scope = manualPayloadScope(input.contractId, contract.scope, input.payload);
  const sourceContract = sourceAuthority(contract.sourceId);
  const sourcePolicy = sourceContract?.manualReceiptPromotion;
  if (!sourceContract || !sourceContract.recordClasses.includes(contract.recordClass) || !sourcePolicy) {
    throw new Error(`MANUAL_SOURCE_RECEIPT_BINDING_INVALID:${contract.sourceId}:${contract.recordClass}`);
  }
  const unauthorizedSource = input.sourceReceipt.sources.find((source) =>
    !sourcePolicy.allowedSourceClasses.includes(source.sourceClass)
  );
  if (unauthorizedSource) {
    throw new Error(`MANUAL_SOURCE_RECEIPT_CLASS_NOT_AUTHORIZED:${contract.sourceId}:${unauthorizedSource.sourceClass}`);
  }
  const isolated = SOURCE_ISOLATED_MANUAL_CONTRACTS.has(input.contractId)
    ? sourceScopedProjection(input, options.prior ?? null)
    : null;
  const payload = isolated?.payload ?? input.payload;
  const promotionReceipt = isolated?.sourceReceipt ?? input.sourceReceipt;
  // Ballot candidacies and their contest evidence must remain in one source version.
  const built = input.contractId === "plain-english-translations"
    ? plainEnglishProjection(payload)
    : input.contractId === "ballot-contests"
    ? genericBallotProjection(payload)
    : input.contractId === "candidate-profiles"
      ? profileProjection(payload)
      : input.contractId === "candidate-corpus"
        ? corpusProjection(payload, promotionReceipt)
        : input.contractId === "officeholder-statements"
          ? officeholderStatementProjection(payload, promotionReceipt)
          : curatedReaderProjection(input.contractId, payload, promotionReceipt);
  const sources = [...input.sourceReceipt.sources].sort((left, right) =>
    `${left.finalUrl}\n${left.rawHash}`.localeCompare(`${right.finalUrl}\n${right.rawHash}`)
  );
  const attemptHash = sha256(sources.map((source) =>
    `${source.requestedUrl}\n${source.finalUrl}\n${source.httpStatus}\n${source.rawHash}\n${source.reviewOutcome ?? "SUPPORTED"}\n${source.failureDetail ?? ""}${source.extractedMembers?.length ? `\n${canonicalCivicDataJson(source.extractedMembers)}` : ""}`
  ).join("\n"));
  const normalizedHash = sha256(canonicalCivicDataJson(built.payload));
  const reviewedAt = input.sourceReceipt.reviewedAt;
  const primary = promotionReceipt.sources[0];
  const blockedSources = input.sourceReceipt.sources.filter((source) => source.reviewOutcome === "BLOCKED");
  const acquired = isolated
    ? isolated.supportedCurrentSources > 0 && Boolean(primary)
    : Boolean(primary) && blockedSources.length === 0;
  const violations = [
    ...receiptCoverageProblems(built.payload, promotionReceipt),
    ...built.violations,
    ...(isolated && isolated.supportedCurrentSources > 0 && isolated.acceptedCurrentMembers === 0
      ? ["The current review supplied no valid member-scoped fact; retained LKG alone cannot turn a failed package into a successful refresh."]
      : []),
  ];
  const civicRecords = civicRecordsFor(contract.recordClass, built.payload);
  const droppedRecords = isolated?.rejectedCurrentMembers ?? 0;
  return {
    // Profiles and publications share a source and scope; their contract keeps version ids distinct.
    id: `${contract.sourceId}:${sha256(`${contract.id}\n${contract.recordClass}\n${scope}\n${attemptHash}\n${normalizedHash}\n${reviewedAt}`).slice(0, 32)}`,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope,
    retrieval: {
      succeeded: acquired,
      requestedUrl: acquired ? primary!.requestedUrl : "",
      finalUrl: acquired ? primary!.finalUrl : null,
      httpStatus: acquired ? primary!.httpStatus : (blockedSources[0]?.httpStatus ?? null),
      retrievedAt: reviewedAt,
      rawHash: acquired ? attemptHash : null,
      failureDetail: acquired
        ? undefined
        : blockedSources.length > 0
          ? `The reviewed source set is blocked at ${blockedSources.length} exact source(s): ${blockedSources.map((source) => `${source.requestedUrl} (${source.failureDetail})`).join("; ")}`
          : "The reviewed manual source set is empty; no source bytes were acquired.",
      manualSourceReceipt: promotionReceipt,
    },
    normalization: {
      succeeded: true,
      parserVersion: contract.parserNormalizerVersion,
      schemaVersion: built.schemaVersion,
      normalizedHash,
      normalizedPayloadHash: normalizedHash,
      inputRecords: civicRecords.length + droppedRecords,
      outputRecords: civicRecords.length,
      droppedRecords,
      missingRequiredFields: built.missingRequiredFields,
    },
    identities: built.identities,
    temporal: {
      version: input.version,
      expectedVersion: input.version,
      sourceThrough: input.sourceThrough,
      staleAtRetrieval: false,
    },
    semantics: { factKind: built.factKind, violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "exact records represented by the explicitly owner-reviewed source set; no wider universe claim",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(contract.sourceId, contract.recordClass, scope),
    dependentChecks: built.consumerChecks,
    normalizedPayload: built.payload,
    readModel: built.payload,
    civicRecords,
    excludedFacts: isolated?.excludedFacts ?? [],
  };
}
