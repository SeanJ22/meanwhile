import { parse } from "yaml";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { readRawCaptureText } from "../../civic-data/raw-capture-vault.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { FEDERAL_DIRECTORY_SOURCE_ID, FEDERAL_DIRECTORY_STATES, federalDirectoryScope, type FederalDirectoryCapture } from "../../officials/federal-directory-data-plane.ts";
import type { Officeholder } from "../../officials/types.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { LdaRoster } from "./types.ts";

const placeScopes = new Set(FEDERAL_DIRECTORY_STATES.map(federalDirectoryScope));
const caches = new WeakMap<RoutineDataStore, Map<string, Promise<LdaRoster | undefined>>>();
/** Every place's held members of Congress as one roster, named by the place versions it was read from. */
export async function readHeldCongressRoster(store: RoutineDataStore, vault: EvidenceStore, _now: string): Promise<LdaRoster | undefined> {
  const versions = await heldCongressRosterVersions(store);
  return versions.length ? readLdaRosterVersion(store, vault, versions.join("|")) : undefined;
}

/** Changes to the identity join are visible from the keyed current versions, without opening any roster payload. */
export async function heldCongressRosterVersions(store: RoutineDataStore): Promise<string[]> {
  return (await store.readPromotionIdentities("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_STATES.map(federalDirectoryScope)))
    .filter(pointer => pointer.sourceId === FEDERAL_DIRECTORY_SOURCE_ID && pointer.versionId === pointer.lastKnownGoodVersionId)
    .sort((a, b) => a.scope.localeCompare(b.scope)).map(pointer => pointer.versionId);
}

/** Resolve immutable promoted place rosters; every LDA filing keeps this evidence reference. */
export async function readLdaRosterVersion(store: RoutineDataStore, vault: EvidenceStore, versionId: string): Promise<LdaRoster | undefined> {
  let cache = caches.get(store);
  if (!cache) { cache = new Map(); caches.set(store, cache); }
  if (cache.has(versionId)) return cache.get(versionId)!;
  const pending: Promise<LdaRoster | undefined> = (async () => {
    const members: LdaRoster["members"] = [], parsed = new Map<string, Promise<Names>>();
    for (const placeVersion of versionId.split("|")) {
      const place = await readPlaceRoster(store, vault, placeVersion, parsed);
      if (!place) return undefined;
      members.push(...place);
    }
    return { versionId, members };
  })();
  cache.set(versionId, pending);
  pending.catch(() => cache!.delete(versionId));
  return pending;
}

type Names = Map<string, string[]>;

async function sourceNames(vault: EvidenceStore, core: FederalDirectoryCapture): Promise<Names> {
  const names: Names = new Map();
  const raw = parse(await readRawCaptureText(vault, core.raw), { maxAliasCount: 0, uniqueKeys: true }) as { id?: { bioguide?: string }; name?: { first?: string; middle?: string; last?: string; nickname?: string; official_full?: string } }[];
  for (const row of raw) {
    const name = row.name;
    if (!row.id?.bioguide || !name?.first || !name.last) continue;
    names.set(row.id.bioguide, [name.official_full, `${name.first} ${name.last}`,
      name.middle ? `${name.first} ${name.middle} ${name.last}` : null,
      /^[A-Z]\.?$/i.test(name.first) && name.middle ? `${name.middle} ${name.last}` : null,
      name.nickname ? `${name.nickname} ${name.last}` : null].filter((value): value is string => Boolean(value)));
  }
  return names;
}

// Every place reads the same national source file; its names are parsed once per roster.
async function readPlaceRoster(store: RoutineDataStore, vault: EvidenceStore, versionId: string, parsed: Map<string, Promise<Names>>): Promise<LdaRoster["members"] | undefined> {
  const saved = await store.readCandidateSummary(versionId);
  if (!saved || saved.state !== "PROMOTED" || saved.candidate.recordClass !== "FEDERAL_DIRECTORY" ||
    saved.candidate.sourceId !== FEDERAL_DIRECTORY_SOURCE_ID || !placeScopes.has(saved.candidate.scope) ||
    saved.candidate.id !== versionId || saved.promotedVersion !== versionId || saved.lastKnownGoodVersion !== versionId || saved.receipt?.decision !== "GOOD") return undefined;
  const [holders, sourceSha, acquisitions] = await Promise.all([
    store.readCandidatePath<Officeholder[]>(versionId, ["readModel", "roster", "officeholders"]),
    store.readCandidatePath<string>(versionId, ["readModel", "sourceSha"]),
    store.readCandidatePath<FederalDirectoryCapture[]>(versionId, ["normalizedPayload", "acquisitions"]),
  ]);
  if (!Array.isArray(holders) || !sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) return undefined;
  const core = acquisitions?.find(row => row.finalUrl.endsWith(`/${sourceSha}/legislators-current.yaml`));
  let names: Promise<Names> = Promise.resolve(new Map());
  if (core) {
    names = parsed.get(core.raw.rawHash) ?? sourceNames(vault, core);
    parsed.set(core.raw.rawHash, names);
  }
  const held = await names;
  return holders.flatMap((holder): LdaRoster["members"] => {
    const bioguideId = holder.id.slice("congress:".length);
    const chamber = holder.chamber === "senate" || holder.chamber === "house" ? holder.chamber : null;
    if (!chamber || !holder.provenance.sourceUrl || !Object.values(FIPS_TO_STATE).some(row => row.postal === holder.state)) return [];
    return [{ bioguideId, chamber, state: holder.state!, names: [...new Set([holder.name, ...held.get(bioguideId) ?? []])],
      sourceUrl: holder.provenance.sourceUrl, sourceOrg: holder.provenance.sourceOrg,
      checkedAt: holder.provenance.collectedAt }];
  });
}
