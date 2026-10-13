import { parse } from "yaml";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { FEDERAL_DIRECTORY_SCOPE, FEDERAL_DIRECTORY_SOURCE_ID, federalDirectoryProjectionIssues, type FederalDirectoryReadModel } from "../../officials/federal-directory-data-plane.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { LdaRoster } from "./types.ts";

const caches = new WeakMap<RoutineDataStore, Map<string, Promise<LdaRoster | undefined>>>();
/** Resolve an immutable promoted roster version; every LDA filing keeps this evidence reference. */
export async function readLdaRosterVersion(store: RoutineDataStore, versionId: string): Promise<LdaRoster | undefined> {
  let cache = caches.get(store);
  if (!cache) { cache = new Map(); caches.set(store, cache); }
  if (cache.has(versionId)) return cache.get(versionId)!;
  const pending: Promise<LdaRoster | undefined> = (async () => {
    const saved = await store.readCandidate(versionId);
    if (!saved || saved.state !== "PROMOTED" || saved.candidate.recordClass !== "FEDERAL_DIRECTORY" ||
      saved.candidate.sourceId !== FEDERAL_DIRECTORY_SOURCE_ID || saved.candidate.scope !== FEDERAL_DIRECTORY_SCOPE) return undefined;
    const projection = saved.candidate.readModel as FederalDirectoryReadModel;
    if (federalDirectoryProjectionIssues(projection).length) return undefined;
    const acquisitions = (saved.candidate.normalizedPayload as { acquisitions?: { finalUrl: string; body: string }[] })?.acquisitions ?? [];
    const core = acquisitions.find(row => row.finalUrl.endsWith(`/${projection.sourceSha}/legislators-current.yaml`));
    const names = new Map<string, string[]>();
    if (core) {
      const raw = parse(core.body, { maxAliasCount: 0, uniqueKeys: true }) as { id?: { bioguide?: string }; name?: { first?: string; middle?: string; last?: string; nickname?: string; official_full?: string } }[];
      for (const row of raw) {
        const name = row.name;
        if (!row.id?.bioguide || !name?.first || !name.last) continue;
        names.set(row.id.bioguide, [name.official_full, `${name.first} ${name.last}`,
          name.middle ? `${name.first} ${name.middle} ${name.last}` : null,
          /^[A-Z]\.?$/i.test(name.first) && name.middle ? `${name.middle} ${name.last}` : null,
          name.nickname ? `${name.nickname} ${name.last}` : null].filter((value): value is string => Boolean(value)));
      }
    }
    return { versionId, members: projection.roster.officeholders.flatMap((holder): LdaRoster["members"] => {
      const bioguideId = holder.id.slice("congress:".length);
      const chamber = holder.chamber === "senate" || holder.chamber === "house" ? holder.chamber : null;
      if (!chamber || !holder.provenance.sourceUrl || !Object.values(FIPS_TO_STATE).some(row => row.postal === holder.state)) return [];
      return [{ bioguideId, chamber, state: holder.state!, names: [...new Set([holder.name, ...names.get(bioguideId) ?? []])],
        sourceUrl: holder.provenance.sourceUrl, sourceOrg: holder.provenance.sourceOrg,
        checkedAt: holder.provenance.collectedAt }];
    }) };
  })();
  cache.set(versionId, pending);
  pending.catch(() => cache!.delete(versionId));
  return pending;
}
