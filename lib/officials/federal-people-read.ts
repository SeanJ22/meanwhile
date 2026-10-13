import { createHash } from "node:crypto";
import { readFederalDirectoryProjection } from "./federal-directory-read-model.ts";
import { readOfficialRosterProjection } from "../civic-data/official-roster-read-model.ts";
import { OFFICIAL_FEDERAL_TARGETS } from "../sources/official-rosters/targets.ts";
import { mergeStatePeople } from "../state-rollcalls/legislators.ts";
import { statePeopleVersion } from "./people-version.ts";
import type { OfficeholderSet } from "./types.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";

/** Mirrors supply optional directory facts; the chambers' own current roster supplies the holder or vacancy. */
export async function readFederalPeopleProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<FederalDirectoryReadModel>> {
  const reads = await Promise.allSettled([
    readFederalDirectoryProjection(options),
    ...OFFICIAL_FEDERAL_TARGETS.map(target => readOfficialRosterProjection(target.scope, options)),
  ]);
  const held = reads.flatMap(row => row.status === "fulfilled" && (row.value.kind === "PROMOTED" || row.value.kind === "BOOTSTRAP") ? [row.value] : []);
  const mirror = reads[0];
  if (!held.length) {
    if (mirror.status === "rejected") throw mirror.reason;
    return mirror.value;
  }
  const roster = held.reduce<OfficeholderSet | null>((combined, read) => mergeStatePeople(combined, read.value.roster), null)!;
  const directoryRead = mirror.status === "fulfilled" && (mirror.value.kind === "PROMOTED" || mirror.value.kind === "BOOTSTRAP") ? mirror.value : null;
  // Without a mirror, the directory's version is a fingerprint of the held official versions.
  const sha = directoryRead?.value.sourceSha ?? createHash("sha1").update(JSON.stringify(held.map(read => [read.metadata.scope, read.metadata.versionId]))).digest("hex");
  const heldDirectory = directoryRead?.value.directory ?? {source: {project: "U.S. Congress", repoUrl: OFFICIAL_FEDERAL_TARGETS[0].routes[0], sha, licence: "Public government information", licenceUrl: OFFICIAL_FEDERAL_TARGETS[0].routes[0], sourceOrg: "U.S. Congress", collectedAt: roster.generatedAt}, counts: {}, committees: {}, byMember: {}};
  const value: FederalDirectoryReadModel = { formatVersion: 1, sourceSha: sha, roster,
    currentMembershipComplete: roster.currentMembershipComplete === true,
    directory: {...heldDirectory, byMember: {...heldDirectory.byMember}} };
  for (const person of roster.officeholders) value.directory.byMember[person.id.slice("congress:".length)] ??= {districtOffices: [], committees: []};
  const last = held.at(-1)!;
  const versionId = statePeopleVersion("US", held.map(read => ({scope: read.metadata.scope, versionId: read.metadata.versionId ?? read.kind})));
  const metadata = {...last.metadata, versionId, recordClass: "FEDERAL_DIRECTORY" as const};
  if (last.kind === "PROMOTED") return {...last, value, metadata, projection: {...last.projection, payload: value, versionId}};
  return {...last, value, metadata};
}
