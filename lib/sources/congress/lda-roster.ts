import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { restoreRawCaptureFile } from "../../civic-data/raw-capture-vault.ts";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { FEDERAL_DIRECTORY_SOURCE_ID, FEDERAL_DIRECTORY_STATES, federalDirectoryProjectionIssues, federalDirectoryScope, type FederalDirectoryCapture, type FederalDirectoryReadModel } from "../../officials/federal-directory-data-plane.ts";
import { readCongressYamlBlocks } from "../../officials/congress-source-records.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { ldaHonoreeLookupForms, ldaRosterNameForms } from "./lda-honoree.ts";
import type { FederalCapture, LdaRoster, LdaRosterMember } from "./types.ts";

const placeScopes = new Set(FEDERAL_DIRECTORY_STATES.map(federalDirectoryScope));
const states = new Set(Object.values(FIPS_TO_STATE).map(row => row.postal));
export interface LdaRosterSelection { readonly honoreeNames?: readonly string[]; readonly bioguideIds?: readonly string[] }
interface Database {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...values: string[]): void; get(...values: string[]): Record<string, string> | undefined;
    iterate(...values: string[]): Iterable<Record<string, string>> };
}
interface RosterIndex { readonly db: Database; dispose(): Promise<void> }
const indexes = new WeakMap<RoutineDataStore, { readonly version: string; readonly pending: Promise<RosterIndex | undefined> }>();

/** Pointer identities are metadata; no country's roster records are retained here. */
export async function readHeldCongressRosterVersion(store: RoutineDataStore): Promise<string | undefined> {
  const pointers = await store.readPromotionIdentities("FEDERAL_DIRECTORY", [...placeScopes]);
  if (pointers.some(row => row.sourceId !== FEDERAL_DIRECTORY_SOURCE_ID || row.versionId !== row.lastKnownGoodVersionId)) throw new Error("LDA_ROSTER_POINTER_INVALID");
  return pointers.length ? [...pointers].sort((a, b) => a.scope.localeCompare(b.scope)).map(row => row.versionId).join("|") : undefined;
}

export async function readHeldCongressRoster(store: RoutineDataStore, vault: EvidenceStore, _now: string, selection: LdaRosterSelection): Promise<LdaRoster | undefined> {
  const version = await readHeldCongressRosterVersion(store);
  return version ? readLdaRosterVersion(store, vault, version, selection) : undefined;
}

/** Every filing carries its own names. Only people sharing those exact published
 * name forms (including ambiguous matches) leave the disk index. */
export function federalCaptureHonorees(capture: FederalCapture): string[] {
  if (capture.kind !== "contributions") return [];
  const root = JSON.parse(capture.body) as { results?: { contribution_items?: { honoree_name?: unknown }[] }[] };
  return [...new Set((root.results ?? []).flatMap(row => (row.contribution_items ?? []).flatMap(item => typeof item.honoree_name === "string" ? [item.honoree_name] : [])))];
}

export async function readLdaRosterVersion(store: RoutineDataStore, vault: EvidenceStore, versionId: string, selection: LdaRosterSelection): Promise<LdaRoster | undefined> {
  let cached = indexes.get(store);
  if (cached?.version !== versionId) {
    const previous = cached;
    cached = { version: versionId, pending: buildRosterIndex(store, vault, versionId) };
    indexes.set(store, cached);
    if (previous) void previous.pending.then(index => index?.dispose()).catch(() => {});
    const pending = cached;
    void pending.pending.catch(() => { if (indexes.get(store) === pending) indexes.delete(store); });
  }
  const index = await cached.pending;
  if (!index) return undefined;
  const selected = new Map<string, LdaRosterMember>();
  for (const id of selection.bioguideIds ?? []) {
    const row = index.db.prepare("SELECT value FROM members WHERE bioguide=?").get(id);
    if (row) selected.set(id, JSON.parse(row.value));
  }
  for (const name of selection.honoreeNames ?? []) for (const form of ldaHonoreeLookupForms(name)) {
    for (const row of index.db.prepare("SELECT m.bioguide,m.value FROM forms f JOIN members m ON m.bioguide=f.bioguide WHERE f.form=?").iterate(form)) selected.set(row.bioguide, JSON.parse(row.value));
  }
  return { versionId, members: [...selected.values()] };
}

export async function disposeLdaRosterIndex(store: RoutineDataStore): Promise<void> {
  const held = indexes.get(store); indexes.delete(store);
  await (await held?.pending)?.dispose();
}

async function buildRosterIndex(store: RoutineDataStore, vault: EvidenceStore, versionId: string): Promise<RosterIndex | undefined> {
  const directory = await mkdtemp(temporaryPath(join(tmpdir(), "meanwhile-lda-roster-")));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => Database };
  const db = new DatabaseSync(temporaryPath(join(directory, "roster.sqlite")));
  let closed = false;
  const cleanup = () => { if (!closed) { closed = true; db.close(); rmSync(temporaryPath(directory), { recursive: true, force: true }); } };
  process.once("exit", cleanup);
  const dispose = async () => { process.removeListener("exit", cleanup); if (!closed) { closed = true; db.close(); await rm(temporaryPath(directory), { recursive: true, force: true }); } };
  try {
    db.exec("PRAGMA journal_mode=OFF; PRAGMA cache_size=-1024; CREATE TABLE source_names(source TEXT,bioguide TEXT,names TEXT,PRIMARY KEY(source,bioguide)) WITHOUT ROWID; CREATE TABLE members(bioguide TEXT PRIMARY KEY,value TEXT) WITHOUT ROWID; CREATE TABLE forms(form TEXT,bioguide TEXT,PRIMARY KEY(form,bioguide)) WITHOUT ROWID; BEGIN");
    const sources = new Set<string>();
    for (const placeVersion of versionId.split("|")) {
      const saved = await store.readCandidate(placeVersion);
      if (!saved || saved.state !== "PROMOTED" || saved.candidate.recordClass !== "FEDERAL_DIRECTORY" ||
        saved.candidate.sourceId !== FEDERAL_DIRECTORY_SOURCE_ID || !placeScopes.has(saved.candidate.scope)) { await dispose(); return undefined; }
      const projection = saved.candidate.readModel as FederalDirectoryReadModel;
      if (federalDirectoryProjectionIssues(projection).length) { await dispose(); return undefined; }
      const acquisitions = (saved.candidate.normalizedPayload as { acquisitions?: FederalDirectoryCapture[] })?.acquisitions ?? [];
      const core = acquisitions.find(row => row.finalUrl.endsWith(`/${projection.sourceSha}/legislators-current.yaml`));
      if (core && !sources.has(core.raw.rawHash)) {
        const path = temporaryPath(join(directory, `${core.raw.rawHash}.yaml`));
        await restoreRawCaptureFile(vault, core.raw, path);
        for await (const block of readCongressYamlBlocks(path)) {
          const [row] = block as { id?: { bioguide?: string }; name?: { first?: string; middle?: string; last?: string; nickname?: string; official_full?: string } }[];
          const name = row?.name;
          if (!row?.id?.bioguide || !name?.first || !name.last) continue;
          const names = [name.official_full, `${name.first} ${name.last}`, name.middle ? `${name.first} ${name.middle} ${name.last}` : null,
            /^[A-Z]\.?$/i.test(name.first) && name.middle ? `${name.middle} ${name.last}` : null, name.nickname ? `${name.nickname} ${name.last}` : null].filter((value): value is string => Boolean(value));
          db.prepare("INSERT INTO source_names VALUES(?,?,?)").run(core.raw.rawHash, row.id.bioguide, JSON.stringify(names));
        }
        sources.add(core.raw.rawHash); await rm(temporaryPath(path));
      }
      for (const holder of projection.roster.officeholders) {
        const bioguideId = holder.id.slice("congress:".length), chamber = holder.chamber;
        if (chamber !== "senate" && chamber !== "house" || !holder.provenance.sourceUrl || !states.has(holder.state!)) continue;
        const names = core ? db.prepare("SELECT names FROM source_names WHERE source=? AND bioguide=?").get(core.raw.rawHash, bioguideId) : undefined;
        const member: LdaRosterMember = { bioguideId, chamber, state: holder.state!, names: [...new Set([holder.name, ...(names ? JSON.parse(names.names) as string[] : [])])],
          sourceUrl: holder.provenance.sourceUrl, sourceOrg: holder.provenance.sourceOrg, checkedAt: holder.provenance.collectedAt };
        db.prepare("INSERT OR REPLACE INTO members VALUES(?,?)").run(bioguideId, JSON.stringify(member));
        for (const name of member.names) for (const form of ldaRosterNameForms(name)) db.prepare("INSERT OR IGNORE INTO forms VALUES(?,?)").run(form.form, bioguideId);
      }
    }
    db.exec("COMMIT");
    return { db, dispose };
  } catch (error) { await dispose(); throw error; }
}
