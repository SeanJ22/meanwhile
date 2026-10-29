import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { pageAddress } from "../doors/page-doors.ts";
import type { VotingSourceDoor, VotingSourceRead } from "./voting-source-types.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

/** Sections of one publisher's document are acquired and replaced together. */
export function votingSourceHashKey(door: VotingSourceDoor): string {
  return `${door.scope.ocdId}|${pageAddress(door.url)?.url ?? door.url}`;
}

/**
 * What a reader could be shown from this read, and the extraction configuration, decide change. Fetch noise never does:
 * check times, robots.txt, a byte hash, or a firewall's per-response script (Incapsula appends a random `cb=` to every page).
 */
export function votingSourceContentHash(mappings: readonly VotingSourceDoor[], read: VotingSourceRead, contextHash: string | null = null): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !["checkedAt", "retrievedAt", "collectedAt", "documentHash"].includes(key)).map(([key, child]) => [key, stable(child)])) : value;
  const inputs = mappings.map(({ access: _access, linkingPage: _linkingPage, discoveredFrom: _discoveredFrom, ...door }) =>
    ({ id: door.id, value: stable(door) })).sort((a, b) => a.id.localeCompare(b.id));
  const { rawBodies: _bytes, attempts: _attempts, ...facts } = read;
  return createHash("sha256").update(canonicalCivicDataJson({ inputs, contextHash, facts: stable(facts) })).digest("hex");
}

/** Partial extraction remains owed even when the bytes happen to match a previous attempt. */
export function votingSourceReadComplete(read: VotingSourceRead): boolean {
  return read.rawBodies.some(body => !new URL(body.url).pathname.endsWith("/robots.txt")) &&
    !read.blanks.some(blank => ["access", "extraction"].includes(blank.reason) ||
      blank.reason === "missing-sites" && /^Remaining pages of the published location list$/.test(blank.owed));
}

export const votingSourceManifestHash = (hashes: Readonly<Record<string, string | null>>): string =>
  createHash("sha256").update(canonicalCivicDataJson(hashes)).digest("hex");

/** An older package's retained sources start unconfirmed; the first refreshed door never stands in for them. */
export function votingSourceManifest(file: VotingSitesFile | null, doors: readonly VotingSourceDoor[]): Record<string, string | null> {
  const hashes: Record<string, string | null> = { ...(file?.sourceHashes ?? {}) };
  if (!file || file.sourceManifestVersion === 1) return hashes;
  const address = (url: string) => pageAddress(url)?.url ?? url;
  for (const jurisdiction of file.jurisdictions) {
    const urls = new Set([
      ...jurisdiction.sites.flatMap(site => site.sources?.map(source => source.url) ?? [jurisdiction.sourceUrl]),
      ...(jurisdiction.rules ?? []).map(rule => rule.source.url),
      ...(jurisdiction.boundaries ?? []).map(boundary => boundary.source.url),
      ...(jurisdiction.publication ? [jurisdiction.publication.source.url] : []),
      ...(!jurisdiction.sites.length && !jurisdiction.rules?.length && !jurisdiction.boundaries?.length ? [jurisdiction.sourceUrl] : []),
    ]);
    for (const url of urls) {
      const sameDocument = doors.filter(door => address(door.url) === address(url));
      const sameScope = sameDocument.filter(door => door.scope.ocdId === jurisdiction.ocdId);
      const keys = (sameScope.length ? sameScope : sameDocument).map(votingSourceHashKey);
      for (const key of keys.length ? keys : [`${jurisdiction.ocdId}|${address(url)}`]) if (!Object.hasOwn(hashes, key)) hashes[key] = null;
    }
  }
  return hashes;
}
