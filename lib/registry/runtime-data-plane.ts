import { createHash } from "node:crypto";

import { canonicalCivicDataJson, civicRecordsFor } from "../civic-data/changes.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import {
  reconcileSourceScopedMembers,
  type SourceScopedHeldFact,
  type SourceScopedMember,
} from "../civic-data/manual-source-isolation.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "../civic-data/read-model.ts";
import type { ManualSuccessorCandidate } from "../civic-data/manual-prior-authority.ts";
import { manualSourceReceiptStructureIssue, sourceAuthority } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type ManualSourceReview, type ManualSourceSetReceipt, type RoutineCandidate, type RoutineRemovalEvidence } from "../civic-data/types.ts";
import { registryMemberCitedUrls, inheritedRosterSourceFacts } from "./cited-urls.ts";
import type { Body, Division, Registry } from "./types.ts";
import type { BodyRoster, RosterReaderDisposition } from "./body-rosters.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE, CENSUS_PLACEHOLDER_LABELS, isCensusPlaceholderDivision } from "./census-placeholders.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";
import { officialStateVoteScopeForOfficeholderId } from "../state-rollcalls/authority.ts";
import { portraitBindingMatches } from "../photos/binding.ts";

export const REGISTRY_RUNTIME_SOURCE_ID = "registry-reviewed-bindings" as const;
export const REGISTRY_RUNTIME_SCOPE = "US:reader-registry-runtime-bindings" as const;
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
    readonly authority: "FEDERAL_DIRECTORY" | "REGISTRY_STATEWIDE_EXECUTIVE" | "REGISTRY_BODY_ROSTER";
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
}

export interface OfficialCandidacyBridge {
  readonly formatVersion: 1;
  readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
  readonly rows: readonly OfficialCandidacyBridgeRow[];
}

export interface RegistryRuntimeReadModel {
  readonly formatVersion: 1;
  readonly registry: Registry;
  /** Current body-to-person membership/contact facts; never the tracked seed at runtime. */
  readonly bodyRosters: readonly BodyRoster[];
  /** Exact eligible/duplicate/unresolved source-row identities from the reviewed roster package. */
  readonly rosterReaderDispositions: readonly RosterReaderDisposition[];
  /** Current statewide officeholder/contact/party facts. */
  readonly statewideExecutives: readonly StatewideExecutive[];
  /** Exact current-officeholder to ballot-candidacy bindings; no runtime name matching. */
  readonly officialCandidacies: OfficialCandidacyBridge;
  readonly officialPhotos: { readonly photos: readonly OfficialPhotoManifestRow[] };
  readonly rosterPhotos: Readonly<Record<string, string>>;
}

export interface RegistryRuntimePackage {
  readonly excludedFacts?: readonly SourceScopedHeldFact[];
  readonly contractId: "registry-runtime-bindings";
  readonly version: string;
  readonly sourceThrough: string;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly payload: RegistryRuntimeReadModel;
  /**
   * "MEMBERS": the package speaks only for the members it lists (a publication
   * door: one roster, a directory, a place). A prior member it omits is
   * retained unchanged, not an attempted removal, so it is not recorded as an
   * excluded fact. Omitted, a package speaks for the whole registry.
   */
  readonly scope?: "MEMBERS";
  /** Holders a complete official roster in this package no longer lists; complete rosters record departures. */
  readonly departures?: readonly { readonly bodyId: string; readonly holderId: string; readonly sourceUrl: string; readonly replacementHolderId?: string; readonly officeTitle?: string }[];
}

/** The rows that leave with a departed holder, by change-set key. */
const departureKeys = (holderId: string, executive = false) => [...(executive ? ["statewide-executive"] : []),"roster-disposition", "official-candidacy", "official-photo", "roster-photo"].map(kind => `${kind}:${holderId}`);

/** A departure stands only when this package's roster for the body, from that page, no longer lists the holder. */
function provenDepartures(input: Pick<RegistryRuntimePackage, "departures" | "payload">) {
  return (input.departures ?? []).filter(departure => {
    if (departure.replacementHolderId) return input.payload.statewideExecutives.some(row => row.stateOcdId === departure.bodyId && row.sourceUrl === departure.sourceUrl && row.holder.id === departure.replacementHolderId && row.holder.id !== departure.holderId && row.holder.officeTitle === departure.officeTitle);
    const roster = input.payload.bodyRosters.find(row => row.bodyId === departure.bodyId);
    return roster !== undefined && roster.sourceUrl === departure.sourceUrl && !roster.members.some(member => member.id === departure.holderId);
  });
}

export interface RegistryRuntimePrior {
  readonly versionId: string;
  readonly payload: RegistryRuntimeReadModel;
  /** Empty for the transfer-time trusted import, whose members carry its own authority instead. */
  readonly sourceReceipt: ManualSourceSetReceipt;
  /** The exact GOOD base's read model, bound so inherited members name the version they came from. */
  readonly readModelSha256: string;
}

export interface RegistryRuntimeCandidateOptions {
  readonly prior?: RegistryRuntimePrior | null;
}

type RegistryIsolationRecord =
  | {
      readonly kind: "PROJECTION_METADATA";
      readonly value: {
        readonly formatVersion: RegistryRuntimeReadModel["formatVersion"];
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
  | {
      readonly kind: "BODY_ROSTER";
      readonly value: BodyRoster;
    }
  | {
      readonly kind: "ROSTER_DISPOSITION";
      readonly value: {
        readonly disposition: RosterReaderDisposition;
        readonly evidenceUrls: readonly string[];
      };
    }
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
  readonly payload: RegistryRuntimeReadModel;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly excludedFacts: readonly SourceScopedHeldFact[];
  readonly supportedCurrentSources: number;
  readonly acceptedCurrentMembers: number;
  readonly acceptedCurrentFactMembers: number;
  readonly rejectedCurrentMembers: number;
  readonly hasProjectionMetadata: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function duplicate(values: readonly string[]): boolean {
  const seen = new Set<string>();
  return values.some((value) => !value || seen.has(value) || !seen.add(value));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function httpsUrls(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && /^https:\/\//.test(value)
  ))].sort();
}

function reviewedSourceUrls(sources: readonly ManualSourceReview[]): string[] {
  return httpsUrls(sources.flatMap((source) => [source.requestedUrl, source.finalUrl]));
}

function bodyRosterUrls(roster: BodyRoster): string[] {
  return httpsUrls([
    roster.sourceUrl,
    roster.partisanshipSourceUrl,
    ...roster.members.flatMap((member) => [member.partySourceUrl, member.membershipSource?.sourceUrl,
      ...Object.values(member.retainedFieldSources ?? {}).map(source => source?.sourceUrl)]),
  ]);
}

function statewideExecutiveUrls(row: StatewideExecutive): string[] {
  return httpsUrls([row.sourceUrl, row.partySourceUrl]);
}

function dispositionRoster(
  payload: RegistryRuntimeReadModel,
  disposition: RosterReaderDisposition,
): BodyRoster | null {
  const exact = payload.bodyRosters.filter((roster) => roster.members.some((member) =>
    member.id === disposition.sourceId || member.id === disposition.canonicalId
  ));
  if (exact.length === 1) return exact[0]!;
  const sourcePrefix = disposition.sourceId.split("#")[0];
  const byStableSourcePrefix = payload.bodyRosters.filter((roster) => roster.members.some((member) =>
    member.id.split("#")[0] === sourcePrefix
  ));
  return byStableSourcePrefix.length === 1 ? byStableSourcePrefix[0]! : null;
}

function candidacyEvidenceUrls(
  payload: RegistryRuntimeReadModel,
  row: OfficialCandidacyBridgeRow,
  fallback: readonly string[],
): string[] {
  if (row.status === "NOT_CHECKED") return httpsUrls([row.holder.sourceUrl]);
  if (row.candidacy?.sourceUrl) return httpsUrls([row.candidacy.sourceUrl]);
  if (row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE") {
    const source = payload.statewideExecutives.find((entry) => entry.holder.id === row.holder.id);
    if (source) return statewideExecutiveUrls(source);
  }
  if (row.holder.authority === "REGISTRY_BODY_ROSTER") {
    const source = payload.bodyRosters.find((roster) => roster.members.some((member) => member.id === row.holder.id));
    if (source) return bodyRosterUrls(source);
  }
  // A null federal candidacy is a bounded reconciliation disposition, not a
  // fact one holder URL can prove. Conservatively bind it to the whole exact
  // reviewed package so a partial source outage retains its prior disposition.
  return [...fallback];
}

function registryIsolationMembers(
  payload: RegistryRuntimeReadModel,
  receipt: ManualSourceSetReceipt,
): readonly SourceScopedMember<RegistryIsolationRecord>[] {
  const allEvidenceUrls = reviewedSourceUrls(receipt.sources);
  const divisionById = new Map(payload.registry.divisions.map((division) => [division.ocdId, division]));
  const photos = new Map(payload.officialPhotos.photos.map((photo) => [photo.officeholderId, photo]));
  const photoIds = [...new Set([...photos.keys(), ...Object.keys(payload.rosterPhotos)])].sort();
  return [
    {
      key: "projection:metadata",
      record: {
        kind: "PROJECTION_METADATA",
        value: {
          formatVersion: payload.formatVersion,
          generatedAt: payload.registry.generatedAt,
          candidacyFormatVersion: payload.officialCandidacies.formatVersion,
          candidacyRule: payload.officialCandidacies.rule,
          evidenceUrls: allEvidenceUrls,
        },
      },
    },
    ...payload.registry.divisions.map((division) => ({
      key: `division:${division.ocdId}`,
      record: { kind: "DIVISION" as const, value: division },
    })),
    ...payload.registry.bodies.map((body) => {
      const division = body.ocdId ? divisionById.get(body.ocdId) : null;
      return {
        key: `body:${body.id}`,
        record: {
          kind: "BODY" as const,
          value: {
            row: body,
            evidenceUrls: httpsUrls([body.provenance.sourceUrl, division?.provenance.sourceUrl]),
          },
        },
      };
    }),
    ...payload.bodyRosters.map((roster) => ({
      key: `body-roster:${roster.bodyId}`,
      record: { kind: "BODY_ROSTER" as const, value: roster },
    })),
    ...payload.rosterReaderDispositions.map((disposition) => {
      const owner = dispositionRoster(payload, disposition);
      return {
        key: `roster-disposition:${disposition.sourceId}`,
        record: {
          kind: "ROSTER_DISPOSITION" as const,
          value: {
            disposition,
            evidenceUrls: owner ? [owner.sourceUrl] : allEvidenceUrls,
          },
        },
      };
    }),
    ...payload.statewideExecutives.map((row) => ({
      key: `statewide-executive:${row.holder.id}`,
      record: { kind: "STATEWIDE_EXECUTIVE" as const, value: row },
    })),
    ...payload.officialCandidacies.rows.map((row) => ({
      key: `official-candidacy:${row.holder.id}`,
      record: {
        kind: "OFFICIAL_CANDIDACY" as const,
        value: { row, evidenceUrls: candidacyEvidenceUrls(payload, row, allEvidenceUrls) },
      },
    })),
    ...photoIds.map((officeholderId) => ({
      key: `official-photo:${officeholderId}`,
      record: {
        kind: "OFFICIAL_PHOTO" as const,
        value: {
          photo: photos.get(officeholderId) ?? null,
          rosterPhoto: payload.rosterPhotos[officeholderId] ?? null,
        },
      },
    })),
  ];
}

function registryIsolationUrls(member: SourceScopedMember<RegistryIsolationRecord>): readonly string[] {
  const record = member.record;
  if (record.kind === "PROJECTION_METADATA") return record.value.evidenceUrls;
  if (record.kind === "DIVISION") return httpsUrls([record.value.provenance.sourceUrl]);
  if (record.kind === "BODY") return record.value.evidenceUrls;
  if (record.kind === "BODY_ROSTER") return bodyRosterUrls(record.value);
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
  if (record.kind === "BODY_ROSTER") {
    const roster = record.value;
    return !roster.bodyId || !roster.bodyName || !roster.sourceOrg || !roster.collectedAt ||
        registryIsolationUrls(member).length === 0 || duplicate(roster.members.map((row) => row.id)) ||
        roster.members.some((row) => !row.name || !row.officeTitle || (row.membershipSource &&
          (!/^https:\/\//.test(row.membershipSource.sourceUrl) || !row.membershipSource.sourceOrg || !Number.isFinite(Date.parse(row.membershipSource.collectedAt)))) ||
          Object.entries(row.retainedFieldSources ?? {}).some(([field, source]) => !source || !["termNote", "termStart", "termEnd", "email", "phone", "websiteUrl"].includes(field) ||
            !row[field as "termNote" | "termStart" | "termEnd" | "email" | "phone" | "websiteUrl"] || !/^https:\/\//.test(source.sourceUrl) || !source.sourceOrg || !Number.isFinite(Date.parse(source.collectedAt))))
      ? `${member.key} lacks exact roster identity, provenance, or unique person rows.`
      : null;
  }
  if (record.kind === "ROSTER_DISPOSITION") {
    const row = record.value.disposition;
    return !row.sourceId || !row.reason ||
        !["READER_ELIGIBLE", "EXACT_DUPLICATE", "IDENTITY_UNRESOLVED"].includes(row.state) ||
        (row.state === "IDENTITY_UNRESOLVED" ? row.canonicalId !== null : !row.canonicalId) ||
        registryIsolationUrls(member).length === 0
      ? `${member.key} lacks an exact source-row disposition or source boundary.`
      : null;
  }
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
  input: RegistryRuntimeReadModel,
  prior: RegistryRuntimeReadModel | null,
  members: readonly SourceScopedMember<RegistryIsolationRecord>[],
): RegistryRuntimeReadModel {
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
  const bodyRosters = members.flatMap((member) => member.record.kind === "BODY_ROSTER" ? [member.record.value] : []);
  const rosterDispositions = members.flatMap((member) => member.record.kind === "ROSTER_DISPOSITION" ? [member.record.value.disposition] : []);
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
    bodyRosters: bodyRosters.sort((left, right) => left.bodyId.localeCompare(right.bodyId)),
    rosterReaderDispositions: rosterDispositions.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
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

function sourceScopedRegistryProjection(
  input: RegistryRuntimePackage,
  prior: RegistryRuntimePrior | null,
): RegistryIsolationResult {
  const currentMembers = registryIsolationMembers(input.payload, input.sourceReceipt);
  const priorRosters = new Map(prior?.payload.bodyRosters.map(roster => [roster.bodyId, roster]) ?? []);
  const priorPhotos = new Map(prior?.payload.officialPhotos.photos.map(photo => [photo.officeholderId, photo]) ?? []);
  const reconciled = reconcileSourceScopedMembers({
    current: currentMembers,
    currentReceipt: input.sourceReceipt,
    prior: prior ? {
      members: registryIsolationMembers(prior.payload, prior.sourceReceipt),
      sourceReceipt: prior.sourceReceipt,
    } : null,
    memberIssue: member => {
      const issue = registryIsolationIssue(member);
      if (issue || member.record.kind !== "OFFICIAL_PHOTO") return issue;
      const photo = member.record.value.photo!;
      const published = priorPhotos.get(photo.officeholderId);
      if (published && canonicalCivicDataJson(published) === canonicalCivicDataJson(photo)) return null;
      return portraitBindingMatches(photo.personId ?? photo.officeholderId, photo) ? null : `${member.key} needs its §3 portrait source binding.`;
    },
    sourceUrls: member => {
      const urls = registryIsolationUrls(member);
      if (member.record.kind !== "BODY_ROSTER") return urls;
      const inherited = inheritedRosterSourceFacts(priorRosters.get(member.record.value.bodyId), member.record.value);
      return urls.filter(url => !inherited.has(url));
    },
  });
  const metadataAccepted = input.sourceReceipt.sources.every((source) => (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED") &&
    registryIsolationIssue(currentMembers[0]!) === null;
  // A Census placeholder is never a government. This open family keeps a prior member unless something
  // proves it gone, so the proof is named here: a body on a division whose own Census code is the "no
  // district here" placeholder (LEA 99997) leaves the projection whichever side holds it, and the
  // placeholder's Census name is translated as the committed geometry's is.
  const placeholderDivisionIds = new Set(reconciled.members.flatMap((member) =>
    member.record.kind === "DIVISION" && isCensusPlaceholderDivision(member.record.value) ? [member.record.value.ocdId] : []));
  const removedKeys = new Set(reconciled.members.flatMap((member) =>
    member.record.kind === "BODY" && member.record.value.row.ocdId !== null && placeholderDivisionIds.has(member.record.value.row.ocdId) ? [member.key] : []));
  const departedKeys = new Set(provenDepartures(input).flatMap(departure => departureKeys(departure.holderId,Boolean(departure.replacementHolderId))));
  const members = reconciled.members
    .filter((member) => !removedKeys.has(member.key) && !departedKeys.has(member.key))
    .map((member) => {
      if (member.record.kind !== "DIVISION") return member;
      const plain = CENSUS_PLACEHOLDER_LABELS[member.record.value.label];
      return plain === undefined ? member : { ...member, record: { ...member.record, value: { ...member.record.value, label: plain } } };
    });
  return {
    payload: rebuildRegistryRuntime(input.payload, prior?.payload ?? null, members),
    sourceReceipt: reconciled.promotionReceipt,
    excludedFacts: [
      ...input.sourceReceipt.sources
        .filter((source) => source.reviewOutcome === "BLOCKED")
        .map((source) => ({
          key: `source:${source.requestedUrl}`,
          code: "MANUAL_SOURCE_BLOCKED",
          detail: `${source.requestedUrl} was blocked and could not authorize any current registry member: ${source.failureDetail}.`,
          record: source,
        })),
      ...reconciled.excludedFacts.filter((fact) => !removedKeys.has(fact.key) && !departedKeys.has(fact.key) &&
        !(input.scope === "MEMBERS" && fact.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING")),
      ...reconciled.members.filter((member) => removedKeys.has(member.key)).map((member) => ({
        key: member.key,
        code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT",
        detail: `${member.key} sits on a Census "no district here" placeholder (LEA 99997): geography, never a government, so no body is registered on it.`,
        record: member.record,
      })),
    ],
    supportedCurrentSources: reconciled.supportedCurrentSources,
    acceptedCurrentMembers: reconciled.acceptedCurrentMembers,
    acceptedCurrentFactMembers: reconciled.acceptedCurrentMembers - (metadataAccepted ? 1 : 0),
    rejectedCurrentMembers: reconciled.rejectedCurrentMembers,
    hasProjectionMetadata: reconciled.members.some((member) => member.record.kind === "PROJECTION_METADATA"),
  };
}

export function registryRuntimeProjectionIssues(value: RegistryRuntimeReadModel): string[] {
  const issues: string[] = [];
  const divisions = value.registry?.divisions ?? [];
  const bodies = value.registry?.bodies ?? [];
  const bodyRosters = value.bodyRosters ?? [];
  const rosterReaderDispositions = value.rosterReaderDispositions ?? [];
  const statewideExecutives = value.statewideExecutives ?? [];
  const officialCandidacies = value.officialCandidacies;
  const photos = value.officialPhotos?.photos ?? [];
  const divisionIds = new Set(divisions.map((division) => division.ocdId));
  if (value.formatVersion !== 1) issues.push("FORMAT_VERSION_UNSUPPORTED");
  if (!divisions.length || !bodies.length) issues.push("REGISTRY_EMPTY");
  if (duplicate(divisions.map((division) => division.ocdId))) issues.push("DIVISION_ID_INVALID_OR_DUPLICATED");
  if (duplicate(bodies.map((body) => body.id))) issues.push("BODY_ID_INVALID_OR_DUPLICATED");
  if (bodies.some((body) => body.ocdId !== null && !divisionIds.has(body.ocdId))) issues.push("BODY_DIVISION_UNRESOLVED");
  // A Census "no district here" placeholder is geography, never a government: no body may sit on one.
  const placeholderDivisionIds = new Set(divisions.filter((division) => isCensusPlaceholderDivision(division)).map((division) => division.ocdId));
  const placeholderBodies = bodies.filter((body) => body.ocdId !== null && placeholderDivisionIds.has(body.ocdId)).map((body) => body.id).sort();
  if (placeholderBodies.length > 0) issues.push(`${CENSUS_PLACEHOLDER_BODY_ISSUE}:${placeholderBodies.join(",")}`);
  const bodyIds = new Set(bodies.map((body) => body.id));
  if (!bodyRosters.length) issues.push("BODY_ROSTERS_EMPTY");
  if (duplicate(bodyRosters.map((roster) => roster.bodyId))) issues.push("BODY_ROSTER_ID_INVALID_OR_DUPLICATED");
  if (bodyRosters.some((roster) => !bodyIds.has(roster.bodyId))) issues.push("BODY_ROSTER_BINDING_UNRESOLVED");
  const memberIds = bodyRosters.flatMap((roster) => roster.members.map((member) => member.id));
  if (duplicate(memberIds)) issues.push("BODY_ROSTER_MEMBER_ID_INVALID_OR_DUPLICATED");
  if (bodyRosters.some((roster) => !roster.sourceUrl || !roster.sourceOrg || !roster.collectedAt || roster.members.some((member) => !member.name || !member.officeTitle))) {
    issues.push("BODY_ROSTER_REQUIRED_FACT_MISSING");
  }
  const dispositionIds = rosterReaderDispositions.map((row) => row.sourceId);
  if (!rosterReaderDispositions.length) issues.push("ROSTER_DISPOSITIONS_EMPTY");
  if (duplicate(dispositionIds)) issues.push("ROSTER_DISPOSITION_ID_INVALID_OR_DUPLICATED");
  const eligibleDispositions = rosterReaderDispositions.filter((row) => row.state === "READER_ELIGIBLE");
  // Membership is asked of Sets, not arrays.
  const memberIdSet = new Set(memberIds);
  const eligibleSourceIds = new Set(eligibleDispositions.map((row) => row.sourceId));
  if (eligibleDispositions.some((row) => row.canonicalId !== row.sourceId || !memberIdSet.has(row.sourceId))) issues.push("ROSTER_ELIGIBLE_DISPOSITION_UNRESOLVED");
  if (memberIds.some((id) => !eligibleSourceIds.has(id))) issues.push("ROSTER_MEMBER_DISPOSITION_MISSING");
  if (rosterReaderDispositions.some((row) => row.state === "EXACT_DUPLICATE" && (!row.canonicalId || !memberIdSet.has(row.canonicalId)))) issues.push("ROSTER_DUPLICATE_CANONICAL_ID_UNRESOLVED");
  if (rosterReaderDispositions.some((row) => row.state === "IDENTITY_UNRESOLVED" && row.canonicalId !== null)) issues.push("ROSTER_UNRESOLVED_DISPOSITION_HAS_CANONICAL_ID");
  const executiveIds = statewideExecutives.map((row) => row.holder.id);
  if (!statewideExecutives.length) issues.push("STATEWIDE_EXECUTIVES_EMPTY");
  if (duplicate(executiveIds)) issues.push("STATEWIDE_EXECUTIVE_ID_INVALID_OR_DUPLICATED");
  if (statewideExecutives.some((row) => !row.stateOcdId || !row.sourceUrl || !row.sourceOrg || !row.collectedAt || !row.holder.name || !row.holder.officeTitle)) {
    issues.push("STATEWIDE_EXECUTIVE_REQUIRED_FACT_MISSING");
  }
  if (statewideExecutives.some((row) => row.holder.partyLabel && !row.partySourceUrl)) issues.push("STATEWIDE_EXECUTIVE_PARTY_SOURCE_MISSING");
  const bridgeRows = officialCandidacies?.rows ?? [];
  const reservedOfficialStateRosterIds = [
    ...memberIds,
    ...executiveIds,
    ...rosterReaderDispositions.flatMap((row) => [row.sourceId, row.canonicalId ?? ""]),
    ...bridgeRows.map((row) => row.holder.id),
  ].filter((id) => officialStateVoteScopeForOfficeholderId(id) !== null);
  if (reservedOfficialStateRosterIds.length > 0) {
    issues.push(`OFFICIAL_STATE_LEGISLATOR_SUBJECT_AUTHORITY_OVERLAP:${[...new Set(reservedOfficialStateRosterIds)].sort().join(",")}`);
  }
  const bridgeHolderIds = new Set(bridgeRows.map((row) => row.holder.id));
  const bodyHolderById = new Map(bodyRosters.flatMap((roster) => roster.members.map((holder) => [holder.id, { holder, division: roster.bodyId.split("#")[0] }] as const)));
  const statewideHolderById = new Map(statewideExecutives.map((row) => [row.holder.id, row] as const));
  if (!bridgeRows.length) issues.push("OFFICIAL_CANDIDACY_BRIDGE_EMPTY");
  if (officialCandidacies?.formatVersion !== 1 || officialCandidacies?.rule !== "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE") issues.push("OFFICIAL_CANDIDACY_BRIDGE_FORMAT_INVALID");
  if (duplicate(bridgeRows.map((row) => row.holder.id))) issues.push("OFFICIAL_CANDIDACY_HOLDER_ID_INVALID_OR_DUPLICATED");
  if (bridgeRows.some((row) => !row.holder.name || !row.holder.officeTitle || !row.holder.sourceUrl || !row.reason)) issues.push("OFFICIAL_CANDIDACY_REQUIRED_FACT_MISSING");
  if (bridgeRows.some((row) => row.status === "RESOLVED" && !row.holder.divisions.length)) issues.push("OFFICIAL_CANDIDACY_RESOLVED_DIVISION_MISSING");
  if (bridgeRows.some((row) => row.status === "RESOLVED"
    ? !row.candidacy?.candidacyId || !row.candidacy.contestId || !row.candidacy.divisionId || !row.candidacy.sourceUrl
    : row.candidacy !== null)) issues.push("OFFICIAL_CANDIDACY_STATUS_PAYLOAD_INVALID");
  if (bridgeRows.some((row) => !["RESOLVED", "NO_APPLICABLE_CANDIDACY", "IDENTITY_UNRESOLVED", "NOT_CHECKED"].includes(row.status))) issues.push("OFFICIAL_CANDIDACY_STATUS_INVALID");
  if (duplicate(bridgeRows.filter((row) => row.status === "RESOLVED").map((row) => row.candidacy?.candidacyId ?? ""))) issues.push("OFFICIAL_CANDIDACY_ID_INVALID_OR_DUPLICATED");
  if (bridgeRows.some((row) => row.status === "IDENTITY_UNRESOLVED" ? !row.unresolvedCandidacyIds.length : row.unresolvedCandidacyIds.length > 0)) issues.push("OFFICIAL_CANDIDACY_UNRESOLVED_SET_INVALID");
  const executiveIdSet = new Set(executiveIds);
  if (bridgeRows.some((row) => row.holder.authority === "REGISTRY_BODY_ROSTER" && !memberIdSet.has(row.holder.id))) issues.push("OFFICIAL_CANDIDACY_BODY_HOLDER_UNRESOLVED");
  if (bridgeRows.some((row) => row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE" && !executiveIdSet.has(row.holder.id))) issues.push("OFFICIAL_CANDIDACY_STATEWIDE_HOLDER_UNRESOLVED");
  if (memberIds.some((id) => !bridgeHolderIds.has(id))) issues.push("OFFICIAL_CANDIDACY_BODY_HOLDER_MISSING");
  if (executiveIds.some((id) => !bridgeHolderIds.has(id))) issues.push("OFFICIAL_CANDIDACY_STATEWIDE_HOLDER_MISSING");
  if (bridgeRows.some((row) => {
    if (row.holder.authority === "REGISTRY_BODY_ROSTER") {
      const current = bodyHolderById.get(row.holder.id);
      return Boolean(current) && (row.holder.name !== current!.holder.name || row.holder.officeTitle !== current!.holder.officeTitle || !sameStrings(row.holder.divisions, [current!.division]));
    }
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

/**
 * Every source a projection's members cite, by member (lib/registry/cited-urls.ts).
 * Holder identity on a candidacy is cross-checked against the separately
 * promoted federal/body/statewide authority, so a candidacy receipts only its
 * mutable ballot-side fact rather than claiming the holder publisher.
 */
function citedRuntimeUrlsByMember(value: RegistryRuntimeReadModel): Map<string, string[]> {
  return new Map(civicRecordsFor("REGISTRY_RUNTIME_BINDING", value)
    .map((member) => [member.key, registryMemberCitedUrls(member.key, member.record)] as const)
    .filter(([, urls]) => urls.length > 0));
}

/**
 * The prior members this successor carries on the base's own authority rather than a reviewed source:
 * an exact, unchanged prior member that cites a source this promotion's receipt does not cover. The plane
 * re-proves each one against the exact GOOD base (lib/civic-data/manual-prior-authority.ts).
 */
function inheritedRegistryMembers(
  payload: RegistryRuntimeReadModel,
  prior: RegistryRuntimePrior | null,
  receipted: ReadonlySet<string>,
): Map<string, string> {
  if (!prior) return new Map();
  const before = new Map(civicRecordsFor("REGISTRY_RUNTIME_BINDING", prior.payload)
    .map((member) => [member.key, sha256(canonicalCivicDataJson(member.record))] as const));
  const inherited = new Map<string, string>();
  for (const member of civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload)) {
    const digest = sha256(canonicalCivicDataJson(member.record));
    if (before.get(member.key) !== digest) continue;
    if (registryMemberCitedUrls(member.key, member.record).some((url) => !receipted.has(url))) inherited.set(member.key, digest);
  }
  return inherited;
}

/**
 * The removals this successor proves: a body the prior held on a Census "no
 * district here" placeholder, gone from this projection while the placeholder
 * division stays. A placeholder is not a government, so a body on one is
 * dropped rather than shown to a reader. Named only against the
 * prior, because the promotion counts removals against the pointer it replaces.
 */
function placeholderBodyRemovals(payload: RegistryRuntimeReadModel, prior: RegistryRuntimePrior | null): RoutineRemovalEvidence[] {
  if (!prior) return [];
  const heldDivisions = new Map(payload.registry.divisions.map((division) => [division.ocdId, division]));
  const kept = new Set(payload.registry.bodies.map((body) => body.id));
  return prior.payload.registry.bodies.flatMap((body) => {
    const division = body.ocdId === null ? undefined : heldDivisions.get(body.ocdId);
    return division && isCensusPlaceholderDivision(division) && !kept.has(body.id)
      ? [{ key: `body:${body.id}`, code: "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" as const, divisionOcdId: division.ocdId }]
      : [];
  }).sort((left, right) => left.key.localeCompare(right.key));
}

/** Removal evidence for each row a proven departure took out of the prior projection. */
function departureRemovals(input: RegistryRuntimePackage, payload: RegistryRuntimeReadModel, prior: RegistryRuntimePrior | null): RoutineRemovalEvidence[] {
  if (!prior) return [];
  const present = (model: RegistryRuntimeReadModel) => new Set([
    ...model.statewideExecutives.map(row=>`statewide-executive:${row.holder.id}`),
    ...model.rosterReaderDispositions.map(row => `roster-disposition:${row.sourceId}`),
    ...model.officialCandidacies.rows.map(row => `official-candidacy:${row.holder.id}`),
    ...model.officialPhotos.photos.map(photo => `official-photo:${photo.officeholderId}`),
    ...Object.keys(model.rosterPhotos).map(key => `roster-photo:${key}`),
  ]);
  const before = present(prior.payload), after = present(payload);
  return provenDepartures(input).flatMap(departure => departureKeys(departure.holderId,Boolean(departure.replacementHolderId))
    .filter(key => before.has(key) && !after.has(key))
    .map(key => ({ key, code: "OFFICIAL_ROSTER_NO_LONGER_LISTS" as const, bodyId: departure.bodyId, holderId: departure.holderId, sourceUrl: departure.sourceUrl, ...(departure.replacementHolderId ? {replacementHolderId:departure.replacementHolderId,officeTitle:departure.officeTitle} : {}) })));
}

/**
 * Exact GOOD registry projection used as the member-scoped merge base.
 * Store/readback failures are never treated as an empty registry: doing so
 * would turn a transient control-plane fault into thousands of removals.
 */
export async function readRegistryRuntimePrior(
  store: CivicDataReadStore,
  now: string,
): Promise<RegistryRuntimePrior | null> {
  const contract = requiredManualProductionContract("registry-runtime-bindings");
  const captured = { candidate: null as Awaited<ReturnType<typeof store.readCandidate>> };
  const proofReader = store as CivicDataReadStore & { readonly readCandidateProof?: typeof store.readCandidate };
  const observedStore = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: store.readCandidate.bind(store),
    async readCandidateProof(candidateId: string) {
      captured.candidate = typeof proofReader.readCandidateProof === "function"
        ? await proofReader.readCandidateProof(candidateId)
        : await store.readCandidate(candidateId);
      return captured.candidate;
    },
  };
  const read = await readPromotedCivicData<RegistryRuntimeReadModel>(contract.recordClass, contract.scope, {
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
  return { versionId: read.projection.versionId, payload: read.value, sourceReceipt: registryBaseSourceReceipt(candidate.candidate), readModelSha256 };
}

/**
 * The receipt a GOOD base lends its successor. The trusted-import base carries none; members a package
 * leaves untouched carry forward on that import's authority, recorded per member and re-proved by the
 * plane. Any other base without a GOOD receipt is refused.
 */
export function registryBaseSourceReceipt(base: RoutineCandidate): ManualSourceSetReceipt {
  if (base.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT" && base.retrieval.manualSourceReceipt === undefined) {
    return { contractVersion: 1, reviewedAt: base.retrieval.retrievedAt, reviewedBy: "trusted-lkg-import", sources: [] };
  }
  const sourceReceipt = base.retrieval.manualSourceReceipt;
  const issue = manualSourceReceiptStructureIssue(sourceReceipt);
  if (!sourceReceipt || issue || sourceReceipt.sources.some((source) => source.reviewOutcome === "BLOCKED")) {
    throw new Error(`REGISTRY_RUNTIME_BASE_PROOF_INVALID:${issue?.code ?? "SOURCE_RECEIPT_NOT_GOOD"}`);
  }
  return sourceReceipt;
}

export function registryRuntimeCandidate(
  input: RegistryRuntimePackage,
  options: RegistryRuntimeCandidateOptions = {},
): ManualSuccessorCandidate {
  const contract = requiredManualProductionContract("registry-runtime-bindings");
  const receiptIssue = manualSourceReceiptStructureIssue(input.sourceReceipt);
  if (receiptIssue) {
    throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_MALFORMED:${receiptIssue.code}:${receiptIssue.detail}`);
  }
  const sourceContract = sourceAuthority(contract.sourceId);
  const sourcePolicy = sourceContract?.manualReceiptPromotion;
  if (!sourceContract || !sourceContract.recordClasses.includes(contract.recordClass) || !sourcePolicy) {
    throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_BINDING_INVALID:${contract.sourceId}:${contract.recordClass}`);
  }
  const unauthorizedSource = input.sourceReceipt.sources.find((source) =>
    !sourcePolicy.allowedSourceClasses.includes(source.sourceClass)
  );
  if (unauthorizedSource) {
    throw new Error(`REGISTRY_RUNTIME_SOURCE_RECEIPT_CLASS_NOT_AUTHORIZED:${unauthorizedSource.sourceClass}`);
  }

  // Reference pages corroborate verified portraits; legislative people use their own source authority.
  const currentMembers = registryIsolationMembers(input.payload, input.sourceReceipt);
  for (const source of input.sourceReceipt.sources.filter(source => source.sourceClass === "REFERENCE_PUBLISHER")) {
    const cited = currentMembers.filter(member => member.record.kind !== "PROJECTION_METADATA" &&
      registryIsolationUrls(member).some(url => url === source.requestedUrl || url === source.finalUrl));
    if (!cited.length || cited.some(member => member.record.kind !== "OFFICIAL_PHOTO" || !member.record.value.photo ||
      !portraitBindingMatches(member.record.value.photo.personId ?? member.record.value.photo.officeholderId, member.record.value.photo))) {
      throw new Error("REGISTRY_RUNTIME_REFERENCE_SOURCE_NOT_VERIFIED_PORTRAIT");
    }
  }

  const isolated = sourceScopedRegistryProjection(input, options.prior ?? null);
  const payload = isolated.payload;
  const promotionReceipt = isolated.sourceReceipt;
  const issues = registryRuntimeProjectionIssues(payload);
  const receipted = new Set(promotionReceipt.sources.flatMap((source) => [source.requestedUrl, source.finalUrl]));
  // A member carried on its base's authority cites nothing this review must cover; every other member's sources must be receipted.
  const inherited = inheritedRegistryMembers(payload, options.prior ?? null, receipted);
  const priorRosters = new Map(options.prior?.payload.bodyRosters.map(roster => [roster.bodyId, roster]) ?? []);
  const retainedRosterSources = payload.bodyRosters.flatMap(roster => [...inheritedRosterSourceFacts(priorRosters.get(roster.bodyId), roster)]
    .filter(([url]) => !receipted.has(url)).map(([url, facts]) => ({ key: `body-roster:${roster.bodyId}`, url, sha256: sha256(canonicalCivicDataJson(facts)) }))
    .filter(source => !inherited.has(source.key)));
  const inheritedSourceKeys = new Set(retainedRosterSources.map(source => `${source.key}\n${source.url}`));
  const unreceipted = new Set<string>();
  for (const [key, urls] of citedRuntimeUrlsByMember(payload)) {
    if (inherited.has(key)) continue;
    for (const url of urls) if (!receipted.has(url) && !inheritedSourceKeys.has(`${key}\n${url}`)) unreceipted.add(url);
  }
  for (const url of [...unreceipted].sort()) issues.push(`RUNTIME_SOURCE_NOT_RECEIPTED:${url}`);
  const removalEvidence = [...placeholderBodyRemovals(payload, options.prior ?? null), ...departureRemovals(input, payload, options.prior ?? null)]
    .sort((left, right) => left.key.localeCompare(right.key));
  if (!isolated.hasProjectionMetadata) {
    issues.push("REGISTRY_PROJECTION_METADATA_UNSUPPORTED");
  }
  if (isolated.supportedCurrentSources > 0 && isolated.acceptedCurrentFactMembers === 0) {
    issues.push("REGISTRY_CURRENT_REVIEW_HAS_NO_VALID_SOURCE_SCOPED_FACT");
  }
  const sources = [...input.sourceReceipt.sources].sort((left, right) => `${left.finalUrl}\n${left.rawHash}`.localeCompare(`${right.finalUrl}\n${right.rawHash}`));
  const rawHash = sha256(sources.map((source) =>
    `${source.requestedUrl}\n${source.finalUrl}\n${source.httpStatus}\n${source.rawHash}\n${source.reviewOutcome ?? "SUPPORTED"}\n${source.failureDetail ?? ""}`
  ).join("\n"));
  const normalizedPayload = { version: input.version, sources: sources.map(({ finalUrl, rawHash }) => ({ finalUrl, rawHash })) };
  const normalizedHash = sha256(canonicalCivicDataJson(payload));
  const normalizedPayloadHash = sha256(canonicalCivicDataJson(normalizedPayload));
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
      ...payload.registry.bodies.map((body) => ({
        subjectId: body.id,
        jurisdiction: "US",
        identifiers: { body_id: body.id, ...(body.ocdId ? { division_ocd_id: body.ocdId } : {}) },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
      })),
      ...payload.bodyRosters.flatMap((roster) => roster.members.map((member) => ({
        subjectId: member.id,
        jurisdiction: "US",
        identifiers: { body_id: roster.bodyId, roster_member_id: member.id },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
        office: member.officeTitle,
      }))),
      ...payload.statewideExecutives.map((row) => ({
        subjectId: row.holder.id,
        jurisdiction: "US",
        identifiers: { officeholder_id: row.holder.id, division_ocd_id: row.stateOcdId },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
        office: row.holder.officeTitle,
      })),
      ...payload.officialCandidacies.rows.filter((row) => row.status === "RESOLVED").map((row) => ({
        subjectId: row.holder.id,
        jurisdiction: "US",
        identifiers: { officeholder_id: row.holder.id, candidacy_id: row.candidacy!.candidacyId },
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
    semantics: { factKind: "reviewed runtime body/division, body-person/contact, and licensed portrait bindings", violations: issues },
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
      { consumer: "registry/representation/map/ballot", passed: payload.registry.divisions.length > 0 && payload.registry.bodies.length > 0, detail: `${payload.registry.divisions.length} divisions and ${payload.registry.bodies.length} bodies.` },
      { consumer: "body-person/contact readers", passed: !issues.some((issue) => issue.startsWith("BODY_ROSTER_")), detail: `${payload.bodyRosters.length} sourced body rosters are bound to exact body and member IDs.` },
      { consumer: "person identity readers", passed: !issues.some((issue) => issue.startsWith("ROSTER_") || issue.startsWith("OFFICIAL_CANDIDACY_")), detail: `${payload.rosterReaderDispositions.length} roster identity dispositions and ${payload.officialCandidacies.rows.length} exact officeholder/candidacy outcomes.` },
      { consumer: "statewide officeholder readers", passed: !issues.some((issue) => issue.startsWith("STATEWIDE_EXECUTIVE_")), detail: `${payload.statewideExecutives.length} sourced statewide officeholder bindings.` },
      { consumer: "Ask body identity", passed: !duplicate(payload.registry.bodies.map((body) => body.id)), detail: "Every body has one exact runtime identity." },
      { consumer: "licensed portrait readers", passed: !issues.includes("ROSTER_PHOTO_NOT_LICENSED_IN_MANIFEST"), detail: "Every client roster portrait resolves to a licensed manifest row." },
    ],
    normalizedPayload,
    readModel: payload,
    civicRecords: records,
    excludedFacts: [...isolated.excludedFacts, ...(input.excludedFacts ?? [])],
    ...(removalEvidence.length > 0 ? { removalEvidence } : {}),
    ...(options.prior && (inherited.size > 0 || retainedRosterSources.length > 0)
      ? {
        manualPriorAuthority: {
          kind: "VALIDATED_PRIOR_PROJECTION" as const,
          versionId: options.prior.versionId,
          readModelSha256: options.prior.readModelSha256,
          retainedMembers: [...inherited].map(([key, digest]) => ({ key, sha256: digest })),
          ...(retainedRosterSources.length ? { retainedRosterSources } : {}),
        },
      }
      : {}),
  };
}
