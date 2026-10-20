import { createHash } from "node:crypto";
import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { readPrlArchiveProjection, type PrlArchiveProjection } from "./archive-publication.ts";
import { resolveS3ArchiveStore, type PrlArchiveStore } from "./archive-store.ts";
import { requiredPrlDataset } from "./inventory.ts";
import { isVisibleAsOf } from "./future-date.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";
import type { PrlPrimaryProfile, PrlStateProfile } from "./precompute.ts";
import { readPublishedArraySlice } from "../../civic-data/published-array-slice.ts";
import type { PrlIngestReceipt } from "./receipt.ts";

export interface PrlPersonKeys { bioguideId?: string | null; openstatesId?: string | null; candidateId?: string | null }
export interface PrlPersonStatement {
  id: string; datasetId: string; nativePersonId: string; text: string; date: string;
  sourceUrl: string; sourceLabel: string; retrievedAt: string;
  attribution: typeof PRL_RHETORIC_ATTRIBUTION;
}
export type PrlPersonSummary = {
  kind: "state"; profile: PrlStateProfile;
  sourceUrl: string; retrievedAt: string; attribution: typeof PRL_RHETORIC_ATTRIBUTION;
} | {
  kind: "primary"; profile: PrlPrimaryProfile;
  sourceUrl: string; retrievedAt: string; attribution: typeof PRL_RHETORIC_ATTRIBUTION;
};
export interface PrlPersonRead { statements: PrlPersonStatement[]; summaries: PrlPersonSummary[]; gaps: string[] }

const string = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sourceUrl = (value: unknown) => {
  try { const url = new URL(string(value)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
};

/** One immutable native-person profile, never a bucket listing or a national receipt. */
export async function readPrlProfileObject(archive: PrlArchiveStore, root: string, subject: string): Promise<Record<string, unknown> | null> {
  if (!/^[a-z-]+\/[a-f0-9]{64}\/prl-ingest-3$/.test(root)) throw new Error("PRL_PROFILE_ROOT_INVALID");
  const key = `${root}/people/${createHash("sha256").update(subject).digest("hex")}/profile.json`;
  const meta = await archive.head(key);
  if (!meta) return null;
  if (meta.size > 64 * 1024) throw new Error("PRL_PROFILE_OBJECT_TOO_LARGE");
  const bytes = await archive.get(key);
  if (!bytes || bytes.byteLength !== meta.size) throw new Error("PRL_PROFILE_OBJECT_INCOMPLETE");
  const saved = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (saved?.subject !== subject || !object(saved.profile)) throw new Error("PRL_PROFILE_OBJECT_IDENTITY_MISMATCH");
  return object(saved.profile);
}

async function legacyProfile(datasetId: string, native: string) {
  return readPublishedArraySlice<Record<string, unknown>>({ recordClass: "PRL_ARCHIVE", scope: "US:prl:known-archives",
    path: ["datasets", datasetId, "profiles"], statePath: [datasetId === "profiles-state" ? "openstatesId" : "candidateId"],
    statePattern: `^${native.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` });
}

export async function legacyPrlArchives(keys: { bioguide: string | null; statePerson: string | null; candidate: string | null } = { bioguide: null, statePerson: null, candidate: null },
  missing?: readonly string[]): Promise<PrlArchiveProjection | null> {
  const datasets: Record<string, PrlIngestReceipt> = {};
  for (const id of ["profiles-state", "primary-rhetoric", "state-rhetoric", "statements-national", "newsletters", "press-releases", "floor-speeches"]) {
    if (missing && !missing.includes(id)) continue;
    const read = await readPublishedArraySlice<PrlIngestReceipt>({ recordClass: "PRL_ARCHIVE", scope: "US:prl:known-archives",
      path: ["datasets", id], statePath: [], statePattern: ".*", objectRecord: true, omitKeys: ["profiles", "objectKeys", "newObjectKeys"] });
    const receipt = read?.records[0];
    if (!receipt) continue;
    if (read?.sourceId !== "prl") throw new Error("PRL_ARCHIVE_SOURCE_MISMATCH");
    const native = id === "profiles-state" ? keys.statePerson : id === "primary-rhetoric" ? keys.candidate : null;
    const profile = native ? await legacyProfile(id, native) : null;
    datasets[id] = { ...receipt, profiles: profile?.records ?? null, objectKeys: [], newObjectKeys: [] };
  }
  return Object.keys(datasets).length ? { formatVersion: 1, datasets } : null;
}

/** Native person lookup only. A request never lists a bucket or opens a national source. */
export async function readPrlPerson(keys: PrlPersonKeys, options: Omit<PromotedCivicDataReadOptions, "now"> & {
  archive?: PrlArchiveStore; projection?: PrlArchiveProjection; now?: number;
} = {}): Promise<PrlPersonRead> {
  const out: PrlPersonRead = { statements: [], summaries: [], gaps: [] };
  const bioguide = keys.bioguideId && /^[A-Z]\d{6}$/.test(keys.bioguideId) ? keys.bioguideId : null;
  const statePerson = keys.openstatesId && /^ocd-person\/[0-9a-f-]{36}$/.test(keys.openstatesId) ? keys.openstatesId : null;
  const candidate = keys.candidateId && /^[HSP][A-Z0-9]{8}$/.test(keys.candidateId) ? keys.candidateId : null;
  if (!bioguide && !statePerson && !candidate) return out;
  let projection = options.projection;
  if (!projection) {
    const held = await readPrlArchiveProjection({ ...options, now: options.now === undefined ? undefined : new Date(options.now).toISOString() });
    projection = held.kind === "PROMOTED" ? held.value : await legacyPrlArchives({ bioguide, statePerson, candidate }) ?? undefined;
    if (!projection) return { ...out, gaps: ["We are still acquiring archived statements for this person."] };
  }
  let archive: PrlArchiveStore | null = options.archive ?? null;
  if (!archive) try { archive = resolveS3ArchiveStore(); } catch { /* Legacy per-person measurements remain independently usable. */ }
  for (const [datasetId, kind, native, field] of [
    ["profiles-state", "state", statePerson, "openstatesId"],
    ["primary-rhetoric", "primary", candidate, "candidateId"],
  ] as const) {
    if (!native) continue;
    const receipt = projection.datasets[datasetId];
    const saved = receipt?.objectRoot && receipt.parserVersion === "prl-ingest/3" && archive
      ? await readPrlProfileObject(archive, receipt.objectRoot, native).catch(() => null) : null;
    if (saved && saved[field] !== native) out.gaps.push("Some archived measurements are temporarily unavailable.");
    const profiles = saved && saved[field] === native ? [saved] : receipt?.profiles?.filter(row => object(row)?.[field] === native) ??
      (receipt && receipt.parserVersion !== "prl-ingest/3" ? (await legacyProfile(datasetId, native))?.records ?? [] : []);
    if (profiles.length !== 1) continue;
    const common = { sourceUrl: receipt.sourceUrl, retrievedAt: receipt.fetchedAt, attribution: PRL_RHETORIC_ATTRIBUTION };
    if (kind === "state") out.summaries.push({ kind, profile: profiles[0] as PrlStateProfile, ...common });
    else out.summaries.push({ kind, profile: profiles[0] as PrlPrimaryProfile, ...common });
  }
  if (!archive) { out.gaps.push("Archived statement text is temporarily unavailable."); return out; }
  const selections: [string, string][] = [
    ...(bioguide ? ["statements-national", "press-releases", "newsletters", "floor-speeches"].map(id => [id, bioguide] as [string, string]) : []),
    ...(statePerson ? [["state-rhetoric", statePerson] as [string, string]] : []),
    ...(candidate ? [["primary-rhetoric", candidate] as [string, string]] : []),
  ];
  const now = options.now ?? Date.now();
  let remainingBytes = 12 * 1024 * 1024;
  for (const [id, native] of selections) {
    const receipt = projection.datasets[id];
    if (!receipt?.objectRoot) { out.gaps.push("We are still acquiring some archived statement sources for this person."); continue; }
    const prefix = `${receipt.objectRoot}/people/${createHash("sha256").update(native).digest("hex")}/`;
    try {
      const indexBytes = await archive.get(`${prefix}index.json`);
      if (!indexBytes) continue;
      if (indexBytes.byteLength > 256 * 1024) throw new Error("PRL_PERSON_INDEX_TOO_LARGE");
      const index = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes)));
      if (index?.subject !== native || !Array.isArray(index.keys) || index.keys.some(key => typeof key !== "string" ||
          !key.startsWith(prefix) || !/\/[a-f0-9]{64}\.json$/.test(key))) throw new Error("PRL_PERSON_INDEX_INVALID");
      // Newest records are written first. Bounded partial reads never assert source absence.
      if (index.keys.length > 2) out.gaps.push("Only a recent portion of this person's archived statements is shown.");
      for (const key of index.keys.slice(0, 2) as string[]) {
        const meta = await archive.head(key);
        if (!meta || meta.size > remainingBytes || meta.size > 5 * 1024 * 1024) throw new Error("PRL_PERSON_READ_LIMIT");
        const bytes = await archive.get(key);
        if (!bytes || bytes.byteLength !== meta.size || bytes.byteLength > remainingBytes) throw new Error("PRL_PERSON_PART_INCOMPLETE");
        remainingBytes -= bytes.byteLength;
        if (!key.endsWith(`/${createHash("sha256").update(bytes).digest("hex")}.json`)) throw new Error("PRL_PERSON_PART_HASH_MISMATCH");
        const rows: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!Array.isArray(rows)) throw new Error("PRL_PERSON_PART_INVALID");
        const identityField = requiredPrlDataset(id).key!;
        for (const raw of rows) {
          const row = object(raw);
          if (!row || row[identityField] !== native) throw new Error("PRL_PERSON_PART_IDENTITY_MISMATCH");
          const text = string(row.text), date = string(row.date), url = sourceUrl(row.source_url ?? row.url);
          if (!text || !date || !url || !isVisibleAsOf(date, now)) continue;
          // Carry literal complete text. A partial substring is never represented as a complete quote.
          if (text.length > 12_000) continue;
          const recordId = string(row.id) || string(row.source_id) || string(row.tweet_id) || createHash("sha256").update(JSON.stringify(row)).digest("hex");
          out.statements.push({ id: `prl:${id}:${native}:${recordId}`, datasetId: id, nativePersonId: native, text, date,
            sourceUrl: url, sourceLabel: string(row.source) || receipt.title, retrievedAt: receipt.fetchedAt,
            attribution: PRL_RHETORIC_ATTRIBUTION });
        }
      }
    } catch { out.gaps.push("Some archived statement text is temporarily unavailable."); }
  }
  const seen = new Set<string>();
  out.statements = out.statements.sort((a, b) => b.date.localeCompare(a.date)).filter(row => {
    const key = `${row.sourceUrl}:${row.text}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 24);
  out.gaps = [...new Set(out.gaps)];
  return out;
}
