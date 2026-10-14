import { createHash } from "node:crypto";
import { recordDoorOutcome } from "../doors/outcome.ts";
import { pageAddress, pageDoorId, checkEveryFor } from "../doors/page-doors.ts";
import { listDoors, upsertDerivedDoor, type DoorRepository } from "../doors/registry.ts";
import type { VotingJurisdiction, VotingSitesFile, VotingSource } from "./voting-sites.ts";
import type { VotingSourceDoor, VotingSourceRead } from "./voting-source-types.ts";

export const VOTING_SOURCE_DOOR_KIND = "official-voting-source";

export async function saveVotingSourceDoor(repo: DoorRepository, door: VotingSourceDoor, now: string): Promise<void> {
  const address = pageAddress(door.url);
  if (!address) throw new Error("Voting source has no public URL");
  const matches = (await repo.listWhere(["kind"], VOTING_SOURCE_DOOR_KIND)).filter(row => row.value.kind === VOTING_SOURCE_DOOR_KIND &&
    pageAddress((JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor).url)?.url === address.url);
  const heldPages = await repo.listWhere(["config", "url"], address.url);
  const prior = matches.find(row => row.value.status !== "SUSPENDED") ?? matches[0] ?? heldPages.find(row => row.value.status !== "SUSPENDED");
  const mappings = [...new Map([...matches.flatMap(row => [JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor,
    ...JSON.parse(String(row.value.config.votingMappings ?? "[]")) as VotingSourceDoor[]]), door].map(source => [source.id, source])).values()];
  const primary = mappings[0]!;
  await upsertDerivedDoor(repo, {
    doorId: prior?.id ?? pageDoorId(address), kind: VOTING_SOURCE_DOOR_KIND, ocdId: primary.scope.ocdId,
    hosts: [...new Set([address.host, ...mappings.flatMap(source => source.extraction?.dataUrl ? [new URL(source.extraction.dataUrl, source.url).hostname] : [])])],
    config: { ...prior?.value.config, url: address.url, votingSource: JSON.stringify(primary), votingMappings: JSON.stringify(mappings.slice(1)) }, holds: [...new Set([...(prior?.value.holds ?? []), "voting-sites"])],
    checkEveryMinutes: checkEveryFor("VOTING_SITE"), notes: `${primary.publisher}: ${primary.shape}; ${primary.electionDate}`,
  }, now, now);
  for (const duplicate of matches.filter(row => row.id !== prior?.id && row.value.status !== "SUSPENDED")) {
    await repo.compareAndSet(duplicate.id, duplicate.revision, { ...duplicate.value, status: "SUSPENDED", readNow: false,
      notes: `Publishing source is read through ${prior!.id}`, updatedAt: now }, now);
  }
}

export async function registeredVotingSourceDoors(repo: DoorRepository): Promise<VotingSourceDoor[]> {
  return (await listDoors(repo)).doors.filter(row => row.kind === VOTING_SOURCE_DOOR_KIND && row.status !== "SUSPENDED").flatMap(row => {
    const sources = [JSON.parse(String(row.config.votingSource)) as VotingSourceDoor,
      ...JSON.parse(String(row.config.votingMappings ?? "[]")) as VotingSourceDoor[]];
    for (const source of sources) if (!source.scope?.ocdId || !source.url || !source.publisher) throw new Error(`Unreadable voting source door ${row.doorId}`);
    return sources;
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
  const address = pageAddress(door.url)!;
  const old = (await repo.listWhere(["kind"], VOTING_SOURCE_DOOR_KIND)).find(row => row.value.kind === VOTING_SOURCE_DOOR_KIND && row.value.status !== "SUSPENDED" &&
    pageAddress((JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor).url)?.url === address.url);
  if (!old) return;
  const doorId = old.id;
  await recordDoorOutcome(repo, doorId, read.blanks.some(blank => blank.reason === "access") ? "FAILURE" : "SUCCESS", now,
    Boolean(old?.value.validators?.contentHash && old.value.validators.contentHash !== hash));
  const current = await repo.read(doorId);
  if (current && read.rawBodies.length) await repo.compareAndSet(doorId, current.revision, { ...current.value,
    validators: { etag: null, lastModified: read.fileUpdatedAt ?? null, contentHash: hash, checkedAt: now,
      changedAt: old?.value.validators?.contentHash === hash ? old.value.validators.changedAt : now } }, now);
}

export function replaceVotingJurisdiction(file: VotingSitesFile | null, jurisdiction: VotingJurisdiction, now: string): VotingSitesFile {
  return { generatedAt: now.slice(0, 10), jurisdictions: [...(file?.jurisdictions ?? []).filter(row => row.ocdId !== jurisdiction.ocdId), jurisdiction].sort((a, b) => a.ocdId.localeCompare(b.ocdId)) };
}
