import { stateFromRegistryRuntimeContractId, stateRegistryRuntimeContractId, registryJurisdictions, type StateRegistryContractId } from "../civic-data/state-scopes.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import { consumeStatePublicationRecord, immutableStateHash, immutableStateValue, rememberStatePublicationHashes, rememberStatePublicationPrior } from "../civic-data/state-publication.ts";
import type { PromotionOutcome } from "../civic-data/promotion.ts";
import type { PublishedCandidateMetadata } from "../civic-data/store.ts";
import { createHash } from "node:crypto";
import { withJsonArraySpool } from "../ops/json-file.ts";

import { civicRecordsFor } from "../civic-data/changes.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import {
  SourceScopedReconciler,
  type SourceScopedHeldFact,
  type SourceScopedMember,
} from "../civic-data/manual-source-isolation.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "../civic-data/read-model.ts";
import type { ManualSuccessorCandidate } from "../civic-data/manual-prior-authority.ts";
import { manualSourceReceiptStructureIssue, sourceAuthority } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type ManualSourceReview, type ManualSourceSetReceipt, type RoutineRemovalEvidence } from "../civic-data/types.ts";
import type { Body, Division, Registry } from "./types.ts";
import type { BodyRoster, RosterReaderDisposition } from "./body-rosters.ts";
import { CENSUS_PLACEHOLDER_LABELS, CENSUS_PLACEHOLDER_BODY_ISSUE, isCensusPlaceholderDivision } from "./census-placeholders.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { officialStateVoteScopeForOfficeholderId } from "../state-rollcalls/authority.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { nameParts, namesAgree, namesAgreeLoosely, splitDisplayName } from "../ballot/incumbency.ts";
import type { BallotSet } from "../ballot/types.ts";

export const REGISTRY_RUNTIME_SOURCE_ID = "registry-reviewed-bindings" as const;
export const REGISTRY_RUNTIME_PARSER_VERSION = "registry-runtime-bindings/3" as const;

export interface OfficialPhotoManifestRow {
  readonly officeholderId: string;
  readonly personId?: string;
  readonly name: string;
  readonly url: string;
  readonly sourceUrl?: string | null;
  readonly license: string | null;
  readonly attribution?: string | null;
  readonly collectedAt?: string | null;
  readonly verification?: import("../photos/binding.ts").PortraitVerification;
}

export interface OfficialCandidacyBridgeRow {
  readonly holder: {
    readonly id: string;
    readonly name: string;
    readonly officeTitle: string;
    readonly divisions: readonly string[];
    readonly authority: "FEDERAL_DIRECTORY" | "STATE_PEOPLE" | "REGISTRY_STATEWIDE_EXECUTIVE" | "REGISTRY_BODY_ROSTER";
    readonly sourceUrl: string | null;
  };
  readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED" | "NOT_CHECKED";
  readonly candidacy: {
    readonly candidacyId: string;
    readonly contestId: string;
    readonly contestTitle: string;
    readonly divisionId: string;
    readonly electionId: string;
    readonly candidateName: string;
    readonly sourceUrl: string;
  } | null;
  readonly reason: string;
  readonly unresolvedCandidacyIds: readonly string[];
  readonly ballotSourceUrls?: readonly string[];
}

export interface OfficialCandidacyBridge {
  readonly formatVersion: 1;
  readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
  readonly rows: readonly OfficialCandidacyBridgeRow[];
}

export function officialCandidacySeatMatches(row: OfficialCandidacyBridgeRow): boolean {
  const candidacy = row.status === "RESOLVED" ? row.candidacy : null;
  const office = officeIdentity(row.holder.officeTitle);
  if (!candidacy || !office || !row.holder.divisions.includes(candidacy.divisionId) || officeIdentity(candidacy.contestTitle) !== office ||
    !sameSeatDiscriminators(candidacy.contestTitle, row.holder.officeTitle, candidacy.divisionId)) return false;
  const holder = splitDisplayName(row.holder.name), candidate = splitDisplayName(candidacy.candidateName);
  const left = nameParts(holder.givenName, holder.familyName), right = nameParts(candidate.givenName, candidate.familyName);
  return namesAgree(left, right) || namesAgreeLoosely(left, right);
}

export function reconcileOfficialCandidacies(input: {
  readonly bridge: OfficialCandidacyBridge;
  readonly ballots: readonly BallotSet[];
  readonly holders?: readonly OfficialCandidacyBridgeRow["holder"][];
}): OfficialCandidacyBridge {
  const holders = new Map(input.bridge.rows.map(row => [row.holder.id, row.holder]));
  for (const holder of input.holders ?? []) holders.set(holder.id, holder);
  const contests = input.ballots.flatMap(ballot => ballot.contests.filter(contest => contest.type === "CANDIDACY")
    .map(contest => ({ ballot, contest, office: officeIdentity(contest.title),
      candidates: ballot.candidacies.filter(candidate => candidate.contestId === contest.id).map(candidate => {
        const display = [candidate.givenName, candidate.familyName].filter(Boolean).join(" ");
        const parts = candidate.givenName ? candidate : splitDisplayName(display);
        return { candidate, display, name: nameParts(parts.givenName, parts.familyName) };
      }) })));
  const bySeat = new Map<string, typeof contests>();
  for (const contest of contests) if (contest.office) {
    const key = `${contest.contest.ocdId}\u0000${contest.office}`;
    bySeat.set(key, [...bySeat.get(key) ?? [], contest]);
  }
  const rows = new Map(input.bridge.rows.map(row => [row.holder.id, row]));
  for (const holder of holders.values()) {
    const office = officeIdentity(holder.officeTitle);
    if (!office) continue;
    const exact = holder.divisions.flatMap(division => bySeat.get(`${division}\u0000${office}`) ?? [])
      .filter(({ contest }) => sameSeatDiscriminators(contest.title, holder.officeTitle, contest.ocdId));
    if (!exact.length) continue;
    const latest = exact.map(row => row.ballot.election.date).sort().at(-1);
    const current = exact.filter(row => row.ballot.election.date === latest);
    const parts = splitDisplayName(holder.name), name = nameParts(parts.givenName, parts.familyName);
    const matches = current.flatMap(row => row.candidates.filter(candidate => namesAgree(name, candidate.name) || namesAgreeLoosely(name, candidate.name))
      .map(candidate => ({ ...row, ...candidate })));
    if (matches.length !== 1) {
      if (matches.length) rows.set(holder.id, { holder, status: "IDENTITY_UNRESOLVED", candidacy: null,
        reason: "The exact seat has more than one ballot candidacy matching this officeholder.",
        unresolvedCandidacyIds: matches.map(row => row.candidate.id).sort(),
        ballotSourceUrls: httpsUrls(current.map(row => row.contest.provenance.sourceUrl)) });
      else if (current.every(row => row.contest.candidateListComplete === true)) rows.set(holder.id, { holder,
        status: "NO_APPLICABLE_CANDIDACY", candidacy: null, reason: "The complete sourced ballot for this exact seat does not list the current officeholder.",
        unresolvedCandidacyIds: [], ballotSourceUrls: httpsUrls(current.map(row => row.contest.provenance.sourceUrl)) });
      continue;
    }
    const match = matches[0];
    if (!match.candidate.provenance.sourceUrl) continue;
    const seatHolders = [...holders.values()].filter(other => other.divisions.includes(match.contest.ocdId) &&
      officeIdentity(other.officeTitle) === office && sameSeatDiscriminators(match.contest.title, other.officeTitle, match.contest.ocdId));
    const matchingHolders = seatHolders.filter(other => {
      const parts = splitDisplayName(other.name), otherName = nameParts(parts.givenName, parts.familyName);
      return namesAgree(otherName, match.name) || namesAgreeLoosely(otherName, match.name);
    });
    if (matchingHolders.length !== 1) {
      rows.set(holder.id, { holder, status: "IDENTITY_UNRESOLVED", candidacy: null,
        reason: "The candidacy's exact seat has more than one matching current officeholder.", unresolvedCandidacyIds: [match.candidate.id],
        ballotSourceUrls: httpsUrls([match.contest.provenance.sourceUrl]) });
      continue;
    }
    rows.set(holder.id, { holder, status: "RESOLVED", candidacy: {
      candidacyId: match.candidate.id, contestId: match.contest.id, contestTitle: match.contest.title,
      divisionId: match.contest.ocdId, electionId: match.ballot.election.id, candidateName: match.display,
      sourceUrl: match.candidate.provenance.sourceUrl,
    }, reason: "The current officeholder and a unique candidate on the sourced ballot agree on name, exact division, office and seat.", unresolvedCandidacyIds: [] });
  }
  return { ...input.bridge, rows: [...rows.values()] };
}

export interface RegistryRuntimeCarton {
  readonly formatVersion: 1;
  readonly registry: Registry;
  readonly bodyRosters?: readonly BodyRoster[];
  readonly rosterReaderDispositions?: readonly RosterReaderDisposition[];
  readonly statewideExecutives: readonly StatewideExecutive[];
  readonly officialCandidacies: OfficialCandidacyBridge;
  readonly officialPhotos: { readonly photos: readonly OfficialPhotoManifestRow[] };
  readonly rosterPhotos: Readonly<Record<string, string>>;
}

export interface RegistryRuntimeReadModel extends RegistryRuntimeCarton {
  readonly bodyRosters: readonly BodyRoster[];
  readonly rosterReaderDispositions: readonly RosterReaderDisposition[];
}

export interface RegistryRuntimePackage {
  readonly excludedFacts?: readonly SourceScopedHeldFact[];
  readonly contractId: StateRegistryContractId;
  readonly version: string;
  readonly sourceThrough: string;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly payload: RegistryRuntimeCarton;

  readonly scope?: "MEMBERS";
  readonly departures?: readonly { readonly bodyId: string; readonly holderId: string; readonly sourceUrl: string; readonly replacementHolderId?: string; readonly officeTitle?: string }[];
}

const departureKeys = (holderId: string) => ["statewide-executive", "official-candidacy", "official-photo", "roster-photo"].map(kind => `${kind}:${holderId}`);

export interface RegistryRuntimePrior {
  readonly versionId: string;
  readonly payload: RegistryRuntimeCarton;
  readonly sourceReceipt?: ManualSourceSetReceipt;
  /** The exact GOOD base's read model, bound so inherited members name the version they came from. */
  readonly readModelSha256: string;
}

interface RegistryRuntimeCandidateOptions {
  readonly prior?: RegistryRuntimePrior | null;
}

type RegistryIsolationRecord =
  | {
      readonly kind: "PROJECTION_METADATA";
      readonly value: {
        readonly formatVersion: RegistryRuntimeCarton["formatVersion"];
        readonly generatedAt: string;
        readonly candidacyFormatVersion: OfficialCandidacyBridge["formatVersion"];
        readonly candidacyRule: OfficialCandidacyBridge["rule"];
        readonly evidenceUrls: readonly string[];
      };
    }
  | { readonly kind: "DIVISION"; readonly value: Division }
  | {
      readonly kind: "BODY";
      readonly value: {
        readonly row: Body;
        readonly evidenceUrls: readonly string[];
      };
    }
  | { readonly kind: "BODY_ROSTER"; readonly value: BodyRoster }
  | { readonly kind: "ROSTER_DISPOSITION"; readonly value: { readonly row: RosterReaderDisposition; readonly evidenceUrls: readonly string[] } }
  | { readonly kind: "STATEWIDE_EXECUTIVE"; readonly value: StatewideExecutive }
  | {
      readonly kind: "OFFICIAL_CANDIDACY";
      readonly value: {
        readonly row: OfficialCandidacyBridgeRow;
        readonly evidenceUrls: readonly string[];
      };
    }
  | {
      readonly kind: "OFFICIAL_PHOTO";
      readonly value: {
        readonly photo: OfficialPhotoManifestRow | null;
        readonly rosterPhoto: string | null;
      };
    };

interface RegistryIsolationResult {
  readonly payload: RegistryRuntimeCarton;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly excludedFacts: readonly SourceScopedHeldFact[];
  readonly supportedCurrentSources: number;
  readonly acceptedCurrentMembers: number;
  readonly acceptedCurrentFactMembers: number;
  readonly rejectedCurrentMembers: number;
  readonly hasProjectionMetadata: boolean;
  readonly removalEvidence: readonly RoutineRemovalEvidence[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function httpsUrls(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && /^https:\/\//.test(value)
  ))].sort();
}

function reviewedSourceUrls(sources: readonly ManualSourceReview[]): string[] {
  return httpsUrls(sources.flatMap((source) => [source.requestedUrl, source.finalUrl]));
}

function statewideExecutiveUrls(row: StatewideExecutive): string[] {
  return httpsUrls([row.sourceUrl, row.partySourceUrl]);
}

interface RegistryMemberContext {
  readonly divisionSources: Map<string, string | null>;
  readonly executiveSources: Map<string, string[]>;
  readonly rosterSources: Map<string, string[]>;
  readonly placeholderDivisions: Set<string>;
  readonly translatedDivisions: Set<string>;
}

function registryMemberContext(): RegistryMemberContext {
  return { divisionSources: new Map(), executiveSources: new Map(), rosterSources: new Map(), placeholderDivisions: new Set(), translatedDivisions: new Set() };
}

function observeRegistryRow(context: RegistryMemberContext, path: string, value: unknown): void {
  if (path === "registry.divisions") {
    const row = value as Division;
    context.divisionSources.set(row.ocdId, row.provenance.sourceUrl);
    if (isCensusPlaceholderDivision(row)) context.placeholderDivisions.add(row.ocdId);
    if (CENSUS_PLACEHOLDER_LABELS[row.label] !== undefined) context.translatedDivisions.add(row.ocdId);
  } else if (path === "statewideExecutives") {
    const row = value as StatewideExecutive;
    context.executiveSources.set(row.holder.id, statewideExecutiveUrls(row));
  } else if (path === "bodyRosters") {
    const row = value as BodyRoster;
    for (const member of row.members) context.rosterSources.set(member.id, httpsUrls([row.sourceUrl, member.membershipSource?.sourceUrl]));
  }
}

function registryMetadataMember(payload: RegistryRuntimeCarton, receipt?: ManualSourceSetReceipt): SourceScopedMember<RegistryIsolationRecord> {
  return { key: "projection:metadata", record: { kind: "PROJECTION_METADATA", value: {
    formatVersion: payload.formatVersion, generatedAt: payload.registry.generatedAt,
    candidacyFormatVersion: payload.officialCandidacies.formatVersion, candidacyRule: payload.officialCandidacies.rule,
    evidenceUrls: reviewedSourceUrls(receipt?.sources ?? []),
  } } };
}

function registryRowMember(path: string, value: unknown, context: RegistryMemberContext,
  payload: RegistryRuntimeCarton, receipt?: ManualSourceSetReceipt): SourceScopedMember<RegistryIsolationRecord> {
  if (path === "registry.divisions") {
    const row = value as Division;
    return { key: `division:${row.ocdId}`, record: { kind: "DIVISION", value: row } };
  }
  if (path === "registry.bodies") {
    const row = value as Body;
    return { key: `body:${row.id}`, record: { kind: "BODY", value: { row,
      evidenceUrls: httpsUrls([row.provenance.sourceUrl, row.ocdId ? context.divisionSources.get(row.ocdId) : null]) } } };
  }
  if (path === "bodyRosters") {
    const row = value as BodyRoster;
    return { key: `body-roster:${row.bodyId}`, record: { kind: "BODY_ROSTER", value: row } };
  }
  if (path === "rosterReaderDispositions") {
    const row = value as RosterReaderDisposition;
    return { key: `roster-disposition:${row.sourceId}`, record: { kind: "ROSTER_DISPOSITION", value: { row,
      evidenceUrls: context.rosterSources.get(row.sourceId) ?? (row.canonicalId ? context.rosterSources.get(row.canonicalId) : undefined) ?? [] } } };
  }
  if (path === "statewideExecutives") {
    const row = value as StatewideExecutive;
    return { key: `statewide-executive:${row.holder.id}`, record: { kind: "STATEWIDE_EXECUTIVE", value: row } };
  }
  if (path === "officialCandidacies.rows") {
    const row = value as OfficialCandidacyBridgeRow;
    const evidenceUrls = row.ballotSourceUrls?.length ? httpsUrls(row.ballotSourceUrls)
      : row.status === "NOT_CHECKED" ? httpsUrls([row.holder.sourceUrl])
      : row.candidacy?.sourceUrl ? httpsUrls([row.candidacy.sourceUrl])
      : row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE" && context.executiveSources.has(row.holder.id)
        ? context.executiveSources.get(row.holder.id)!
      : row.holder.authority === "REGISTRY_BODY_ROSTER" ? httpsUrls([row.holder.sourceUrl])
      : reviewedSourceUrls(receipt?.sources ?? []);
    return { key: `official-candidacy:${row.holder.id}`, record: { kind: "OFFICIAL_CANDIDACY", value: { row, evidenceUrls } } };
  }
  const photo = value as OfficialPhotoManifestRow;
  return { key: `official-photo:${photo.officeholderId}`, record: { kind: "OFFICIAL_PHOTO", value: {
    photo, rosterPhoto: payload.rosterPhotos[photo.officeholderId] ?? null,
  } } };
}

const registryArrayPaths = ["registry.divisions", "registry.bodies", "bodyRosters", "rosterReaderDispositions",
  "statewideExecutives", "officialCandidacies.rows", "officialPhotos.photos"] as const;

function registryRows(payload: RegistryRuntimeCarton): [string, readonly unknown[]][] {
  return [["registry.divisions", payload.registry.divisions], ["registry.bodies", payload.registry.bodies],
    ["bodyRosters", payload.bodyRosters ?? []], ["rosterReaderDispositions", payload.rosterReaderDispositions ?? []],
    ["statewideExecutives", payload.statewideExecutives], ["officialCandidacies.rows", payload.officialCandidacies.rows],
    ["officialPhotos.photos", [...new Map(payload.officialPhotos.photos.map(photo => [photo.officeholderId, photo])).values()]]];
}

function registryIsolationMembers(payload: RegistryRuntimeCarton, receipt?: ManualSourceSetReceipt): SourceScopedMember<RegistryIsolationRecord>[] {
  const context = registryMemberContext(), rows = registryRows(payload);
  for (const [path, values] of rows) for (const row of values) observeRegistryRow(context, path, row);
  const members = [registryMetadataMember(payload, receipt),
    ...rows.flatMap(([path, values]) => values.map(row => registryRowMember(path, row, context, payload, receipt)))];
  const photos = new Set(payload.officialPhotos.photos.map(photo => photo.officeholderId));
  for (const [id, rosterPhoto] of Object.entries(payload.rosterPhotos)) if (!photos.has(id))
    members.push({ key: `official-photo:${id}`, record: { kind: "OFFICIAL_PHOTO", value: { photo: null, rosterPhoto } } });
  return members;
}

function registryIsolationUrls(member: SourceScopedMember<RegistryIsolationRecord>): readonly string[] {
  const record = member.record;
  if (record.kind === "PROJECTION_METADATA") return record.value.evidenceUrls;
  if (record.kind === "DIVISION") return httpsUrls([record.value.provenance.sourceUrl]);
  if (record.kind === "BODY") return record.value.evidenceUrls;
  if (record.kind === "BODY_ROSTER") return registryMemberCitedUrls(member.key, record.value);
  if (record.kind === "ROSTER_DISPOSITION") return record.value.evidenceUrls;
  if (record.kind === "STATEWIDE_EXECUTIVE") return statewideExecutiveUrls(record.value);
  if (record.kind === "OFFICIAL_CANDIDACY") return record.value.evidenceUrls;
  return httpsUrls([record.value.photo?.sourceUrl, ...(record.value.photo?.verification?.sources.map(s=>s.url) ?? [])]);
}

function registryIsolationIssue(member: SourceScopedMember<RegistryIsolationRecord>): string | null {
  const record = member.record;
  if (record.kind === "PROJECTION_METADATA") {
    return record.value.formatVersion !== 1 || record.value.candidacyFormatVersion !== 1 ||
        record.value.candidacyRule !== "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE" ||
        !Number.isFinite(Date.parse(record.value.generatedAt))
      ? "The registry projection metadata has an unsupported format, bridge rule, or generation time."
      : null;
  }
  if (record.kind === "DIVISION") {
    return !record.value.ocdId || !record.value.state || !record.value.label || registryIsolationUrls(member).length === 0
      ? `${member.key} lacks its exact identity, label, or division-source evidence.`
      : null;
  }
  if (record.kind === "BODY") {
    return !record.value.row.id || !record.value.row.bodyClass || !record.value.row.bodyOrigin || registryIsolationUrls(member).length === 0
      ? `${member.key} lacks its exact identity, body classification, or body/division-source evidence.`
      : null;
  }
  if (record.kind === "BODY_ROSTER") return !record.value.bodyId || !record.value.sourceUrl || !record.value.sourceOrg ||
      !record.value.collectedAt || record.value.members.some(row => !row.id || !row.name || !row.officeTitle)
    ? `${member.key} lacks a sourced body or exact member identity.` : null;
  if (record.kind === "ROSTER_DISPOSITION") return !record.value.row.sourceId || !record.value.row.reason ||
      !["READER_ELIGIBLE", "EXACT_DUPLICATE", "IDENTITY_UNRESOLVED"].includes(record.value.row.state) || !record.value.evidenceUrls.length
    ? `${member.key} lacks an exact sourced roster disposition.` : null;
  if (record.kind === "STATEWIDE_EXECUTIVE") {
    const row = record.value;
    return !row.holder.id || !row.holder.name || !row.holder.officeTitle || !row.stateOcdId || !row.sourceOrg ||
        !row.collectedAt || registryIsolationUrls(member).length === 0 || (row.holder.partyLabel && !row.partySourceUrl)
      ? `${member.key} lacks exact statewide identity, source, or party provenance.`
      : null;
  }
  if (record.kind === "OFFICIAL_CANDIDACY") {
    const row = record.value.row;
    const statusPayloadInvalid = row.status === "RESOLVED"
      ? !row.candidacy?.candidacyId || !row.candidacy.contestId || !row.candidacy.divisionId || !row.candidacy.sourceUrl
      : row.candidacy !== null;
    return !row.holder.id || !row.holder.name || !row.holder.officeTitle || !row.holder.sourceUrl || !row.reason ||
        statusPayloadInvalid || registryIsolationUrls(member).length === 0
      ? `${member.key} lacks an exact holder/candidacy disposition or its source boundary.`
      : null;
  }
  const { photo, rosterPhoto } = record.value;
  return !photo || !photo.officeholderId || !photo.name || !photo.url ||
      (photo.verification !== undefined && !portraitBindingMatches(photo.personId ?? photo.officeholderId, photo)) ||
      registryIsolationUrls(member).length === 0 ||
      (rosterPhoto !== null && ((!photo.license && !portraitBindingMatches(photo.personId ?? photo.officeholderId, photo)) || rosterPhoto !== photo.url))
    ? `${member.key} lacks a sourced, exact portrait binding.`
    : null;
}

function rebuildRegistryRuntime(
  input: RegistryRuntimeCarton,
  prior: RegistryRuntimeCarton | null,
  members: readonly SourceScopedMember<RegistryIsolationRecord>[],
): RegistryRuntimeCarton {
  const metadata = members.find((member) => member.record.kind === "PROJECTION_METADATA")?.record;
  const fallbackMetadata = {
    formatVersion: prior?.formatVersion ?? input.formatVersion,
    generatedAt: prior?.registry.generatedAt ?? input.registry.generatedAt,
    candidacyFormatVersion: prior?.officialCandidacies.formatVersion ?? input.officialCandidacies.formatVersion,
    candidacyRule: prior?.officialCandidacies.rule ?? input.officialCandidacies.rule,
  };
  const meta = metadata?.kind === "PROJECTION_METADATA" ? metadata.value : fallbackMetadata;
  const divisions = members.flatMap((member) => member.record.kind === "DIVISION" ? [member.record.value] : []);
  const bodies = members.flatMap((member) => member.record.kind === "BODY" ? [member.record.value.row] : []);
  const statewideExecutives = members.flatMap((member) => member.record.kind === "STATEWIDE_EXECUTIVE" ? [member.record.value] : []);
  const candidacies = members.flatMap((member) => member.record.kind === "OFFICIAL_CANDIDACY" ? [member.record.value.row] : []);
  const photoBindings = members.flatMap((member) => member.record.kind === "OFFICIAL_PHOTO" ? [member.record.value] : []);
  return {
    formatVersion: meta.formatVersion,
    registry: {
      generatedAt: meta.generatedAt,
      divisions: divisions.sort((left, right) => left.ocdId.localeCompare(right.ocdId)),
      bodies: bodies.sort((left, right) => left.id.localeCompare(right.id)),
    },
    ...(input.bodyRosters !== undefined || prior?.bodyRosters !== undefined ? {
      bodyRosters: members.flatMap(member => member.record.kind === "BODY_ROSTER" ? [member.record.value] : [])
        .sort((left, right) => left.bodyId.localeCompare(right.bodyId)),
    } : {}),
    ...(input.rosterReaderDispositions !== undefined || prior?.rosterReaderDispositions !== undefined ? {
      rosterReaderDispositions: members.flatMap(member => member.record.kind === "ROSTER_DISPOSITION" ? [member.record.value.row] : [])
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    } : {}),
    statewideExecutives: statewideExecutives.sort((left, right) => left.holder.id.localeCompare(right.holder.id)),
    officialCandidacies: {
      formatVersion: meta.candidacyFormatVersion,
      rule: meta.candidacyRule,
      rows: candidacies.sort((left, right) => left.holder.id.localeCompare(right.holder.id)),
    },
    officialPhotos: {
      photos: photoBindings.flatMap(({ photo }) => photo ? [photo] : [])
        .sort((left, right) => left.officeholderId.localeCompare(right.officeholderId)),
    },
    rosterPhotos: Object.fromEntries(photoBindings
      .flatMap(({ photo, rosterPhoto }) => photo && rosterPhoto ? [[photo.officeholderId, rosterPhoto] as const] : [])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

interface RegistryPriorProof {
  readonly versionId: string;
  readonly readModelSha256: string;
  readonly hashes: ReadonlyMap<string, string>;
  readonly bodyDivisions: ReadonlyMap<string, string | null>;
}

function registerRegistryPrior(prior: RegistryRuntimePrior | null, scope: string): RegistryPriorProof | null {
  if (!prior) return null;
  const held = priorStores.get(prior);
  if (held) {
    const projection = { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope, versionId: prior.versionId, payload: prior.payload };
    rememberStatePublicationHashes(projection, held.normalization);
    rememberStatePublicationPrior(held.store, projection);
  }
  priorStores.delete(prior);
  return { versionId: prior.versionId, readModelSha256: prior.readModelSha256,
    hashes: new Map(held?.normalization.stateRecordHashes
      ? held.normalization.stateRecordHashes.members.map(member => [member.key, member.sha256])
      : civicRecordsFor("REGISTRY_RUNTIME_BINDING", prior.payload).map(member => [member.key, canonicalCivicDataHash(member.record)])),
    bodyDivisions: new Map(prior.payload.registry.bodies.map(body => [body.id, body.ocdId])) };
}

function registryPackageHeader(input: RegistryRuntimePackage): RegistryRuntimePackage {
  const payload = input.payload;
  return { ...input, payload: { ...payload, registry: { ...payload.registry, divisions: [], bodies: [] },
    ...(payload.bodyRosters !== undefined ? { bodyRosters: [] } : {}),
    ...(payload.rosterReaderDispositions !== undefined ? { rosterReaderDispositions: [] } : {}),
    statewideExecutives: [], officialCandidacies: { ...payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] } } };
}

function consumeRegistryMember(previous: SourceScopedMember<RegistryIsolationRecord>, next?: SourceScopedMember<RegistryIsolationRecord>): void {
  const rows = (member?: SourceScopedMember<RegistryIsolationRecord>): Map<string, unknown> => {
    if (!member || member.record.kind === "PROJECTION_METADATA") return new Map();
    const record = member.record;
    if (record.kind === "OFFICIAL_PHOTO") return new Map<string, unknown>([
      [member.key, record.value.photo], [member.key.replace(/^official-photo:/, "roster-photo:"), record.value.rosterPhoto],
    ]);
    return new Map([[member.key, record.kind === "BODY" || record.kind === "ROSTER_DISPOSITION" || record.kind === "OFFICIAL_CANDIDACY"
      ? record.value.row : record.value]]);
  };
  const selected = rows(next);
  for (const [key, row] of rows(previous)) consumeStatePublicationRecord(row, selected.get(key) ?? null, key);
}

function assertRegistryMemberState(member: SourceScopedMember<RegistryIsolationRecord>, state: string): void {
  const row = member.record;
  const valid = row.kind === "DIVISION" ? row.value.state.toUpperCase() === state
    : row.kind === "BODY" ? [row.value.row.ocdId, row.value.row.id, ...(row.value.row.alsoServesOcdIds ?? [])].some(id => registryJurisdictions(id).includes(state))
    : row.kind === "BODY_ROSTER" ? registryJurisdictions(row.value.bodyId).includes(state)
    : row.kind === "STATEWIDE_EXECUTIVE" ? registryJurisdictions(row.value.stateOcdId).includes(state)
    : row.kind === "OFFICIAL_CANDIDACY" ? !row.value.row.holder.divisions.length || row.value.row.holder.divisions.some(id => registryJurisdictions(id).includes(state))
    : true;
  if (!valid) throw new Error(`REGISTRY_STATE_SCOPE_MISMATCH:${state}`);
}

class RegistryCandidateAssembly {
  readonly input: RegistryRuntimePackage;
  readonly prior: RegistryPriorProof | null;
  private readonly state: string;
  private readonly reconciler: SourceScopedReconciler<RegistryIsolationRecord>;
  private readonly priorMetadata: RegistryRuntimeCarton | null;
  private readonly protectedPrior = new Map<string, SourceScopedMember<RegistryIsolationRecord>>();
  private readonly referenceSources: ManualSourceReview[];
  private readonly citedReferences = new Set<ManualSourceReview>();
  private readonly departures: NonNullable<RegistryRuntimePackage["departures"]>[number][] = [];

  constructor(input: RegistryRuntimePackage, prior: RegistryRuntimePrior | null, incoming: RegistryMemberContext) {
    const state = stateFromRegistryRuntimeContractId(input.contractId);
    if (!state) throw new Error(`REGISTRY_STATE_CONTRACT_REQUIRED:${input.contractId}`);
    this.state = state;
    this.input = registryPackageHeader(input);
    this.priorMetadata = prior ? registryPackageHeader({ ...input, payload: prior.payload }).payload : null;
    const contract = requiredManualProductionContract(input.contractId), receiptIssue = manualSourceReceiptStructureIssue(input.sourceReceipt);
    if (receiptIssue) throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_MALFORMED:${receiptIssue.code}:${receiptIssue.detail}`);
    const authority = sourceAuthority(contract.sourceId), policy = authority?.manualReceiptPromotion;
    if (!authority || !authority.recordClasses.includes(contract.recordClass) || !policy)
      throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_BINDING_INVALID:${contract.sourceId}:${contract.recordClass}`);
    const unauthorized = input.sourceReceipt.sources.find(source => !policy.allowedSourceClasses.includes(source.sourceClass));
    if (unauthorized) throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_CLASS_NOT_AUTHORIZED:${unauthorized.sourceClass}`);
    this.referenceSources = input.sourceReceipt.sources.filter(source => source.sourceClass === "REFERENCE_PUBLISHER");
    this.prior = registerRegistryPrior(prior, contract.scope);
    const priorMembers = prior ? registryIsolationMembers(prior.payload, prior.sourceReceipt) : [];
    const placeholders = new Set([...incoming.placeholderDivisions,
      ...priorMembers.flatMap(member => member.record.kind === "DIVISION" && isCensusPlaceholderDivision(member.record.value) ? [member.record.value.ocdId] : [])]);
    const departureIds = new Set(input.departures?.flatMap(departure => departureKeys(departure.holderId)) ?? []);
    for (const member of priorMembers) {
      assertRegistryMemberState(member, state);
      if (member.record.kind === "DIVISION" && (CENSUS_PLACEHOLDER_LABELS[member.record.value.label] !== undefined || incoming.translatedDivisions.has(member.record.value.ocdId)) ||
        departureIds.has(member.key) || member.record.kind === "BODY" && member.record.value.row.ocdId !== null && placeholders.has(member.record.value.row.ocdId))
        this.protectedPrior.set(member.key, member);
    }
    this.reconciler = new SourceScopedReconciler({ currentReceipt: input.sourceReceipt,
      prior: prior ? { members: priorMembers, sourceReceipt: prior.sourceReceipt } : null,
      memberIssue: member => {
        const issue = registryIsolationIssue(member);
        if (issue || member.record.kind !== "OFFICIAL_PHOTO") return issue;
        const photo = member.record.value.photo!;
        if (this.prior?.hashes.get(member.key) === canonicalCivicDataHash(photo)) return null;
        return portraitBindingMatches(photo.personId ?? photo.officeholderId, photo) ? null : `${member.key} needs its §3 portrait source binding.`;
      }, sourceUrls: registryIsolationUrls,
      onReplace: (previous, next) => { if (!this.protectedPrior.has(previous.key)) consumeRegistryMember(previous, next); },
    });
  }

  add(group: readonly SourceScopedMember<RegistryIsolationRecord>[]): void {
    for (const member of group) {
      assertRegistryMemberState(member, this.state);
      if (member.record.kind === "STATEWIDE_EXECUTIVE") {
        const row = member.record.value;
        for (const departure of this.input.departures ?? []) if (departure.replacementHolderId !== undefined &&
          row.stateOcdId === departure.bodyId && row.sourceUrl === departure.sourceUrl && row.holder.id === departure.replacementHolderId &&
          row.holder.id !== departure.holderId && row.holder.officeTitle === departure.officeTitle && !this.departures.includes(departure)) this.departures.push(departure);
      }
      if (member.record.kind === "PROJECTION_METADATA") continue;
      const urls = registryIsolationUrls(member);
      for (const source of this.referenceSources) if (urls.some(url => url === source.requestedUrl || url === source.finalUrl)) {
        if (member.record.kind !== "OFFICIAL_PHOTO" || !member.record.value.photo ||
          !portraitBindingMatches(member.record.value.photo.personId ?? member.record.value.photo.officeholderId, member.record.value.photo))
          throw new Error("REGISTRY_RUNTIME_REFERENCE_SOURCE_NOT_VERIFIED_PORTRAIT");
        this.citedReferences.add(source);
      }
    }
    this.reconciler.add(group);
  }

  finish(): ManualSuccessorCandidate {
    if (this.referenceSources.some(source => !this.citedReferences.has(source))) throw new Error("REGISTRY_RUNTIME_REFERENCE_SOURCE_NOT_VERIFIED_PORTRAIT");
    const reconciled = this.reconciler.finish(), input = this.input;
    const metadataAccepted = input.sourceReceipt.sources.every(source => (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED") &&
      registryIsolationIssue(registryMetadataMember(input.payload, input.sourceReceipt)) === null;
    const placeholders = new Set(reconciled.members.flatMap(member =>
      member.record.kind === "DIVISION" && isCensusPlaceholderDivision(member.record.value) ? [member.record.value.ocdId] : []));
    const removedKeys = new Set(reconciled.members.flatMap(member => member.record.kind === "BODY" &&
      member.record.value.row.ocdId !== null && placeholders.has(member.record.value.row.ocdId) ? [member.key] : []));
    const departedKeys = new Set(this.departures.flatMap(departure => departureKeys(departure.holderId)));
    const members = reconciled.members.filter(member => !removedKeys.has(member.key) && !departedKeys.has(member.key)).map(member => {
      if (member.record.kind !== "DIVISION") return member;
      const label = CENSUS_PLACEHOLDER_LABELS[member.record.value.label];
      return label === undefined ? member : { ...member, record: { ...member.record, value: { ...member.record.value, label } } };
    });
    const selected = new Map(members.map(member => [member.key, member]));
    for (const previous of this.protectedPrior.values()) consumeRegistryMember(previous, selected.get(previous.key));
    this.protectedPrior.clear();
    const payload = rebuildRegistryRuntime(input.payload, this.priorMetadata, members);
    const finalKeys = new Set(civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload).map(member => member.key));
    const removalEvidence: RoutineRemovalEvidence[] = [
      ...[...(this.prior?.bodyDivisions ?? [])].flatMap(([id, divisionOcdId]) => divisionOcdId && placeholders.has(divisionOcdId) && !finalKeys.has(`body:${id}`)
        ? [{ key: `body:${id}`, code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" as const, divisionOcdId }] : []),
      ...this.departures.flatMap(departure => departureKeys(departure.holderId).filter(key => this.prior?.hashes.has(key) && !finalKeys.has(key))
        .map(key => ({ key, code: "OFFICIAL_ROSTER_NO_LONGER_LISTS" as const, ...departure }))),
    ];
    return registryCandidateFromIsolation(input, {
      payload, sourceReceipt: reconciled.promotionReceipt, removalEvidence,
      excludedFacts: [
        ...input.sourceReceipt.sources.filter(source => source.reviewOutcome === "BLOCKED").map(source => ({
          key: `source:${source.requestedUrl}`, code: "MANUAL_SOURCE_BLOCKED",
          detail: `${source.requestedUrl} was blocked and could not authorize any current registry member: ${source.failureDetail}.`, record: source })),
        ...reconciled.excludedFacts.filter(fact => !removedKeys.has(fact.key) && !departedKeys.has(fact.key) &&
          !(input.scope === "MEMBERS" && fact.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING")),
        ...reconciled.members.filter(member => removedKeys.has(member.key)).map(member => ({ key: member.key,
          code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT", detail: `${member.key} sits on a Census "no district here" placeholder (LEA 99997): geography, never a government, so no body is registered on it.`, record: member.record })),
      ], supportedCurrentSources: reconciled.supportedCurrentSources, acceptedCurrentMembers: reconciled.acceptedCurrentMembers,
      acceptedCurrentFactMembers: reconciled.acceptedCurrentMembers - (metadataAccepted ? 1 : 0),
      rejectedCurrentMembers: reconciled.rejectedCurrentMembers,
      hasProjectionMetadata: reconciled.members.some(member => member.record.kind === "PROJECTION_METADATA"),
    }, this.prior);
  }
}

function inheritedRegistryMembers(payload: RegistryRuntimeCarton, prior: RegistryPriorProof | null, receipted: ReadonlySet<string>): Map<string, string> {
  const inherited = new Map<string, string>();
  if (!prior) return inherited;
  for (const member of civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload)) {
    const digest = canonicalCivicDataHash(member.record);
    if (prior.hashes.get(member.key) === digest && registryMemberCitedUrls(member.key, member.record).some(url => !receipted.has(url))) inherited.set(member.key, digest);
  }
  return inherited;
}

export async function readRegistryRuntimePrior(
  store: CivicDataReadStore,
  now: string,
  state: string,
): Promise<RegistryRuntimePrior | null> {
  const contract = requiredManualProductionContract(stateRegistryRuntimeContractId(state));
  const captured = { candidate: null as PublishedCandidateMetadata | null };
  const observedStore = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: store.readCandidate.bind(store),
    ...(store.readPublishedCandidateMetadata ? { async readPublishedCandidateMetadata(candidateId: string) {
      captured.candidate = await store.readPublishedCandidateMetadata!(candidateId);
      return captured.candidate;
    } } : {}),

  };
  const read = await readPromotedCivicData<RegistryRuntimeCarton>(contract.recordClass, contract.scope, {
    store: observedStore,
    now,
    bypassCache: true,
  });
  if (read.kind === "NOT_RECORDED") return null;
  if (read.kind !== "PROMOTED") {
    const code = read.kind === "STORE_UNREACHABLE" ? read.code : "BOOTSTRAP_NOT_PERMITTED";
    throw new Error(`REGISTRY_RUNTIME_BASE_UNAVAILABLE:${code}:${read.detail}`);
  }
  const candidate = captured.candidate;
  if (!candidate) throw new Error("REGISTRY_RUNTIME_BASE_PROOF_INVALID:BASE_CANDIDATE_UNREADABLE");
  const readModelSha256 = candidate.candidate.normalization.normalizedHash!;
  const prior = { versionId: read.projection.versionId, payload: read.value,
    sourceReceipt: registryPublishedReceipt(candidate), readModelSha256 };
  priorStores.set(prior, { store, normalization: candidate.candidate.normalization });
  return prior;
}

function registryPublishedReceipt(row: Pick<PublishedCandidateMetadata, "candidate" | "receipt">): ManualSourceSetReceipt | undefined {
  const sourceReceipt = row.candidate.retrieval.manualSourceReceipt;
  if (!sourceReceipt && row.receipt?.checks.some(check => check.check === "SOURCE_AUTHENTICITY" && ["TRUSTED_LKG_IMPORT_PROVENANCE_VALID", "STATE_RETIREMENT_INHERITED_GOOD_PROVENANCE_VALID"].includes(check.code)))
    return undefined;
  const issue = manualSourceReceiptStructureIssue(sourceReceipt);
  if (!sourceReceipt || issue || sourceReceipt.sources.some(source => source.reviewOutcome === "BLOCKED"))
    throw new Error(`REGISTRY_RUNTIME_BASE_PROOF_INVALID:${issue?.code ?? "SOURCE_RECEIPT_NOT_GOOD"}`);
  return sourceReceipt;
}

const priorStores = new WeakMap<RegistryRuntimePrior, { store: CivicDataReadStore; normalization: PublishedCandidateMetadata["candidate"]["normalization"] }>();

export async function acceptedRegistryPrior(store: CivicDataReadStore, published: PromotionOutcome): Promise<RegistryRuntimePrior> {
  if (!published.promoted) throw new Error("REGISTRY_PUBLICATION_NOT_ACCEPTED");
  const candidate = published.candidate.candidate;
  const payload = immutableStateValue(published.confirmed?.recheck.readModel ?? candidate.readModel);
  immutableStateHash(payload);
  const prior = { versionId: published.promoted.versionId, payload: payload as RegistryRuntimeCarton,
    sourceReceipt: registryPublishedReceipt(published.candidate), readModelSha256: candidate.normalization.normalizedHash! };
  priorStores.set(prior, { store, normalization: candidate.normalization });
  return prior;
}

export function registryRuntimeCandidate(input: RegistryRuntimePackage, options: RegistryRuntimeCandidateOptions = {}): ManualSuccessorCandidate {
  const context = registryMemberContext();
  for (const [path, rows] of registryRows(input.payload)) for (const row of rows) observeRegistryRow(context, path, row);
  const assembly = new RegistryCandidateAssembly(input, options.prior ?? null, context);
  const groups = new Map<string, SourceScopedMember<RegistryIsolationRecord>[]>();
  for (const member of registryIsolationMembers(input.payload, input.sourceReceipt)) {
    const group = groups.get(member.key) ?? [];
    group.push(member); groups.set(member.key, group);
  }
  for (const [key, group] of groups) { assembly.add(group); groups.delete(key); }
  return assembly.finish();
}

export async function registryRuntimeCandidateFromFile(file: string, store: CivicDataReadStore, state: string): Promise<{
  candidate: ManualSuccessorCandidate; priorVersionId: string | null; reviewedAt: string;
}> {
  const contractId = stateRegistryRuntimeContractId(state), context = registryMemberContext();
  const counts = new Map<string, number>(), photos = new Set<string>();
  const keyFor = (path: string, value: unknown): string => {
    const row = value as Record<string, unknown>, holder = row.holder as { id: string } | undefined;
    return path === "registry.divisions" ? `division:${row.ocdId}` : path === "registry.bodies" ? `body:${row.id}`
      : path === "bodyRosters" ? `body-roster:${row.bodyId}` : path === "rosterReaderDispositions" ? `roster-disposition:${row.sourceId}`
      : path === "statewideExecutives" ? `statewide-executive:${holder?.id}` : path === "officialCandidacies.rows" ? `official-candidacy:${holder?.id}`
      : `official-photo:${row.officeholderId}`;
  };
  return withJsonArraySpool(file, {
    streamArray: path => path[0] === "payload" && registryArrayPaths.some(name => name === path.slice(1).join(".")),
    onRow(path, row) {
      const name = path.slice(1).join("."), key = keyFor(name, row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      observeRegistryRow(context, name, row);
      if (name === "officialPhotos.photos") photos.add((row as OfficialPhotoManifestRow).officeholderId);
    },
  }, async (header, rows) => {
    const input = header as RegistryRuntimePackage;
    if (input.contractId !== contractId) throw new Error(`Wrong registry contract: ${String(input.contractId)}.`);
    let prior = await readRegistryRuntimePrior(store, input.sourceReceipt.reviewedAt, state);
    const priorVersionId = prior?.versionId ?? null, assembly = new RegistryCandidateAssembly(input, prior, context);
    prior = null;
    assembly.add([registryMetadataMember(input.payload, input.sourceReceipt)]);
    const duplicates = new Map<string, SourceScopedMember<RegistryIsolationRecord>[]>();
    for await (const [path, row] of rows) {
      const name = path.slice(1).join("."), key = keyFor(name, row), count = counts.get(key)!;
      if (name === "officialPhotos.photos" && count > 1) { counts.set(key, count - 1); continue; }
      const member = registryRowMember(name, row, context, input.payload, input.sourceReceipt);
      if (count === 1) assembly.add([member]);
      else {
        const group = duplicates.get(key) ?? [];
        group.push(member);
        if (group.length === count) { assembly.add(group); duplicates.delete(key); }
        else duplicates.set(key, group);
      }
    }
    for (const [id, rosterPhoto] of Object.entries(input.payload.rosterPhotos)) if (!photos.has(id))
      assembly.add([{ key: `official-photo:${id}`, record: { kind: "OFFICIAL_PHOTO", value: { photo: null, rosterPhoto } } }]);
    counts.clear(); photos.clear();
    context.divisionSources.clear(); context.executiveSources.clear(); context.rosterSources.clear();
    context.placeholderDivisions.clear(); context.translatedDivisions.clear();
    return { candidate: assembly.finish(), priorVersionId, reviewedAt: input.sourceReceipt.reviewedAt };
  });
}

function registryCandidateFromIsolation(input: RegistryRuntimePackage, isolated: RegistryIsolationResult, prior: RegistryPriorProof | null): ManualSuccessorCandidate {
  const state = stateFromRegistryRuntimeContractId(input.contractId)!;
  const contract = requiredManualProductionContract(input.contractId);
  const payload = isolated.payload;
  const promotionReceipt = isolated.sourceReceipt;
  const issues = registryRuntimeProjectionIssues(payload);
  const receipted = new Set(promotionReceipt.sources.flatMap((source) => [source.requestedUrl, source.finalUrl]));
  // A member carried on its base's authority cites nothing this review must cover; every other member's sources must be receipted.
  const inherited = inheritedRegistryMembers(payload, prior, receipted);
  const unreceipted = new Set<string>();
  for (const { key, record } of civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload)) {
    const urls = registryMemberCitedUrls(key, record);
    if (inherited.has(key)) continue;
    for (const url of urls) if (!receipted.has(url)) unreceipted.add(url);
  }
  for (const url of [...unreceipted].sort()) issues.push(`RUNTIME_SOURCE_NOT_RECEIPTED:${url}`);
  const removalEvidence = [...isolated.removalEvidence]
    .sort((left, right) => left.key.localeCompare(right.key));
  if (!isolated.hasProjectionMetadata) {
    issues.push("REGISTRY_PROJECTION_METADATA_UNSUPPORTED");
  }
  if (!prior && isolated.supportedCurrentSources > 0 && isolated.acceptedCurrentFactMembers === 0) {
    issues.push("REGISTRY_CURRENT_REVIEW_HAS_NO_VALID_SOURCE_SCOPED_FACT");
  }
  const sources = [...input.sourceReceipt.sources].sort((left, right) => `${left.finalUrl}\n${left.rawHash}`.localeCompare(`${right.finalUrl}\n${right.rawHash}`));
  const rawHash = sha256(sources.map((source) =>
    `${source.requestedUrl}\n${source.finalUrl}\n${source.httpStatus}\n${source.rawHash}\n${source.reviewOutcome ?? "SUPPORTED"}\n${source.failureDetail ?? ""}`
  ).join("\n"));
  const normalizedPayload = { version: input.version, sources: sources.map(({ finalUrl, rawHash }) => ({ finalUrl, rawHash })) };
  const normalizedHash = canonicalCivicDataHash(payload);
  const normalizedPayloadHash = canonicalCivicDataHash(normalizedPayload);
  const primary = sources.find((source) => (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED");
  const blockedSources = input.sourceReceipt.sources.filter((source) => source.reviewOutcome === "BLOCKED");
  const acquired = isolated.supportedCurrentSources > 0 && Boolean(primary);
  const records = civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload);
  return {
    id: `cv-${sha256(`${contract.sourceId}\u001f${contract.scope}\u001f${rawHash}\u001f${normalizedHash}\u001f${input.version}\u001f${input.sourceReceipt.reviewedAt}`).slice(0, 32)}`,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    retrieval: {
      succeeded: acquired,
      requestedUrl: primary?.requestedUrl ?? "",
      finalUrl: primary?.finalUrl ?? null,
      httpStatus: primary?.httpStatus ?? null,
      retrievedAt: input.sourceReceipt.reviewedAt,
      rawHash: acquired ? rawHash : null,
      failureDetail: acquired
        ? undefined
        : blockedSources.length > 0
          ? `Every current registry source was blocked: ${blockedSources.map((source) => `${source.requestedUrl} (${source.failureDetail})`).join("; ")}`
          : "The reviewed registry source set is empty.",
      manualSourceReceipt: promotionReceipt,
    },
    normalization: {
      succeeded: true,
      parserVersion: REGISTRY_RUNTIME_PARSER_VERSION,
      schemaVersion: `registry-runtime:${input.version}`,
      normalizedHash,
      normalizedPayloadHash,
      inputRecords: records.length + isolated.rejectedCurrentMembers,
      outputRecords: records.length,
      droppedRecords: isolated.rejectedCurrentMembers,
      missingRequiredFields: [],
    },
    identities: [
      ...payload.registry.divisions.map(row => ({ subjectId: row.ocdId, jurisdiction: `US-${state}`,
        identifiers: { division_ocd_id: row.ocdId }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
      ...payload.registry.bodies.map((body) => ({
        subjectId: body.id,
        jurisdiction: `US-${state}`,
        identifiers: { body_id: body.id, ...(body.ocdId ? { division_ocd_id: body.ocdId } : {}) },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
      })),
      ...payload.statewideExecutives.map((row) => ({
        subjectId: row.holder.id,
        jurisdiction: `US-${state}`,
        identifiers: { officeholder_id: row.holder.id, division_ocd_id: row.stateOcdId },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
        office: row.holder.officeTitle,
      })),
      ...payload.officialCandidacies.rows.map((row) => ({
        subjectId: row.holder.id,
        jurisdiction: `US-${state}`,
        identifiers: { officeholder_id: row.holder.id, ...(row.candidacy ? { candidacy_id: row.candidacy.candidacyId } : {}) },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
        office: row.holder.officeTitle,
      })),
    ],
    temporal: {
      version: input.version,
      expectedVersion: input.version,
      sourceThrough: input.sourceThrough,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "reviewed runtime body/division, statewide officeholder and licensed portrait bindings", violations: issues },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "exact body, division, and portrait bindings represented by the owner-reviewed source package",
      returnedRecords: records.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(contract.sourceId, contract.recordClass, contract.scope),
    dependentChecks: [
      { consumer: "registry/representation/map/ballot", passed: !issues.some(issue => issue.startsWith("DIVISION_") || issue.startsWith("BODY_")), detail: `${payload.registry.divisions.length} divisions and ${payload.registry.bodies.length} bodies.` },
      { consumer: "person identity readers", passed: !issues.some((issue) => issue.startsWith("OFFICIAL_CANDIDACY_")), detail: `${payload.officialCandidacies.rows.length} exact officeholder/candidacy outcomes.` },
      { consumer: "statewide officeholder readers", passed: !issues.some((issue) => issue.startsWith("STATEWIDE_EXECUTIVE_")), detail: `${payload.statewideExecutives.length} sourced statewide officeholder bindings.` },
      { consumer: "Ask body identity", passed: !issues.includes("BODY_ID_INVALID_OR_DUPLICATED"), detail: "Every body has one exact runtime identity." },
      { consumer: "licensed portrait readers", passed: !issues.includes("ROSTER_PHOTO_NOT_LICENSED_IN_MANIFEST"), detail: "Every client roster portrait resolves to a licensed manifest row." },
    ],
    normalizedPayload,
    readModel: payload,
    civicRecords: records,
    excludedFacts: [...isolated.excludedFacts, ...(input.excludedFacts ?? [])],
    ...(removalEvidence.length > 0 ? { removalEvidence } : {}),
    ...(prior && inherited.size > 0
      ? {
        manualPriorAuthority: {
          kind: "VALIDATED_PRIOR_PROJECTION" as const,
          versionId: prior.versionId,
          readModelSha256: prior.readModelSha256,
          retainedMembers: [...inherited].map(([key, digest]) => ({ key, sha256: digest })),
        },
      }
      : {}),
  };
}

function duplicate(values: readonly string[]): boolean {
  const seen = new Set<string>();
  return values.some((value) => !value || seen.has(value) || !seen.add(value));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}


export function registryRuntimeProjectionIssues(value: RegistryRuntimeCarton): string[] {
  const issues: string[] = [];
  const divisions = value.registry?.divisions ?? [];
  const bodies = value.registry?.bodies ?? [];
  const statewideExecutives = value.statewideExecutives ?? [];
  const rosters = value.bodyRosters ?? [], dispositions = value.rosterReaderDispositions ?? [];
  const officialCandidacies = value.officialCandidacies;
  const photos = value.officialPhotos?.photos ?? [];
  const divisionIds = new Set(divisions.map((division) => division.ocdId));
  if (value.formatVersion !== 1) issues.push("FORMAT_VERSION_UNSUPPORTED");
  if (duplicate(divisions.map((division) => division.ocdId))) issues.push("DIVISION_ID_INVALID_OR_DUPLICATED");
  if (duplicate(bodies.map((body) => body.id))) issues.push("BODY_ID_INVALID_OR_DUPLICATED");
  if (bodies.some((body) => body.ocdId !== null && !divisionIds.has(body.ocdId) && !(body.alsoServesOcdIds ?? []).some(id => divisionIds.has(id)))) issues.push("BODY_DIVISION_UNRESOLVED");
  // A Census "no district here" placeholder is geography, never a government: no body may sit on one.
  const placeholderDivisionIds = new Set(divisions.filter((division) => isCensusPlaceholderDivision(division)).map((division) => division.ocdId));
  const placeholderBodies = bodies.filter((body) => body.ocdId !== null && placeholderDivisionIds.has(body.ocdId)).map((body) => body.id).sort();
  if (placeholderBodies.length > 0) issues.push(`${CENSUS_PLACEHOLDER_BODY_ISSUE}:${placeholderBodies.join(",")}`);
  if (duplicate(rosters.map(roster => roster.bodyId))) issues.push("BODY_ROSTER_ID_INVALID_OR_DUPLICATED");
  if (rosters.some(roster => !roster.sourceUrl || !roster.sourceOrg || !roster.collectedAt ||
      roster.members.some(member => !member.id || !member.name || !member.officeTitle) || duplicate(roster.members.map(member => member.id))))
    issues.push("BODY_ROSTER_REQUIRED_FACT_MISSING");
  if (duplicate(dispositions.map(row => row.sourceId))) issues.push("ROSTER_DISPOSITION_ID_INVALID_OR_DUPLICATED");
  if (dispositions.some(row => !row.reason || !["READER_ELIGIBLE", "EXACT_DUPLICATE", "IDENTITY_UNRESOLVED"].includes(row.state)))
    issues.push("ROSTER_DISPOSITION_INVALID");
  const executiveIds = statewideExecutives.map((row) => row.holder.id);
  if (duplicate(executiveIds)) issues.push("STATEWIDE_EXECUTIVE_ID_INVALID_OR_DUPLICATED");
  if (statewideExecutives.some((row) => !row.stateOcdId || !row.sourceUrl || !row.sourceOrg || !row.collectedAt || !row.holder.name || !row.holder.officeTitle)) {
    issues.push("STATEWIDE_EXECUTIVE_REQUIRED_FACT_MISSING");
  }
  if (statewideExecutives.some((row) => row.holder.partyLabel && !row.partySourceUrl)) issues.push("STATEWIDE_EXECUTIVE_PARTY_SOURCE_MISSING");
  const bridgeRows = officialCandidacies?.rows ?? [];
  const reservedOfficialStateRosterIds = [
    ...executiveIds,
    ...bridgeRows.filter(row => row.holder.authority !== "STATE_PEOPLE").map((row) => row.holder.id),
  ].filter((id) => officialStateVoteScopeForOfficeholderId(id) !== null);
  if (reservedOfficialStateRosterIds.length > 0) {
    issues.push(`OFFICIAL_STATE_LEGISLATOR_SUBJECT_AUTHORITY_OVERLAP:${[...new Set(reservedOfficialStateRosterIds)].sort().join(",")}`);
  }
  const bridgeHolderIds = new Set(bridgeRows.map((row) => row.holder.id));
  const statewideHolderById = new Map(statewideExecutives.map((row) => [row.holder.id, row] as const));
  if (officialCandidacies?.formatVersion !== 1 || officialCandidacies?.rule !== "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE") issues.push("OFFICIAL_CANDIDACY_BRIDGE_FORMAT_INVALID");
  if (duplicate(bridgeRows.map((row) => row.holder.id))) issues.push("OFFICIAL_CANDIDACY_HOLDER_ID_INVALID_OR_DUPLICATED");
  if (bridgeRows.some((row) => !row.holder.name || !row.holder.officeTitle || !row.holder.sourceUrl || !row.reason)) issues.push("OFFICIAL_CANDIDACY_REQUIRED_FACT_MISSING");
  if (bridgeRows.some(row => row.ballotSourceUrls !== undefined && (!Array.isArray(row.ballotSourceUrls) ||
    row.ballotSourceUrls.some(url => typeof url !== "string" || !/^https:\/\//.test(url))))) issues.push("OFFICIAL_CANDIDACY_BALLOT_SOURCE_INVALID");
  if (bridgeRows.some((row) => row.status === "RESOLVED" && !row.holder.divisions.length)) issues.push("OFFICIAL_CANDIDACY_RESOLVED_DIVISION_MISSING");
  if (bridgeRows.some((row) => row.status === "RESOLVED"
    ? !row.candidacy?.candidacyId || !row.candidacy.contestId || !row.candidacy.divisionId || !row.candidacy.sourceUrl
    : row.candidacy !== null)) issues.push("OFFICIAL_CANDIDACY_STATUS_PAYLOAD_INVALID");
  if (bridgeRows.some((row) => !["RESOLVED", "NO_APPLICABLE_CANDIDACY", "IDENTITY_UNRESOLVED", "NOT_CHECKED"].includes(row.status))) issues.push("OFFICIAL_CANDIDACY_STATUS_INVALID");
  if (duplicate(bridgeRows.filter((row) => row.status === "RESOLVED").map((row) => row.candidacy?.candidacyId ?? ""))) issues.push("OFFICIAL_CANDIDACY_ID_INVALID_OR_DUPLICATED");
  if (bridgeRows.some((row) => row.status === "IDENTITY_UNRESOLVED" ? !row.unresolvedCandidacyIds.length : row.unresolvedCandidacyIds.length > 0)) issues.push("OFFICIAL_CANDIDACY_UNRESOLVED_SET_INVALID");
  const executiveIdSet = new Set(executiveIds);
  if (bridgeRows.some((row) => row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE" && !executiveIdSet.has(row.holder.id))) issues.push("OFFICIAL_CANDIDACY_STATEWIDE_HOLDER_UNRESOLVED");
  if (executiveIds.some((id) => !bridgeHolderIds.has(id))) issues.push("OFFICIAL_CANDIDACY_STATEWIDE_HOLDER_MISSING");
  if (bridgeRows.some((row) => {
    if (row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE") {
      const current = statewideHolderById.get(row.holder.id);
      return Boolean(current) && (row.holder.name !== current!.holder.name || row.holder.officeTitle !== current!.holder.officeTitle || !sameStrings(row.holder.divisions, [current!.stateOcdId]));
    }
    return false;
  })) issues.push("OFFICIAL_CANDIDACY_HOLDER_FACT_MISMATCH");
  if (duplicate(photos.map((photo) => photo.officeholderId))) issues.push("OFFICIAL_PHOTO_ID_INVALID_OR_DUPLICATED");
  if (photos.some((photo) => !photo.name || !photo.url)) issues.push("OFFICIAL_PHOTO_REQUIRED_FACT_MISSING");
  const shippablePhotoUrls = new Set(photos.filter((photo) => photo.license || portraitBindingMatches(photo.personId ?? photo.officeholderId, photo)).map((photo) => photo.url));
  if (Object.values(value.rosterPhotos ?? {}).some((url) => !shippablePhotoUrls.has(url))) issues.push("ROSTER_PHOTO_NOT_LICENSED_IN_MANIFEST");
  return issues;
}

const text = (value: unknown): value is string => typeof value === "string";
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function registryMemberCitedUrls(key: string, record: unknown): string[] {
  const member = row(record);
  const kind = key.slice(0, key.indexOf(":"));
  const cited: unknown[] =
    kind === "division" || kind === "body" ? [row(member.provenance).sourceUrl]
      : kind === "body-roster" ? [member.sourceUrl, member.partisanshipSourceUrl, ...rows(member.members).flatMap(value => {
        const person = row(value);
        return [person.partySourceUrl, row(person.membershipSource).sourceUrl, ...Object.values(row(person.fieldSources)).map(source => row(source).sourceUrl)];
      })]
      : kind === "statewide-executive" ? [member.sourceUrl, member.partySourceUrl]
      : kind === "official-candidacy" ? [row(member.candidacy).sourceUrl, ...rows(member.ballotSourceUrls)]
      : kind === "official-photo" ? [member.sourceUrl]
      : [];
  return [...new Set(cited.filter((url): url is string => text(url) && /^https:\/\//.test(url)))].sort();
}
