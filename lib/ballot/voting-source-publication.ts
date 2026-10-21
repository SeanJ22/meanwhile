import { requireBallotState } from "../civic-data/state-scopes.ts";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { recordDoorOutcome } from "../doors/outcome.ts";
import { pageAddress, pageDoorId, checkEveryFor } from "../doors/page-doors.ts";
import { upsertDerivedDoor, type DoorRepository } from "../doors/registry.ts";
import type { VotingRawCapture } from "./voting-sites-data-plane.ts";
import { mergeVotingSiteRows, type VotingJurisdiction, type VotingSitesFile, type VotingSource, type VotingSite } from "./voting-sites.ts";
import { isVotingSiteKind, type VotingSourceDoor, type VotingSourceRead } from "./voting-source-types.ts";
import { assertVotingEvidenceCanPublish } from "./voting-source-evidence.ts";

export const VOTING_SOURCE_DOOR_KIND = "official-voting-source";

export async function saveVotingSourceDoor(repo: DoorRepository, door: VotingSourceDoor, now: string): Promise<void> {
  const address = pageAddress(door.url);
  if (!address) throw new Error("Voting source has no public URL");
  const heldPages = await repo.listWhere(["config", "url"], address.url);
  const matches = heldPages.filter(row => row.value.kind === VOTING_SOURCE_DOOR_KIND &&
    pageAddress((JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor).url)?.url === address.url);
  const prior = matches.find(row => row.value.status !== "SUSPENDED") ?? matches[0] ?? heldPages.find(row => row.value.status !== "SUSPENDED");
  const mappings = [...new Map([...matches.flatMap(row => [JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor,
    ...JSON.parse(String(row.value.config.votingMappings ?? "[]")) as VotingSourceDoor[]]), door].map(source => [source.id, source])).values()];
  const primary = mappings[0]!;
  const holds = mappings.flatMap(source => source.covers.map(kind => isVotingSiteKind(kind) ? "voting-sites" :
    kind === "CANDIDATE_LIST" ? "ballot-contests" : "ballot-measures"));
  await upsertDerivedDoor(repo, {
    doorId: prior?.id ?? pageDoorId(address), kind: VOTING_SOURCE_DOOR_KIND, ocdId: primary.scope.ocdId,
    hosts: [...new Set([address.host, ...mappings.flatMap(source => source.extraction?.dataUrl ? [new URL(source.extraction.dataUrl, source.url).hostname] : [])])],
    config: { ...prior?.value.config, ...Object.fromEntries(mappings.map(source => [`votingState_${requireBallotState(source.scope.state)}`, true])), url: address.url, votingSource: JSON.stringify(primary), votingMappings: JSON.stringify(mappings.slice(1)) }, holds: [...new Set([...(prior?.value.holds ?? []), ...holds])],
    checkEveryMinutes: checkEveryFor("VOTING_SITE"), notes: `${primary.publisher}: ${primary.shape}; ${primary.electionDate}`,
  }, now, now);
  for (const duplicate of matches.filter(row => row.id !== prior?.id && row.value.status !== "SUSPENDED")) {
    await repo.compareAndSet(duplicate.id, duplicate.revision, { ...duplicate.value, status: "SUSPENDED", readNow: false,
      notes: `Publishing source is read through ${prior!.id}`, updatedAt: now }, now);
  }
}

export async function registeredVotingSourceDoors(repo: DoorRepository, state: string): Promise<VotingSourceDoor[]> {
  return (await repo.listWhere(["config", `votingState_${requireBallotState(state)}`], "true")).map(row => row.value).filter(row => row.kind === VOTING_SOURCE_DOOR_KIND && row.status !== "SUSPENDED").flatMap(row => {
    const sources = [JSON.parse(String(row.config.votingSource)) as VotingSourceDoor,
      ...JSON.parse(String(row.config.votingMappings ?? "[]")) as VotingSourceDoor[]];
    for (const source of sources) if (!source.scope?.ocdId || !source.url || !source.publisher) throw new Error(`Unreadable voting source door ${row.doorId}`);
    return sources.filter(source => source.scope.state === requireBallotState(state));
  });
}

const unique = <T>(rows: readonly T[], key: (row: T) => string): T[] => [...new Map(rows.map(row => [key(row), row])).values()];
const sourceKey = (source: VotingSource) => source.url;
const complete = (read: VotingSourceRead) => !read.blanks.some(blank => ["access", "extraction", "missing-sites"].includes(blank.reason));
const identityText = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function numberedStreet(address: string): string | null {
  const street = address.split(",")[0]!.trim().toLowerCase().replace(/\./g, "");
  if (!/^\d+[a-z]?\s/.test(street)) return null;
  const suffixes: Record<string, string> = { rd: "road", st: "street", ave: "avenue", blvd: "boulevard", dr: "drive", ln: "lane", ct: "court", hwy: "highway", pkwy: "parkway", pl: "place" };
  return identityText(street.replace(/\b(rd|st|ave|blvd|dr|ln|ct|hwy|pkwy|pl)$/, value => suffixes[value]!));
}

/** A publisher's spelling change must not turn one unambiguous existing facility into a deletion. */
function retainVotingSourceSiteIds(prior: VotingJurisdiction, door: VotingSourceDoor, read: VotingSourceRead): VotingSite[] {
  if (prior.ocdId !== door.scope.ocdId) return read.sites;
  const urls = new Set([door.url, ...read.sources.map(sourceKey)]);
  const byId = new Map(prior.sites.map(site => [site.id, site]));
  const same = (old: VotingSite, next: VotingSite) => {
    const street = numberedStreet(next.address);
    const town = old.town ?? (door.matchingUnit === "TOWN" && /\/(?:place|cousub):[^/]+$/.test(prior.ocdId)
      ? prior.name.replace(/^(?:town|city|township|village|borough) of\s+|\s+(?:town|city|township|village|borough)$/gi, "") : undefined);
    return street !== null && street === numberedStreet(old.address) && identityText(old.name) === identityText(next.name) &&
      identityText(old.room) === identityText(next.room) && identityText(town) === identityText(next.town) &&
      identityText(old.countyFips ?? prior.countyFips ?? (/\/county:[^/]+(?:\/|$)/.test(prior.ocdId) ? door.scope.countyFips : undefined)) === identityText(next.countyFips ?? door.scope.countyFips) &&
      identityText(old.countySubdivisionGeoid ?? prior.countySubdivisionGeoid ?? door.scope.countySubdivisionGeoid) === identityText(next.countySubdivisionGeoid ?? door.scope.countySubdivisionGeoid) &&
      (old.sources?.length ? old.sources.some(source => urls.has(source.url)) : urls.has(prior.sourceUrl));
  };
  const retainPoint = (old: VotingSite, next: VotingSite): VotingSite => next.lat === null && next.lng === null && old.lat !== null && old.lng !== null
    ? { ...next, lat: old.lat, lng: old.lng, geocodeSource: old.geocodeSource } : next;
  return read.sites.map(site => {
    const exact = byId.get(site.id);
    if (exact) return identityText(exact.address) === identityText(site.address) || same(exact, site) ? retainPoint(exact, site) : site;
    const matches = prior.sites.filter(old => same(old, site));
    if (matches.length !== 1 || read.sites.filter(next => same(matches[0]!, next)).length !== 1) return site;
    return retainPoint(matches[0]!, { ...site, id: matches[0]!.id });
  });
}

/** All configured sections of one document form one replacement of its earlier facts. */
export function combineVotingSourceReads(reads: readonly VotingSourceRead[]): VotingSourceRead {
  if (!reads.length) throw new Error("A voting source group needs at least one read");
  const sites = new Map<string, VotingSite>();
  for (const read of reads) for (const site of read.sites) {
    const prior = sites.get(site.id);
    sites.set(site.id, prior ? mergeVotingSiteRows(prior, site) : site);
  }
  return { ...reads[0]!, sites: [...sites.values()],
    office: reads.find(read => read.office)?.office,
    contacts: reads.flatMap(read => read.contacts ?? []),
    boundaries: reads.some(read => read.boundaries) ? reads.flatMap(read => read.boundaries ?? []) : undefined,
    rules: unique(reads.flatMap(read => read.rules), rule => `${rule.source.url}\n${rule.text}`),
    sources: unique(reads.flatMap(read => read.sources), sourceKey),
    blanks: unique(reads.flatMap(read => read.blanks), blank => blank.id),
    attempts: reads.flatMap(read => read.attempts),
    rawBodies: unique(reads.flatMap(read => read.rawBodies), body => `${body.url}#${createHash("sha256").update(body.bytes).digest("hex")}`),
  };
}

/** Replace a successfully re-read source only. A failed sibling door cannot hide a new fact. */
export function mergeVotingSourceRead(prior: VotingJurisdiction | undefined, door: VotingSourceDoor, read: VotingSourceRead, now: string): VotingJurisdiction {
  if (prior) read = { ...read, sites: retainVotingSourceSiteIds(prior, door, read) };
  const currentUrls = new Set([door.url, ...read.sources.map(sourceKey)]);
  const sourceSucceeded = read.rawBodies.length > 0 && !read.blanks.some(blank => blank.reason === "access" || blank.reason === "extraction");
  const previousSites = (prior?.sites ?? []).flatMap(previous => {
    const site = previous.sources?.length || !prior ? previous : { ...previous,
      sources: [{ publisher: prior.sourceOrg, url: prior.sourceUrl, checkedAt: prior.collectedAt }] };
    const replaces = sourceSucceeded && (read.sites.some(next => next.id === site.id) || complete(read) && read.sites.length > 0);
    if (sourceSucceeded && door.publication?.status === "NO_GENERAL_ELECTION" && site.electionDate === door.electionDate) return [];
    if (!replaces || !site.sources?.some(source => currentUrls.has(source.url))) return [site];
    // A shared facility can retain a different publisher's drop box or early-voting service.
    const sources = site.sources.filter(source => !currentUrls.has(source.url));
    if (!sources.length) return [];
    const schedules = site.schedules?.filter(schedule => !currentUrls.has(schedule.source.url));
    const assignments = site.assignments?.filter(assignment => !currentUrls.has(assignment.source.url));
    const kinds = schedules?.length ? [...new Set(schedules.map(schedule => schedule.kind))] : site.kinds ?? [site.kind];
    const retained: VotingSite = { ...site, sources, schedules, assignments, kinds, kind: kinds[0],
      precincts: assignments?.map(assignment => assignment.precinct), precinct: assignments?.[0]?.precinct,
      serves: assignments?.map(assignment => assignment.precinct).join(", ") || null,
      hours: schedules?.[0]?.hours, days: schedules?.[0]?.days };
    return [retained];
  });
  const locations = new Map<string, typeof read.sites[number]>();
  for (const site of [...previousSites, ...read.sites]) {
    const priorSite = locations.get(site.id);
    locations.set(site.id, priorSite ? mergeVotingSiteRows(priorSite, site) : site);
  }
  const sites = [...locations.values()];
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
    boundaries: sourceSucceeded && (read.boundaries || door.boundaries)
      ? unique([...(prior?.boundaries ?? []).filter(boundary => !currentUrls.has(boundary.source.url)), ...(read.boundaries ?? door.boundaries ?? [])],
        boundary => `${boundary.countyFips ?? ""}:${boundary.ward ?? ""}:${boundary.precinct}`) : prior?.boundaries,
    refusal: sites.length || publication ? null : { wall: "We're working on getting this info", rungs: read.attempts.length ?
      read.attempts.map(attempt => ({ rung: attempt.route === "browser-ua" ? 2 : 1, what: attempt.url, result: attempt.outcome, attemptedAt: now })) :
      [{ rung: 1, what: door.url, result: read.blanks.map(blank => blank.owed).join("; ") || "Official list remains open acquisition work", attemptedAt: now }] },
  };
}

/** Save original bytes with the publication, atomically, in the standing data system. */
export async function holdVotingRawEvidence(read: Pick<VotingSourceRead, "rawBodies">): Promise<VotingRawCapture[]> {
  assertVotingEvidenceCanPublish(read.rawBodies);
  return read.rawBodies.map(body => ({ url: body.url, contentType: body.contentType,
    rawHash: createHash("sha256").update(body.bytes).digest("hex"), byteLength: body.bytes.byteLength,
    savedDocument: { encoding: "gzip-base64", body: gzipSync(body.bytes).toString("base64") } }));
}

export async function recordVotingSourceRead(repo: DoorRepository, door: VotingSourceDoor, read: VotingSourceRead, now: string): Promise<void> {
  const hash = createHash("sha256").update(read.rawBodies.map(body => createHash("sha256").update(body.bytes).digest("hex")).join("\n")).digest("hex");
  const address = pageAddress(door.url)!;
  const old = (await repo.listWhere(["config", "url"], address.url)).find(row => row.value.kind === VOTING_SOURCE_DOOR_KIND && row.value.status !== "SUSPENDED" &&
    pageAddress((JSON.parse(String(row.value.config.votingSource)) as VotingSourceDoor).url)?.url === address.url);
  if (!old) return;
  const doorId = old.id;
  const failures = read.blanks.filter(blank => blank.reason === "access" || blank.reason === "extraction");
  await recordDoorOutcome(repo, doorId, failures.length ? "FAILURE" : "SUCCESS", now,
    Boolean(old?.value.validators?.contentHash && old.value.validators.contentHash !== hash),
    failures.length ? failures.flatMap(blank => blank.tried).join("; ").slice(0, 4000) : undefined);
  const current = await repo.read(doorId);
  if (current && read.rawBodies.length) await repo.compareAndSet(doorId, current.revision, { ...current.value,
    validators: { etag: null, lastModified: read.fileUpdatedAt ?? null, contentHash: hash, checkedAt: now,
      changedAt: old?.value.validators?.contentHash === hash ? old.value.validators.changedAt : now } }, now);
}

export function replaceVotingJurisdiction(file: VotingSitesFile | null, jurisdiction: VotingJurisdiction, now: string): VotingSitesFile {
  return { generatedAt: now.slice(0, 10), jurisdictions: [...(file?.jurisdictions ?? []).filter(row => row.ocdId !== jurisdiction.ocdId), jurisdiction].sort((a, b) => a.ocdId.localeCompare(b.ocdId)) };
}
