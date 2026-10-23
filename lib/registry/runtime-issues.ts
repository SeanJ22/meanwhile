import type {RegistryRuntimeCarton} from "./runtime-data-plane.ts";
import {CENSUS_PLACEHOLDER_BODY_ISSUE,isCensusPlaceholderDivision} from "./census-placeholders.ts";
import {officialStateVoteScopeForOfficeholderId} from "../state-rollcalls/authority.ts";
import {portraitBindingMatches} from "../photos/binding.ts";

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

