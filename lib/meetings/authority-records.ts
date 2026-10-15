import { gunzipSync, gzipSync } from "node:zlib";
import type { ReaderArtifactStore } from "./edge-store.ts";
import type { ReaderSelection } from "../db/reader-route.ts";
import { sha256OfJson } from "./edge-artifacts.ts";
import { promotedPayloadSha256 } from "../civic-data/attested-promotion.ts";

interface RecordRef {
  readonly path: readonly (string | number)[];
  readonly key: string;
  readonly sha: string;
  readonly tags: readonly string[];
}

export interface RecordIndex {
  readonly kind: "READER_RECORDS";
  readonly base: unknown;
  readonly records: readonly RecordRef[];
  readonly parties?: Readonly<Record<string, string | null>>;
}

function tagsOf(value: unknown): Set<string> {
  const tags = new Set<string>();
  const visit = (row: unknown, field = "") => {
    if (typeof row === "string" && !/^parent/i.test(field) && !["sourceId", "versionId", "candidateId", "committeeId", "eventItemId"].includes(field) && (/(?:^|_)(?:id|ids|key|keys)$|Id$|Ids$|Keys$|^bioguide/i.test(field) ||
      /^(ocd-|congress:|statewide:|roster:|fec:|ballot-|legiscan:|plural:)/.test(row))) tags.add(row);
    else if (Array.isArray(row)) row.forEach(child => visit(child, field));
    else if (row && typeof row === "object") for (const [key, child] of Object.entries(row)) {
      if (/^(ocd-person\/|congress:|nh-general-court:|[A-Z]\d{6}$)/.test(key)) tags.add(key);
      visit(child, key);
    }
    if (typeof row === "string" && field === "state" && /^[A-Za-z]{2}$/.test(row)) tags.add(`state:${row.toUpperCase()}`);
  };
  visit(value);
  return tags;
}

// Large collections become immutable records. The index contains identifiers and shape, never their payloads.
export async function publishAuthorityRecords(value: unknown, store: ReaderArtifactStore, previous?: RecordIndex): Promise<RecordIndex> {
  const records: RecordRef[] = [];
  const held = new Map(previous?.records.map(ref => [ref.sha, ref.key]));
  const record = async (row: unknown, path: readonly (string | number)[], extra: readonly string[] = []) => {
    const sha = sha256OfJson(row);
    const position = records.length;
    const tags = tagsOf(row);
    records.push({ path, key: "", sha, tags: [] });
    const key = held.get(sha) ?? await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(row))), "json.gz");
    for (const tag of extra) tags.add(tag);
    records[position] = { path, key, sha, tags: [...tags] };
  };
  const walk = async (row: unknown, path: readonly (string | number)[], owner: readonly string[] = []): Promise<unknown> => {
    if (Array.isArray(row) && path.at(-1) === "entries") return Promise.all(row.map((child, index) => walk(child, [...path, index], owner)));
    if (Array.isArray(row) && row.some(child => child && typeof child === "object")) {
      for (let offset = 0; offset < row.length; offset += 32) await Promise.all(row.slice(offset, offset + 32).map((child, index) =>
        record(child, [...path, offset + index], [...owner, ...(path.at(-1) === "containers" ? [`container:${offset + index}`] : [])])));
      return [];
    }
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const map = ["byMember", "cards", "links", "rosterPhotos", "codes"].includes(String(path.at(-1))) &&
        !Object.hasOwn(row, String(path.at(-1)));
      if (map && Object.values(row).every(child => child && typeof child === "object" || typeof child === "string")) {
        for (const [key, child] of Object.entries(row)) await record(child, [...path, key],
          path.at(-1) === "codes" ? [key, ...(child as number[][]).map(entry => `container:${entry[0]}`)] : [key]);
        return {};
      }
      const out: Record<string, unknown> = {};
      const own = [...owner, ...["officeholderId", "personId", "member"].flatMap(field =>
        typeof (row as Record<string, unknown>)[field] === "string" ? [(row as Record<string, string>)[field]] : [])];
      for (const [key, child] of Object.entries(row)) out[key] = await walk(child, [...path, key], own);
      return out;
    }
    return row;
  };
  const base = await walk(value, []);
  const directory = value as { directory?: unknown; roster?: { officeholders: { id: string; partyLabel: string | null }[] } } | null;
  const parties = directory?.directory && directory.roster?.officeholders
    ? Object.fromEntries(directory.roster.officeholders.map(holder => [holder.id, holder.partyLabel])) : undefined;
  return { kind: "READER_RECORDS", base, records, ...(parties ? { parties } : {}) };
}

const values = new Map<string, Promise<unknown>>();

export async function readAuthorityRecords(index: RecordIndex, store: ReaderArtifactStore, selection?: ReaderSelection): Promise<unknown> {
  if (index.kind !== "READER_RECORDS" || !Array.isArray(index.records)) throw new Error("READER_RECORD_INDEX_INVALID");
  const wanted = new Set<RecordRef>();
  const keys = new Set(selection?.keys);
  const divisions = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of index.records) {
      const metadata = ref.path.includes("divisions") && !ref.path.includes("roster");
      const code = ref.path[0] === "codes";
      const window = selection?.governmentWindow;
      const listing = ref.path[0] === "governments" && typeof ref.path[1] === "number";
      const inWindow = window && listing && ref.path[1] >= window[0] && ref.path[1] < window[0] + window[1];
      if (wanted.has(ref) || window && listing && !inWindow || !inWindow && selection && ref.tags.length &&
        !(code ? keys.has(String(ref.path[1])) : ref.tags.some((tag: string) => keys.has(tag) || metadata && divisions.has(tag)))) continue;
      wanted.add(ref);
      if (ref.path[0] === "containers") continue;
      if (ref.path.some((field: string | number) => ["rollCalls", "votes", "profiles", "snapshots", "statements"].includes(String(field)))) continue;
      for (const tag of ref.tags) {
        if (code && !tag.startsWith("container:")) continue;
        if (tag.startsWith("state:")) continue;
        if (tag.startsWith("ocd-division/") && !tag.includes("#")) {
          if (!divisions.has(tag)) { divisions.add(tag); changed = true; }
        } else if (!keys.has(tag)) {
          keys.add(tag);
          if (tag.startsWith("congress:")) keys.add(tag.slice(9));
          changed = true;
        }
      }
    }
  }
  const out = structuredClone(index.base) as Record<string | number, unknown>;
  if (selection?.governmentWindow) out.governmentCount = index.records.filter(ref => ref.path[0] === "governments").length;
  if (selection && index.parties) out.partyLabels = index.parties;
  const loaded = await Promise.all([...wanted].map(async ref => {
    let read = values.get(ref.key);
    if (!read) {
      read = (async () => {
        const bytes = await store.readBytes(ref.key);
        if (!bytes) throw new Error("READER_RECORD_MISSING");
        const value: unknown = JSON.parse(gunzipSync(bytes).toString("utf8"));
        if (sha256OfJson(value) !== ref.sha) throw new Error("READER_RECORD_HASH_MISMATCH");
        return value;
      })();
      const held = read;
      values.set(ref.key, held);
      held.catch(() => { if (values.get(ref.key) === held) values.delete(ref.key); });
      if (values.size > 4096) values.delete(values.keys().next().value!);
    }
    return { ref, value: await read };
  }));
  for (const { ref, value } of loaded) {
    let parent = out;
    for (const key of ref.path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
    parent[ref.path.at(-1)!] = value;
  }
  const heldOrListed = (set: unknown) => {
    const { contests, heldContests } = (set ?? {}) as { contests?: unknown[]; heldContests?: unknown[] };
    return Boolean(contests?.length || heldContests?.length);
  };
  // Sparse array positions preserve references while reconstructing, then ordinary collections keep their original order.
  const compact = (row: unknown, field = ""): unknown => {
    if (Array.isArray(row)) return field === "containers" ? row : row.filter(child => child !== undefined).map(child => compact(child));
    if (row && typeof row === "object") return Object.fromEntries(Object.entries(row)
      .filter(([, child]) => !selection || field !== "ballots" || heldOrListed(child))
      .map(([key, child]) => [key, compact(child, key)]));
    return row;
  };
  if (selection) for (const key of keys) selection.keys.add(key);
  const result = compact(out);
  if (selection && result && typeof result === "object" && "entries" in result) {
    for (const entry of (result as { entries: { kind: string; projection?: { payload: unknown }; attested?: { payloadSha256: string } }[] }).entries) {
      if (entry.kind === "PROMOTED" && entry.projection && entry.attested) entry.attested.payloadSha256 = promotedPayloadSha256(entry.projection.payload);
    }
  }
  return result;
}
