import { createHash } from "node:crypto";
import { recordDoorOutcome } from "../doors/outcome.ts";
import { listDoors, upsertDerivedDoor, type DoorRepository } from "../doors/registry.ts";
import type { VotingJurisdiction, VotingSitesFile, VotingSource } from "./voting-sites.ts";
import type { VotingSourceDoor, VotingSourceRead } from "./voting-source-types.ts";

export const VOTING_SOURCE_DOOR_KIND = "official-voting-source";

/** Doors stay editable in the standing registry. Reference rows seed missing doors only. */
export async function seedVotingSourceDoors(repo: DoorRepository, seeds: readonly VotingSourceDoor[], now: string): Promise<void> {
  for (const door of seeds) if (!await repo.read(door.id)) await saveVotingSourceDoor(repo, door, now);
}

export async function saveVotingSourceDoor(repo: DoorRepository, door: VotingSourceDoor, now: string): Promise<void> {
  await upsertDerivedDoor(repo, {
    doorId: door.id, kind: VOTING_SOURCE_DOOR_KIND, ocdId: door.scope.ocdId,
    hosts: [...new Set([new URL(door.url).hostname, ...(door.extraction?.dataUrl ? [new URL(door.extraction.dataUrl, door.url).hostname] : [])])],
    config: { votingSource: JSON.stringify(door) }, holds: ["voting-sites"],
    checkEveryMinutes: null, notes: `${door.publisher}: ${door.shape}; ${door.electionDate}`,
  }, now, now);
}

export async function registeredVotingSourceDoors(repo: DoorRepository): Promise<VotingSourceDoor[]> {
  return (await listDoors(repo)).doors.filter(row => row.kind === VOTING_SOURCE_DOOR_KIND && row.status !== "SUSPENDED").map(row => {
    const door = JSON.parse(String(row.config.votingSource)) as VotingSourceDoor;
    if (door.id !== row.doorId || !door.scope?.ocdId || !door.url || !door.publisher) throw new Error(`Unreadable voting source door ${row.doorId}`);
    return door;
  });
}

const unique = <T>(rows: readonly T[], key: (row: T) => string): T[] => [...new Map(rows.map(row => [key(row), row])).values()];
const sourceKey = (source: VotingSource) => source.url;
const complete = (read: VotingSourceRead) => !read.blanks.some(blank => ["access", "extraction", "missing-sites"].includes(blank.reason));

/** Replace a successfully re-read source only. A failed sibling door cannot hide a new fact. */
export function mergeVotingSourceRead(prior: VotingJurisdiction | undefined, door: VotingSourceDoor, read: VotingSourceRead, now: string): VotingJurisdiction {
  const currentUrls = new Set([door.url, ...read.sources.map(sourceKey)]);
  const sourceSucceeded = read.rawBodies.length > 0 && !read.blanks.some(blank => blank.reason === "access");
  const readIds = new Set(read.sites.map(site => site.id));
  const previousSites = (prior?.sites ?? []).filter(site => !(sourceSucceeded && door.publication?.status === "NO_GENERAL_ELECTION" && site.electionDate === door.electionDate) && !readIds.has(site.id) &&
    !(complete(read) && read.sites.length > 0 && site.sources?.some(source => currentUrls.has(source.url))));
  const sites = unique([...previousSites, ...read.sites], site => site.id);
  const sources = unique([...(prior?.sources ?? []), ...read.sources], sourceKey);
  const rules = unique([...(prior?.rules ?? []).filter(rule => !sourceSucceeded || !currentUrls.has(rule.source.url)), ...read.rules], rule => `${rule.source.url}\n${rule.text}`);
  const blanks = unique([...(prior?.blanks ?? []).filter(blank => blank.doorId !== door.id), ...read.blanks], blank => blank.id);
  const lookups = unique([...(prior?.addressLookups ?? []), ...(door.shape === "address-lookup" ? [door] : [])], lookup => lookup.id);
  const publication = sourceSucceeded ? door.publication ?? (read.publicationMessage ? {
    status: "POSTED_LATER" as const, text: read.publicationMessage,
    source: read.sources[0] ?? { publisher: door.publisher, url: door.url, checkedAt: now },
  } : prior?.publication) : prior?.publication;
  return {
    ...prior, ocdId: door.scope.ocdId, state: door.scope.state, name: door.scope.name,
    model: sourceSucceeded ? door.model ?? prior?.model ?? "UNKNOWN" : prior?.model ?? "UNKNOWN",
    election: prior?.election ?? null, electionDate: door.electionDate,
    countyFips: door.scope.countyFips ?? prior?.countyFips,
    countySubdivisionGeoid: door.scope.countySubdivisionGeoid ?? prior?.countySubdivisionGeoid,
    matchingUnit: door.matchingUnit ?? prior?.matchingUnit,
    sites, sourceOrg: prior?.sourceOrg ?? door.publisher, sourceUrl: prior?.sourceUrl ?? door.url,
    sourceLinkingPage: prior?.sourceLinkingPage ?? door.officialLinkingPage,
    collectedAt: sourceSucceeded ? now.slice(0, 10) : prior?.collectedAt ?? now.slice(0, 10),
    office: sourceSucceeded ? read.office ?? prior?.office : prior?.office,
    sources, rules, blanks, addressLookups: lookups, publication,
    allMail: (sourceSucceeded && door.model === "ALL_MAIL") || prior?.allMail,
    boundaries: sourceSucceeded ? door.boundaries ?? prior?.boundaries : prior?.boundaries,
    refusal: sites.length || publication ? null : { wall: "We're working on getting this info", rungs: read.attempts.length ?
      read.attempts.map(attempt => ({ rung: attempt.route === "browser-ua" ? 2 : 1, what: attempt.url, result: attempt.outcome, attemptedAt: now })) :
      [{ rung: 1, what: door.url, result: read.blanks.map(blank => blank.owed).join("; ") || "Official list remains open acquisition work", attemptedAt: now }] },
  };
}

/** Source bytes, including binary originals, remain in the normal candidate evidence. */
export function votingRawEvidence(read: Pick<VotingSourceRead, "rawBodies">): string[] {
  return read.rawBodies.map(body => `${body.url}\nContent-Type: ${body.contentType}\nContent-Transfer-Encoding: base64\nsha256 ${createHash("sha256").update(body.bytes).digest("hex")}\n\n${Buffer.from(body.bytes).toString("base64")}`);
}

export async function recordVotingSourceRead(repo: DoorRepository, door: VotingSourceDoor, read: VotingSourceRead, now: string): Promise<void> {
  const hash = createHash("sha256").update(read.rawBodies.map(body => createHash("sha256").update(body.bytes).digest("hex")).join("\n")).digest("hex");
  const old = await repo.read(door.id);
  await recordDoorOutcome(repo, door.id, read.blanks.some(blank => blank.reason === "access") ? "FAILURE" : "SUCCESS", now,
    Boolean(old?.value.validators?.contentHash && old.value.validators.contentHash !== hash));
  const current = await repo.read(door.id);
  if (current && read.rawBodies.length) await repo.compareAndSet(door.id, current.revision, { ...current.value,
    validators: { etag: null, lastModified: read.fileUpdatedAt ?? null, contentHash: hash, checkedAt: now,
      changedAt: old?.value.validators?.contentHash === hash ? old.value.validators.changedAt : now } }, now);
}

export function replaceVotingJurisdiction(file: VotingSitesFile | null, jurisdiction: VotingJurisdiction, now: string): VotingSitesFile {
  return { generatedAt: now.slice(0, 10), jurisdictions: [...(file?.jurisdictions ?? []).filter(row => row.ocdId !== jurisdiction.ocdId), jurisdiction].sort((a, b) => a.ocdId.localeCompare(b.ocdId)) };
}
