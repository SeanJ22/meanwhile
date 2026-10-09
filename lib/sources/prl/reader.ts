import { createHash } from "node:crypto";
import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { readPrlArchiveProjection, type PrlArchiveProjection } from "./archive-publication.ts";
import { resolveS3ArchiveStore, type PrlArchiveStore } from "./archive-store.ts";
import { requiredPrlDataset } from "./inventory.ts";
import { isVisibleAsOf } from "./future-date.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";
import type { PrlPrimaryProfile, PrlStateProfile } from "./precompute.ts";

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
    if (held.kind !== "PROMOTED") return { ...out, gaps: ["We are still acquiring archived statements for this person."] };
    projection = held.value;
  }
  for (const [datasetId, kind, native, field] of [
    ["profiles-state", "state", statePerson, "openstatesId"],
    ["primary-rhetoric", "primary", candidate, "candidateId"],
  ] as const) {
    if (!native) continue;
    const receipt = projection.datasets[datasetId];
    const profiles = receipt?.profiles?.filter(row => object(row)?.[field] === native) ?? [];
    if (profiles.length !== 1) continue;
    const common = { sourceUrl: receipt.sourceUrl, retrievedAt: receipt.fetchedAt, attribution: PRL_RHETORIC_ATTRIBUTION };
    if (kind === "state") out.summaries.push({ kind, profile: profiles[0] as PrlStateProfile, ...common });
    else out.summaries.push({ kind, profile: profiles[0] as PrlPrimaryProfile, ...common });
  }
  let archive: PrlArchiveStore;
  try { archive = options.archive ?? resolveS3ArchiveStore(); }
  catch { out.gaps.push("Archived statement text is temporarily unavailable."); return out; }
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
