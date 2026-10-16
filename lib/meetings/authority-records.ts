import { AsyncLocalStorage } from "node:async_hooks";
import { partyVotersByVote } from "../votes/party-breakdown.ts";
import type { MemberVote } from "../votes/types.ts";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ReaderArtifactStore } from "./edge-store.ts";
import type { ReaderSelection } from "../db/reader-route.ts";
import { sha256OfJson } from "./edge-artifacts.ts";
import { normalizedGovernmentName } from "../civic-data/website-corrections.ts";
import { districtFamilyKey } from "../census-geography/division-id.ts";
import { promotedPayloadSha256 } from "../civic-data/attested-promotion.ts";

type Path = readonly (string | number)[];
export interface AuthorityPatch { readonly path: Path; readonly value: unknown; readonly tags: readonly string[]; readonly metadata?: readonly string[]; readonly initialize?: boolean }
interface Ref { readonly key: string; readonly sha: string }
interface Bundle { readonly version?: string; readonly tags?: readonly string[]; readonly metadata: readonly string[]; readonly records: readonly AuthorityPatch[] }
type Node = { readonly depth: number; readonly children: Readonly<Record<string, Ref>> } | { readonly entries: Readonly<Record<string, readonly Ref[]>> };
export interface RecordIndex {
  readonly kind: "READER_PLACE_RECORDS";
  readonly base: unknown;
  readonly root: Ref;
  readonly governmentCount: number;
  readonly keyKinds: readonly string[];
  readonly parties?: Readonly<Record<string, string | null>>;

}

export interface StateRecordIndex {
  readonly kind: "READER_STATE_RECORDS";
  readonly shards: Readonly<Record<string, Ref & { readonly version: string }>>;
  readonly aliases: Ref;
  readonly sourceVersion?: string;
  readonly expectedStates: readonly string[];
}

export interface AuthorityPlacePublication {
  readonly owner: string;
  readonly version: string;
  readonly load: () => Promise<{ readonly base: unknown; readonly records: readonly AuthorityPatch[] }>;
}
export interface StateRecordPublication {
  readonly state: string;
  readonly version: string;
  readonly base: unknown;
  readonly replace: boolean;
  readonly places: () => AsyncIterable<AuthorityPlacePublication>;
}

const stateOfTag = (tag: string) => /(?:state|territory|district):([a-z]{2})\b/i.exec(tag)?.[1]?.toLowerCase()
  ?? /^(?:government:(?:US-)?|statewide:|state:)([a-z]{2})\b/i.exec(tag)?.[1]?.toLowerCase()
  ?? /^([a-z]{2}):\d{4}:/i.exec(tag)?.[1]?.toLowerCase()
  ?? /\bUS-([a-z]{2})\b/i.exec(tag)?.[1]?.toLowerCase()
  ?? /^(?:curated:|plural:|legiscan:|roster:curated:)([a-z]{2})(?::|\/)/i.exec(tag)?.[1]?.toLowerCase()
  ?? /^ballot-([a-z]{2})[:-]/i.exec(tag)?.[1]?.toLowerCase();
const needsStateLookup = (tag: string) => !stateOfTag(tag) && !["division", "zip", "pointer", "inventory", "container", "code", "frame", "owner", "shared"].includes(keyKind(tag));

export function statesOfAuthorityRecord(record: AuthorityPatch): readonly string[] {
  const state = (record.value as { state?: unknown } | null)?.state;
  const states = new Set([...record.tags, ...record.path.filter((part): part is string => typeof part === "string")]
    .map(stateOfTag).filter((value): value is string => value !== undefined));
  if (typeof state === "string" && /^[a-z]{2}$/i.test(state)) states.add(state.toLowerCase());
  return states.size ? [...states].sort() : ["us"];
}

export function authorityRecordOwner(record: AuthorityPatch): string {
  const value = record.value as { ocdId?: string; divisionId?: string; bodyId?: string } | null;
  return value?.ocdId || value?.divisionId || (value?.bodyId?.startsWith("ocd-division/") ? value.bodyId.split("#")[0] : undefined)
    || record.tags.filter(tag => tag.startsWith("ocd-division/")).map(tag => tag.split("#")[0]).sort((a, b) => b.length - a.length || a.localeCompare(b))[0]
    || record.tags[0] || `path:${JSON.stringify(record.path)}`;
}

async function firstTag(ref: Ref, store: ReaderArtifactStore): Promise<string> {
  const node = await read(ref, store) as Node;
  return "entries" in node ? Object.keys(node.entries)[0] : firstTag(Object.values(node.children)[0], store);
}

async function mergeTrees(a: Ref, b: Ref, store: ReaderArtifactStore, start = 0): Promise<Ref> {
  if (a.key === b.key) return a;
  const [left, right] = await Promise.all([read(a, store), read(b, store)]) as [Node, Node];
  if ("entries" in left && !Object.keys(left.entries).length) return b;
  if ("entries" in right && !Object.keys(right.entries).length) return a;
  if ("entries" in left && "entries" in right) {
    const entries: Record<string, readonly Ref[]> = { ...left.entries };
    for (const [tag, refs] of Object.entries(right.entries)) entries[tag] = [...new Map([...(entries[tag] ?? []), ...refs].map(ref => [ref.key, ref])).values()];
    if (Object.keys(entries).length <= 64) return put({ entries }, store);
  }
  const keys = [...("entries" in left ? Object.keys(left.entries) : [await firstTag(a, store)]),
    ...("entries" in right ? Object.keys(right.entries) : [await firstTag(b, store)])];
  let depth = Math.min("depth" in left ? left.depth : 68, "depth" in right ? right.depth : 68);
  const first = digest(keys[0]);
  for (const key of keys) {
    const hash = digest(key); let at = start;
    while (at < depth && hash[at] === first[at]) at++;
    depth = at;
  }
  const branches = async (node: Node, ref: Ref): Promise<Readonly<Record<string, Ref>>> => {
    if ("children" in node) return node.depth === depth ? node.children : { [digest(await firstTag(ref, store))[depth]]: ref };
    const children: Record<string, Ref> = {};
    for (const [prefix, rows] of Map.groupBy(Object.entries(node.entries), ([tag]) => digest(tag)[depth]))
      children[prefix] = await put({ entries: Object.fromEntries(rows) }, store);
    return children;
  };
  const [x, y] = await Promise.all([branches(left, a), branches(right, b)]);
  const children: Record<string, Ref> = {};
  for (const prefix of new Set([...Object.keys(x), ...Object.keys(y)]))
    children[prefix] = x[prefix] && y[prefix] ? await mergeTrees(x[prefix], y[prefix], store, depth + 1) : x[prefix] ?? y[prefix];
  return put({ depth, children }, store);
}

async function patchTree(root: Ref, changes: ReadonlyMap<string, readonly Ref[]>, store: ReaderArtifactStore, start = 0): Promise<Ref> {
  const node = await read(root, store) as Node;
  if ("entries" in node) {
    const entries = { ...node.entries };
    for (const [tag, refs] of changes) { if (refs.length) entries[tag] = refs; else delete entries[tag]; }
    return writeTree(Object.entries(entries), store, start, root);
  }
  const sample = digest(await firstTag(root, store));
  let depth = node.depth;
  for (const [tag, refs] of changes) if (refs.length) {
    const hash = digest(tag); let at = start;
    while (at < depth && hash[at] === sample[at]) at++;
    depth = at;
  }
  const children: Record<string, Ref> = depth === node.depth ? { ...node.children } : { [sample[depth]]: root };
  for (const [prefix, group] of Map.groupBy([...changes], ([tag]) => digest(tag)[depth])) {
    const change = new Map(group);
    children[prefix] = children[prefix] ? await patchTree(children[prefix], change, store, depth + 1)
      : await writeTree(group.filter(([, refs]) => refs.length).map(([tag, refs]) => [tag, [...refs]]), store, depth + 1);
    const child = await read(children[prefix], store) as Node;
    if ("entries" in child && !Object.keys(child.entries).length) delete children[prefix];
  }
  return Object.keys(children).length === 1 ? Object.values(children)[0] : put({ depth, children }, store, root);
}

export async function publishStateAuthorityRecords(publications: AsyncIterable<StateRecordPublication>, store: ReaderArtifactStore,
  previous?: StateRecordIndex, onFailure?: (state: string, error: unknown) => void): Promise<StateRecordIndex> {
  const shards = { ...previous?.shards }, seen = new Set<string>();
  const { writeAuthorityIndices, withAuthorityIndexWriter } = await import("./authority-alias-build.ts");
  return withAuthorityIndexWriter(store, async (appendAlias, finishAliases) => {
  for await (const source of publications) {
    seen.add(source.state);
    const old = shards[source.state];
    if (old?.version === source.version) continue;
    try {
      const prior = old ? await read(old, store) as RecordIndex : undefined;
      let root = prior?.root ?? await put({ entries: {} }, store);
      const kinds = new Set(prior?.keyKinds ?? []);
      const locator = await put({ states: [source.state] }, store);
      async function* entries(): AsyncGenerator<readonly [string, string, Ref]> {
        for await (const place of source.places()) {
          const owner = `owner:${place.owner}`;
          const oldRef = prior ? (await lookup(prior.root, [owner], store))[0] : undefined;
          const held = oldRef ? await read(oldRef, store) as Bundle : undefined;
          let ref = oldRef, tags = held?.tags;
          if (!held || held.version !== place.version) {
            const value = await place.load();
            if (sha256OfJson(value.base) !== sha256OfJson(source.base)) throw new Error("READER_PLACE_BASE_CHANGED");
            tags = [...new Set([owner, ...value.records.flatMap(row => row.tags.length ? row.tags : ["shared"])])];
            const metadata = [...new Set(value.records.flatMap(row => row.metadata ?? []))];
            ref = await put({ version: place.version, tags, metadata,
              records: value.records.map(({ metadata: _metadata, ...row }) => row) } satisfies Bundle, store, oldRef);
            const before = new Set(held?.tags ?? []);
            for (const tag of tags) if (needsStateLookup(tag) && !before.has(tag)) await appendAlias("aliases", tag, locator);
          }
          if (!ref || !tags) throw new Error("READER_PLACE_REFERENCE_MISSING");
          for (const tag of tags) kinds.add(keyKind(tag));
          if (source.replace || !prior) { for (const tag of tags) yield ["records", tag, ref]; }
          else if (ref.key !== oldRef?.key) {
            const changes = new Map<string, readonly Ref[]>();
            for (const tag of new Set([...held?.tags ?? [], ...tags])) {
              const refs = (await lookup(root, [tag], store)).filter(row => row.key !== oldRef?.key);
              if (tags.includes(tag)) refs.push(ref);
              changes.set(tag, refs);
            }
            root = await patchTree(root, changes, store);
          }
        }
      }
      const built = await writeAuthorityIndices(entries(), store);
      if (source.replace || !prior) root = built.get("records") ?? await put({ entries: {} }, store);
      const index: RecordIndex = { kind: "READER_PLACE_RECORDS", base: source.base, root, keyKinds: [...kinds], governmentCount: 0 };
      shards[source.state] = { ...await put(index, store, old), version: source.version };
    } catch (error) { if (onFailure) onFailure(source.state, error); else throw error; }
  }
  const changed = (await finishAliases()).get("aliases");
  const aliases = changed ? previous ? await mergeTrees(previous.aliases, changed, store) : changed
    : previous?.aliases ?? await put({ entries: {} }, store);
  for (const state of Object.keys(shards)) if (!seen.has(state)) delete shards[state];
  return { kind: "READER_STATE_RECORDS", shards, aliases, expectedStates: [...seen].sort() };
  });
}

async function readStateRecords(index: StateRecordIndex, store: ReaderArtifactStore, selection?: ReaderSelection): Promise<unknown> {
  if (!selection) throw new Error("READER_PLACE_REQUIRED");
  const states = new Set([...selection.keys].map(stateOfTag).filter((state): state is string => state !== undefined));
  if (!states.size) {
    const refs = await lookup(index.aliases, [...selection.keys].filter(needsStateLookup), store);
    for (const ref of new Map(refs.map(ref => [ref.key, ref])).values())
      for (const state of (await read(ref, store) as { states: string[] }).states) states.add(state);
  }
  if (index.shards.us) states.add("us");
  let base: unknown;
  const patches: AuthorityPatch[] = [];
  for (const state of states) {
    const ref = index.shards[state];
    if (!ref && index.expectedStates.includes(state)) throw new Error("READER_STATE_NOT_PUBLISHED");
    if (!ref) continue;
    const part = await read(ref, store) as RecordIndex;
    base ??= part.base;
    patches.push(...await readRecordPatches(part, store, selection));
  }
  return base === undefined ? null : assembleAuthorityRecords(base, patches, selection);
}

const identityFields = new Set(["id", "ocdId", "contestId", "candidacyId", "personId", "bodyId", "officeholderId", "meetingId", "subjectId", "divisionId", "stateOcdId",
  "alsoServesOcdIds", "divisions", "divisionIds", "candidateKey", "targetKeys", "member", "bioguideId"]);
const mapFields = new Set(["byMember", "cards", "links", "rosterPhotos", "codes"]);
function tagsOf(value: unknown): Set<string> {
  const tags = new Set<string>();
  const visit = (row: unknown, field = "") => {
    if (typeof row === "string" && identityFields.has(field)) tags.add(row);
    else if (Array.isArray(row)) row.forEach(child => visit(child, field));
    else if (row && typeof row === "object") for (const [key, child] of Object.entries(row)) {
      if (["provenance", "fieldSources", "membershipSource", "source", "receipt", "temporal", "acquisition", "evidence", "election", "door", "provider"].includes(key)) continue;
      visit(child, key);
    }
  };
  visit(value);
  const row = value as { state?: string; name?: string; organization?: string; domain?: string; kind?: string } | null;
  if (row && typeof row.state === "string" && (typeof row.organization === "string" || row.kind === "GOVERNMENT" && typeof row.name === "string"))
    tags.add(`government:${row.state.toUpperCase()}:${normalizedGovernmentName(row.name ?? row.organization!)}`);
  if (typeof row?.organization === "string" && typeof row.domain === "string") tags.add(`domain:${row.domain.toLowerCase()}`);
  return tags;
}
const identityNamespaces = new Set(["roster", "congress", "fec", "statewide", "legiscan", "plural", "curated", "government", "domain", "pointer", "container", "inventory", "code", "frame", "owner"]);
const keyKind = (tag: string) => {
  if (tag === "shared") return "shared";
  if (/^\d{5}$/.test(tag)) return "zip";
  if (tag.startsWith("government:US-")) return "government-id";
  if (tag.startsWith("ocd-division/")) return "division";
  if (tag.startsWith("ocd-person/")) return "person";
  const namespace = tag.split(":", 1)[0];
  return identityNamespaces.has(namespace) ? namespace : "native";
};
const digest = (tag: string) => {
  const state = /(?:state|territory|district):([a-z]{2})/i.exec(tag)?.[1] ?? /^government:(?:US-)?([a-z]{2}):/i.exec(tag)?.[1];
  return (state ? Buffer.from(state.toLowerCase()).toString("hex") : "0000") + createHash("sha256").update(tag).digest("hex");
};
interface RecordReadCache {
  readonly values: Map<string, { readonly value: unknown; readonly size: number }>;
  readonly pending: Map<string, Promise<unknown>>;
  bytes: number;
}
const recordReads = new AsyncLocalStorage<RecordReadCache>();
const newRecordReadCache = (): RecordReadCache => ({ values: new Map(), pending: new Map(), bytes: 0 });
async function read(ref: Ref, store: ReaderArtifactStore): Promise<unknown> {
  const held = recordReads.getStore();
  const prior = held?.values.get(ref.key);
  if (prior) return prior.value;
  const pending = held?.pending.get(ref.key);
  if (pending) return pending;
  const loaded = (async () => {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) throw new Error("READER_RECORD_MISSING");
    const json = gunzipSync(bytes);
    const value: unknown = JSON.parse(json.toString("utf8"));
    if (sha256OfJson(value) !== ref.sha) throw new Error("READER_RECORD_HASH_MISMATCH");
    if (held && json.length <= 1024 * 1024) {
      held.values.set(ref.key, { value, size: json.length });
      held.bytes += json.length;
      while (held.bytes > 16 * 1024 * 1024) {
        const [key, entry] = held.values.entries().next().value!;
        held.values.delete(key); held.bytes -= entry.size;
      }
    }
    return value;
  })();
  held?.pending.set(ref.key, loaded);
  try { return await loaded; } finally { held?.pending.delete(ref.key); }
}
async function put(value: unknown, store: ReaderArtifactStore, previous?: Ref): Promise<Ref> {
  const sha = sha256OfJson(value);
  return previous?.sha === sha ? previous : { sha, key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(value))), "json.gz") };
}
async function lookup(root: Ref, tags: readonly string[], store: ReaderArtifactStore): Promise<Ref[]> {
  if (!tags.length) return [];
  const node = await read(root, store) as Node;
  if ("entries" in node) return tags.flatMap(tag => node.entries[tag] ?? []);
  if (!Number.isInteger(node.depth)) throw new Error("READER_INDEX_DEPTH_MISSING");
  const groups = new Map<string, string[]>();
  for (const tag of tags) { const prefix = digest(tag)[node.depth]; const group = groups.get(prefix) ?? []; group.push(tag); groups.set(prefix, group); }
  const result: Ref[] = [];
  const branches = [...groups].filter(([prefix]) => node.children[prefix]);
  for (let at = 0; at < branches.length; at += 8) result.push(...(await Promise.all(branches.slice(at, at + 8)
    .map(([prefix, group]) => lookup(node.children[prefix], group, store)))).flat());
  return result;
}

async function writeTree(rows: [string, readonly Ref[]][], store: ReaderArtifactStore, depth = 0, prior?: Ref): Promise<Ref> {
    if (rows.length <= 64) return put({ entries: Object.fromEntries(rows) }, store, prior);
    const first = digest(rows[0][0]);
    let split = first.length;
    for (const [key] of rows.slice(1)) {
      const hash = digest(key);
      let match = depth;
      while (match < split && hash[match] === first[match]) match++;
      split = match;
      if (split === depth) break;
    }
    if (split === first.length) throw new Error("READER_INDEX_HASH_COLLISION");
    depth = split;
    const old = prior ? await read(prior, store) as Node : null;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) { const prefix = digest(row[0])[depth]; const group = groups.get(prefix) ?? []; group.push(row); groups.set(prefix, group); }
    const children: Record<string, Ref> = {};
    for (const [prefix, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) children[prefix] = await writeTree(group, store, depth + 1, old && "children" in old && old.depth === depth ? old.children[prefix] : undefined);
    return put({ depth, children }, store, prior);
}

export function authorityRecordSource(value: unknown): { readonly records: AuthorityPatch[]; readonly base: unknown; readonly governmentCount: number } {
  const records: AuthorityPatch[] = [];
  const omitted = Symbol();
  let governmentCount = 0;
  const record = (row: unknown, path: Path, extra: readonly string[]) => {
    const key = path.at(-2) === "hunts" ? (row as { key?: string })?.key : undefined;
    const disposition = path.at(-2) === "rosterReaderDispositions" ? row as { sourceId?: string; canonicalId?: string | null } : null;
    records.push({ path, value: row, tags: [...new Set([...tagsOf(row), ...extra,
      ...[disposition?.sourceId, disposition?.canonicalId].filter((id): id is string => typeof id === "string"),
      ...(key && /^(?:ballot-|ocd-|roster:|congress:|fec:|statewide:)/.test(key) ? [key] : [])])] });
  };
  const walk = (row: unknown, path: Path, owner: readonly string[] = []): unknown => {
    if (path.at(-1) === "excludedFacts" && path.at(-2) === "receipt" && path.at(-3) === "projection") return [];
    const keyVotes = row as { selectionVersion?: string; snapshot?: unknown; positions?: { positions: Record<string, Record<string, string>> } } | null;
    if (keyVotes?.selectionVersion === "v1" && keyVotes.positions?.positions) {
      const positions = Object.fromEntries(Object.entries(keyVotes.positions.positions).map(([roll, members]) => {
        for (const [member, position] of Object.entries(members)) record(position, [...path, "positions", "positions", roll, member], [member]);
        return [roll, {}];
      }));
      return { ...keyVotes, positions: { ...keyVotes.positions, positions } };
    }
    if (Array.isArray(row) && path.length === 1 && path[0] === "entries") {
      row.forEach((child, index) => {
        const start = records.length;
        const base = walk(child, [...path, index], owner);
        const pointer = child.kind === "PROMOTED" ? child.projection : child;
        const tag = `pointer:${pointer.recordClass}:${pointer.scope}`;
        for (let at = start; at < records.length; at++) records[at] = { ...records[at], metadata: [...records[at].metadata ?? [], tag] };
        if (child.kind === "PROMOTED" && (base as { attested?: unknown }).attested) (base as { attested: { payloadSha256: string } }).attested.payloadSha256 = "";
        records.push({ path: [...path, index], value: base, tags: [tag], initialize: true });
      });
      return [];
    }
    if (Array.isArray(row) && row.some(child => child && typeof child === "object")) {
      if (path[0] === "governments") governmentCount = row.length;
      row.forEach((child, index) => record(child, [...path, index], [...owner,
        ...(path.at(-1) === "containers" ? [`container:${index}`] : []), ...(path[0] === "governments" ? [`inventory:${Math.floor(index / 50)}`] : [])]));
      return [];
    }
    if (row && typeof row === "object" && !Array.isArray(row)) {
      if (mapFields.has(String(path.at(-1))) && !Object.hasOwn(row, String(path.at(-1))) &&
        Object.values(row).every(child => child && typeof child === "object" || typeof child === "string")) {
        for (const [key, child] of Object.entries(row)) record(child, [...path, key], path.at(-1) === "codes"
          ? [key, ...(child as number[][]).map(entry => `container:${entry[0]}`)] : [key]);
        return {};
      }
      const start = records.length;
      const own = [...owner, ...["officeholderId", "personId", "member"].flatMap(field =>
        typeof (row as Record<string, unknown>)[field] === "string" ? [(row as Record<string, string>)[field]] : [])];
      const result = Object.fromEntries(Object.entries(row).map(([key, child]) => [key, walk(child, [...path, key], own)]).filter(([, child]) => child !== omitted));
      const ballot = row as { election?: unknown; contests?: { ocdId: string }[]; heldContests?: { ocdId: string }[] };
      if (ballot.election && Array.isArray(ballot.contests)) result.districtFamilies = [...new Set(
        [...ballot.contests, ...ballot.heldContests ?? []].map(contest => districtFamilyKey(contest.ocdId)).filter(Boolean))];
      if (path.at(-2) === "ballots") {
        const tag = `frame:${JSON.stringify(path)}`;
        for (let at = start; at < records.length; at++) records[at] = { ...records[at], metadata: [...records[at].metadata ?? [], tag] };
        records.push({ path, value: result, tags: [tag], initialize: true });
        return omitted;
      }
      return result;
    }
    return row;
  };
  const base = walk(value, []);
  return { records, base, governmentCount };
}

export async function publishAuthorityRecords(value: unknown, store: ReaderArtifactStore, previous?: RecordIndex): Promise<RecordIndex> {
  const { records, base, governmentCount } = authorityRecordSource(value);
  const needsDivision = new Set(records.filter(row => !row.tags.some(tag => tag.startsWith("ocd-division/"))).flatMap(row => row.tags));
  const divisions = new Map<string, string>();
  for (const row of records) {
    const division = row.tags.find(tag => tag.startsWith("ocd-division/"))?.split("#")[0];
    if (division) for (const tag of row.tags) {
      if (needsDivision.has(tag)) divisions.set(tag, division);
      if (tag.startsWith("congress:") && needsDivision.has(tag.slice(9))) divisions.set(tag.slice(9), division);
    }
  }
  const groups = new Map<string, AuthorityPatch[]>();
  for (const row of records) {
    const group = row.path[0] === "codes" ? `code:${row.path[1]}` : row.path[0] === "containers" ? `container:${row.path[1]}`
      : row.tags.find(tag => tag.startsWith("ocd-division/"))?.split("#")[0] ?? row.tags.map(tag => divisions.get(tag)).find(Boolean)
      ?? row.tags[0] ?? "shared";
    const bucket = groups.get(group) ?? []; bucket.push(row); groups.set(group, bucket);
  }
  const positions = new Map<string, MemberVote[]>();
  for (const row of records) if (row.path.at(-2) === "positions" && typeof (row.value as MemberVote)?.voteId === "string") {
    const key = JSON.stringify(row.path.slice(0,-2));
    const group = positions.get(key) ?? []; group.push(row.value as MemberVote); positions.set(key,group);
  }
  const voters = new Map([...positions].map(([key, rows]) => [key,partyVotersByVote(rows)]));
  const voteHeaders = new Map(records.filter(row => ["votes","rollCalls"].includes(String(row.path.at(-2))) && typeof (row.value as {id?:unknown})?.id === "string")
    .map(row => {
      const key = JSON.stringify(row.path.slice(0,-2));
      const id = (row.value as {id:string}).id;
      const group = voters.get(key)?.get(id);
      return [`${key}:${id}`, group ? {...row,value:{...row.value as object,readerPartyVoters:group}} : row] as const;
    }));
  const entries: Record<string, Ref[]> = {};
  for (const [group, patches] of groups) {
    const old = previous ? (await lookup(previous.root, [group], store))[0] : undefined;
    const bundled = patches.map(row => ["votes","rollCalls"].includes(String(row.path.at(-2)))
      ? voteHeaders.get(`${JSON.stringify(row.path.slice(0,-2))}:${(row.value as {id:string}).id}`) ?? row : row);
    const paths = new Set(patches.map(row => JSON.stringify(row.path)));
    for (const row of patches) {
      const position = row.value as {voteId?:string;rollCallId?:string};
      const voteId = row.path.at(-2) === "positions" ? position?.voteId ?? position?.rollCallId : undefined;
      const header = voteId ? voteHeaders.get(`${JSON.stringify(row.path.slice(0,-2))}:${voteId}`) : undefined;
      if (header && !paths.has(JSON.stringify(header.path))) {
        paths.add(JSON.stringify(header.path));
        // Indexing the copied description would select other members who share the vote.
        bundled.push({ ...header, tags: [] });
      }
    }
    const metadata = [...new Set(bundled.flatMap(row => row.metadata ?? []))];
    const rows = bundled.map(({ metadata: _metadata, ...row }) => row);
    const ref = await put({ metadata, records: rows } satisfies Bundle, store, old);
    const tags = new Set([group, ...patches.flatMap(row => row.path[0] === "codes" ? [String(row.path[1])] : row.tags.length ? row.tags : ["shared"])]);
    for (const tag of tags) (entries[tag] ??= []).push(ref);
  }
  const directory = value as { directory?: unknown; roster?: { officeholders: { id: string; partyLabel: string | null }[] } } | null;
  const parties = directory?.directory && directory.roster?.officeholders
    ? Object.fromEntries(directory.roster.officeholders.map(holder => [holder.id, holder.partyLabel])) : undefined;
  return { kind: "READER_PLACE_RECORDS", base, root: await writeTree(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)), store, 0, previous?.root), governmentCount, keyKinds: [...new Set(Object.keys(entries).map(keyKind))], ...(parties ? { parties } : {}) };
}

export async function readAuthorityRecords(index: RecordIndex | StateRecordIndex, store: ReaderArtifactStore, selection?: ReaderSelection): Promise<unknown> {
  return recordReads.run(newRecordReadCache(), () => readSelectedAuthorityRecords(index, store, selection));
}

async function readSelectedAuthorityRecords(index: RecordIndex | StateRecordIndex, store: ReaderArtifactStore, selection?: ReaderSelection): Promise<unknown> {
  if (index.kind === "READER_STATE_RECORDS") return readStateRecords(index, store, selection);
  if (index.kind !== "READER_PLACE_RECORDS") throw new Error("READER_RECORD_INDEX_INVALID");
  return assembleAuthorityRecords(index.base, await readRecordPatches(index, store, selection), selection, index.governmentCount, index.parties);
}

async function readRecordPatches(index: RecordIndex, store: ReaderArtifactStore, selection?: ReaderSelection): Promise<AuthorityPatch[]> {
  const keys = new Set([...selection?.keys ?? []].filter(key => index.keyKinds.includes(keyKind(key))));
  if (index.keyKinds.includes("shared")) keys.add("shared");
  const window = selection?.governmentWindow;
  if (window) { for (let i = window[0]; i < window[0] + window[1]; i += 1) keys.add(`inventory:${Math.floor(i / 50)}`); }
  const queried = new Set<string>(), loaded = new Set<string>();
  const patches: AuthorityPatch[] = [];
  if (!selection) {
    const all = async (root: Ref): Promise<Ref[]> => {
      const node = await read(root, store) as Node;
      if ("entries" in node) return Object.values(node.entries).flat();
      const refs: Ref[] = [];
      for (const child of Object.values(node.children)) refs.push(...await all(child));
      return refs;
    };
    for (const ref of await all(index.root)) if (!loaded.has(ref.key)) { loaded.add(ref.key); const bundle = await read(ref, store) as Bundle;
      patches.push(...bundle.records); }
  } else while (true) {
    const tags = [...keys].filter(tag => !queried.has(tag));
    if (!tags.length) break;
    tags.forEach(tag => queried.add(tag));
    const refs = await lookup(index.root, tags, store);
    for (let at = 0; at < refs.length; at += 8) {
      const batch = refs.slice(at, at + 8).filter(ref => { if (loaded.has(ref.key)) return false; loaded.add(ref.key); return true; });
      const bundles = await Promise.all(batch.map(ref => read(ref, store) as Promise<Bundle>));
      for (const bundle of bundles) for (const tag of bundle.metadata) keys.add(tag);
      const rows = bundles.flatMap(bundle => bundle.records);
      patches.push(...rows);
      for (const row of rows) {
        if (row.path[0] === "containers" || row.path.some(field => ["rollCalls", "votes", "profiles", "snapshots", "statements"].includes(String(field)))) continue;
        for (const tag of row.tags) {
          if (row.path[0] === "codes" && !tag.startsWith("container:")) continue;
          if (tag.startsWith("ocd-division/") && !tag.includes("#")) continue;
          if (row.path[0] === "codes") keys.add(tag);
        }
      }
    }
  }
  if (selection) for (const key of keys) selection.keys.add(key);
  return patches;
}

export function assembleAuthorityRecords(base: unknown, patches: readonly AuthorityPatch[], selection?: ReaderSelection,
  governmentCount?: number, parties?: Readonly<Record<string, string | null>>): unknown {
  const out = structuredClone(base) as Record<string | number, unknown>;
  const window = selection?.governmentWindow;
  if (window) out.governmentCount = governmentCount ?? out.governmentCount ?? 0;
  if (selection && parties) out.partyLabels = parties;
  for (const { path, value } of patches.filter(row => row.initialize).sort((a, b) => a.path.length - b.path.length)) {
    let parent = out;
    for (const [at, key] of path.slice(0, -1).entries()) parent = (parent[key] ??= typeof path[at + 1] === "number" ? [] : {}) as Record<string | number, unknown>;
    parent[path.at(-1)!] ??= structuredClone(value);
  }
  for (const { path, value, initialize } of patches) {
    if (initialize) continue;
    if (window && path[0] === "governments" && (Number(path[1]) < window[0] || Number(path[1]) >= window[0] + window[1])) continue;
    let parent = out;
    for (const [at, key] of path.slice(0, -1).entries()) parent = (parent[key] ??= typeof path[at + 1] === "number" ? [] : {}) as Record<string | number, unknown>;
    parent[path.at(-1)!] = value;
  }
  if (selection && Array.isArray(out.containers) && out.codes && typeof out.codes === "object") {
    const containers = out.containers;
    const positions = new Map(Object.keys(containers).map((key, index) => [Number(key), index]));
    out.containers = Object.keys(containers).map(key => containers[Number(key)]);
    out.codes = Object.fromEntries(Object.entries(out.codes).map(([key, rows]) => [key,
      (rows as (readonly [number, boolean, number | null])[]).map(([index, whole, fraction]) => {
        const position = positions.get(index);
        if (position === undefined) throw new Error("READER_CONTAINER_MISSING");
        return [position, whole, fraction];
      })]));
  }
  const compact = (row: unknown, field = ""): unknown => {
    if (Array.isArray(row)) return Object.keys(row).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(key => compact(Reflect.get(row, key)));
    if (row && typeof row === "object") return Object.fromEntries(Object.entries(row)
      .filter(([key]) => selection || key !== "districtFamilies" && key !== "readerPartyVoters")
      .filter(([, child]) => !selection || field !== "ballots" || (child as { contests?: unknown[] })?.contests?.length || (child as { heldContests?: unknown[] })?.heldContests?.length)
      .map(([key, child]) => [key, compact(child, key)]));
    return row;
  };
  if (selection) for (const row of patches) for (const tag of row.tags) {
    selection.keys.add(tag);
    if (tag.startsWith("congress:")) selection.keys.add(tag.slice(9));
  }
  const result = compact(out);
  const domainCounts = (value: unknown) => {
    const snapshot = value as { domains?: { type: string }[]; counts?: { byType?: unknown; domains?: number; electionDomains?: number } } | null;
    if (!selection || !Array.isArray(snapshot?.domains) || !snapshot.counts?.byType) return;
    const byType: Record<string, number> = {};
    for (const row of snapshot.domains) byType[row.type] = (byType[row.type] ?? 0) + 1;
    snapshot.counts = { ...snapshot.counts, domains: snapshot.domains.length,
      electionDomains: snapshot.domains.filter(row => /election/i.test(row.type)).length, byType };
  };
  domainCounts(result);
  if (result && typeof result === "object" && "entries" in result) {
    for (const entry of (result as { entries: { kind: string; projection?: { payload: unknown }; attested?: { payloadSha256: string } }[] }).entries) {
      if (entry.kind === "PROMOTED" && entry.projection && entry.attested) {
        domainCounts(entry.projection.payload);
        entry.attested.payloadSha256 = promotedPayloadSha256(entry.projection.payload);
      }
    }
  }
  return result;
}
