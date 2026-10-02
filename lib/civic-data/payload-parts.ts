import { createHash } from "node:crypto";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";

const INLINE_BYTES = 32 * 1024;
const PART_BYTES = 256 * 1024;
const REF = "$civicPayloadPart";
const AREA = "$civicRegistryAreas";
const VIEW = "$civicRegistryView";
type Ref = { readonly $civicPayloadPart: string };
type Part = { readonly hash: string; readonly payload: unknown };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ref = (value: unknown): value is Ref => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Ref)[REF] === "string";

type AreaRows = Pick<RegistryRuntimeReadModel, "bodyRosters" | "rosterReaderDispositions" | "statewideExecutives" | "officialCandidacies" | "officialPhotos" | "rosterPhotos"> & {
  readonly registry: Pick<RegistryRuntimeReadModel["registry"], "divisions" | "bodies">;
};
type AreaEntry = { readonly part: Ref; readonly sha256: string };
type AreaIndex = Readonly<Record<string, AreaEntry>>;
interface RegistryAreaManifest {
  readonly header: { readonly formatVersion: 1; readonly generatedAt: string; readonly candidacyFormatVersion: 1; readonly candidacyRule: RegistryRuntimeReadModel["officialCandidacies"]["rule"] };
  readonly states: Readonly<Record<string, Ref>>;
}
interface RegistryAreaView {
  readonly manifest: RegistryAreaManifest;
  readonly indexes: Readonly<Record<string, AreaIndex>>;
  readonly selection: readonly string[];
}
type RegistryViewPayload = RegistryRuntimeReadModel & { readonly $civicRegistryView: RegistryAreaView };
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : value;
const stateOfArea = (area: string) => /\/(?:state|district|territory):([a-z]{2})(?:\b|\/)/i.exec(area)?.[1]?.toUpperCase() ?? "shared";
export const hasRegistryAreaEncoding = (value: unknown): boolean => Boolean(value && typeof value === "object" && AREA in value);
export function registryAreaViewOf(value: unknown): RegistryAreaView | null {
  return value && typeof value === "object" && VIEW in value ? (value as RegistryViewPayload)[VIEW] : null;
}
export function registryAreaHasInheritedParts(value: unknown): boolean {
  const view = registryAreaViewOf(value);
  if (!view) return false;
  const selected = new Set(view.selection);
  return Object.keys(view.manifest.states).some(state => !(state in view.indexes)) ||
    Object.values(view.indexes).some(index => Object.keys(index).some(area => !selected.has(area)));
}
const emptyArea = (): AreaRows => ({ registry: { divisions: [], bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [],
  officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} });

/** Actual division ownership, including holder joins whose IDs contain no geography. */
function registryAreas(payload: RegistryRuntimeReadModel): Map<string, AreaRows> {
  const areas = new Map<string, AreaRows>();
  const rows = (key: string) => { let value = areas.get(key); if (!value) { value = emptyArea(); areas.set(key, value); } return value; };
  const bodies = new Map(payload.registry.bodies.map(body => [body.id, body.ocdId ?? body.id.split("#")[0]]));
  const holders = new Map<string, string>();
  for (const roster of payload.bodyRosters) for (const holder of roster.members) holders.set(holder.id, bodies.get(roster.bodyId) ?? "shared");
  for (const executive of payload.statewideExecutives) holders.set(executive.holder.id, executive.stateOcdId);
  for (const row of payload.officialCandidacies.rows) if (!holders.has(row.holder.id)) holders.set(row.holder.id, row.holder.divisions[0] ?? "shared");
  for (const division of payload.registry.divisions) rows(division.ocdId).registry.divisions.push(division);
  for (const body of payload.registry.bodies) rows(bodies.get(body.id)!).registry.bodies.push(body);
  for (const roster of payload.bodyRosters) (rows(bodies.get(roster.bodyId) ?? "shared").bodyRosters as typeof payload.bodyRosters[number][]).push(roster);
  for (const disposition of payload.rosterReaderDispositions) (rows(holders.get(disposition.canonicalId ?? disposition.sourceId) ?? holders.get(disposition.sourceId) ?? "shared").rosterReaderDispositions as typeof disposition[]).push(disposition);
  for (const executive of payload.statewideExecutives) (rows(executive.stateOcdId).statewideExecutives as typeof executive[]).push(executive);
  for (const row of payload.officialCandidacies.rows) (rows(holders.get(row.holder.id) ?? "shared").officialCandidacies.rows as typeof row[]).push(row);
  for (const photo of payload.officialPhotos.photos) (rows(holders.get(photo.officeholderId) ?? "shared").officialPhotos.photos as typeof photo[]).push(photo);
  for (const [id, url] of Object.entries(payload.rosterPhotos)) (rows(holders.get(id) ?? "shared").rosterPhotos as Record<string, string>)[id] = url;
  return areas;
}

function areaPlan(rows: AreaRows): { readonly entry: AreaEntry; readonly parts: readonly Part[] } {
  const durable = ordered(rows);
  const plan = partitionCivicPayload(durable);
  const part = { hash: digest(plan.value), payload: plan.value };
  return { entry: { part: { [REF]: part.hash }, sha256: digest(durable) }, parts: [...plan.parts, part] };
}

/** Compose selected areas; all unselected immutable references survive verbatim. */
export function composeRegistryAreaView(payload: RegistryRuntimeReadModel, prior?: RegistryRuntimeReadModel | null): RegistryViewPayload {
  const held = registryAreaViewOf(prior);
  const areas = registryAreas(payload);
  const selection = held ? [...held.selection] : [...areas.keys()];
  if (held && [...areas.keys()].some(area => !selection.includes(area))) throw new Error("REGISTRY_AREA_OUTSIDE_JOB");
  const indexes: Record<string, Record<string, AreaEntry>> = Object.fromEntries(Object.entries(held?.indexes ?? {}).map(([state, index]) => [state, { ...index }]));
  for (const area of selection) {
    const state = stateOfArea(area);
    (indexes[state] ??= {})[area] = areaPlan(areas.get(area) ?? emptyArea()).entry;
  }
  const states: Record<string, Ref> = { ...held?.manifest.states };
  for (const [state, index] of Object.entries(indexes)) states[state] = { [REF]: digest(ordered(index)) };
  return { ...payload, [VIEW]: { manifest: { header: { formatVersion: payload.formatVersion, generatedAt: payload.registry.generatedAt,
    candidacyFormatVersion: payload.officialCandidacies.formatVersion, candidacyRule: payload.officialCandidacies.rule }, states }, indexes, selection } };
}

/** Canonical JSON binds the stored composition and the facts this view actually materialized. */
export function registryAreaEncoding(value: unknown): unknown | null {
  const view = registryAreaViewOf(value);
  if (!view) return null;
  const payload = value as RegistryRuntimeReadModel;
  const header = view.manifest.header;
  if (payload.formatVersion !== header.formatVersion || payload.registry.generatedAt !== header.generatedAt ||
    payload.officialCandidacies.formatVersion !== header.candidacyFormatVersion || payload.officialCandidacies.rule !== header.candidacyRule) throw new Error("REGISTRY_AREA_VIEW_CHANGED");
  const areas = registryAreas(payload);
  if (new Set(view.selection).size !== view.selection.length || [...areas.keys()].some(area => !view.selection.includes(area))) throw new Error("REGISTRY_AREA_VIEW_CHANGED");
  for (const [state, index] of Object.entries(view.indexes)) {
    if (view.manifest.states[state]?.[REF] !== digest(ordered(index))) throw new Error("REGISTRY_AREA_INDEX_CHANGED");
  }
  for (const area of view.selection) {
    const entry = view.indexes[stateOfArea(area)]?.[area];
    const actual = areaPlan(areas.get(area) ?? emptyArea()).entry;
    // A selected area not yet stored is genuinely empty, not an inherited removal.
    if (!entry ? areas.has(area) : JSON.stringify(ordered(entry)) !== JSON.stringify(ordered(actual))) throw new Error("REGISTRY_AREA_VIEW_CHANGED");
  }
  return { [AREA]: view.manifest };
}

/** Extend the existing unchanged-member inheritance rule to unmaterialized areas. */
export function registryAreaInheritanceIssue(before: unknown, after: unknown): string | null {
  const prior = registryAreaViewOf(before), next = registryAreaViewOf(after);
  if (!prior) return null; // Explicit conversion still checks every native legacy member.
  if (!next || JSON.stringify([...prior.selection].sort()) !== JSON.stringify([...next.selection].sort())) return "The successor changed its selected registry areas.";
  const selected = new Set(next.selection);
  const states = new Set([...Object.keys(prior.manifest.states), ...Object.keys(next.manifest.states)]);
  for (const state of states) {
    if (!(state in next.indexes)) {
      if (JSON.stringify(prior.manifest.states[state]) !== JSON.stringify(next.manifest.states[state])) return "An unselected state's registry reference changed.";
      continue;
    }
    const left = prior.indexes[state] ?? {}, right = next.indexes[state];
    for (const area of new Set([...Object.keys(left), ...Object.keys(right)])) if (!selected.has(area) &&
      JSON.stringify(ordered(left[area])) !== JSON.stringify(ordered(right[area]))) return "An unselected area's registry reference changed.";
  }
  return null;
}

/** Prefer a record's actual territory; no geographic or person-name inference. */
function territory(value: unknown): string {
  if (value === null || typeof value !== "object") return "shared";
  const row = value as Record<string, unknown>;
  for (const key of ["id", "key", "divisionId", "ocdId", "jurisdiction", "state", "subjectId"]) {
    const text = row[key];
    if (typeof text !== "string") continue;
    const areaState = stateOfArea(text);
    if (areaState !== "shared") return areaState;
    const state = /\bUS-([a-z]{2})(?:\b|\/)/i.exec(text)?.[1];
    if (state) return state.toUpperCase();
    if (key === "state" && /^[a-z]{2}$/i.test(text)) return text.toUpperCase();
  }
  for (const key of ["value", "row", "record", "after", "before", "holder"]) {
    const state = territory(row[key]);
    if (state !== "shared") return state;
  }
  return "shared";
}

/** Storage encoding only. Readers reconstruct the exact JSON they already verify. */
export function partitionCivicPayload(input: unknown, inlineFields?: readonly string[]): { readonly value: unknown; readonly parts: readonly Part[] } {
  const parts = new Map<string, Part>();
  const put = (payload: unknown): Ref => {
    const hash = digest(payload);
    parts.set(hash, { hash, payload });
    return { [REF]: hash };
  };
  const encode = (value: unknown): unknown => {
    const areaView = registryAreaViewOf(value);
    if (areaView) {
      const encoding = registryAreaEncoding(value)!;
      const areas = registryAreas(value as RegistryRuntimeReadModel);
      for (const area of areaView.selection) for (const part of areaPlan(areas.get(area) ?? emptyArea()).parts) parts.set(part.hash, part);
      for (const index of Object.values(areaView.indexes)) { const payload = ordered(index); parts.set(digest(payload), { hash: digest(payload), payload }); }
      return encoding;
    }
    if (value === null || typeof value !== "object" && typeof value !== "string" || bytes(value) <= INLINE_BYTES) return value;
    if (typeof value === "string") {
      const chunks: string[] = [];
      for (let index = 0; index < value.length; index += INLINE_BYTES / 4) chunks.push(value.slice(index, index + INLINE_BYTES / 4));
      return put({ kind: "string", chunks: chunks.map(chunk => put(chunk)) });
    }
    if (Array.isArray(value)) {
      const groups = new Map<string, { rows: unknown[]; size: number; index: number }>();
      const all: unknown[][] = [];
      const order: number[] = [];
      for (const row of value) {
        const key = territory(row);
        const encoded = encode(row);
        const size = bytes(encoded);
        let group = groups.get(key);
        if (!group || group.size + size > PART_BYTES) {
          group = { rows: [], size: 0, index: all.length };
          groups.set(key, group); all.push(group.rows);
        }
        group.rows.push(encoded); group.size += size; order.push(group.index);
      }
      // Keep ordering outside state partitions: inserting Ohio never rewrites
      // Arizona rows merely because their national array positions changed.
      return put({ kind: "array", groups: all.map(rows => put(rows)), order: encode(JSON.stringify(order)) });
    }
    const encoded = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, encode(child)]));
    return put({ kind: "object", value: encoded });
  };
  // Durable JSON serialization omits optional undefined properties exactly as
  // the existing jsonb driver does; hashes/reader values remain unchanged.
  const durable = JSON.parse(JSON.stringify(input));
  const value = inlineFields ? Object.fromEntries(Object.entries(durable).map(([key, child]) => [key,
    inlineFields.includes(key) ? child : encode(child),
  ])) : encode(durable);
  return { value, parts: [...parts.values()] };
}

export interface CivicPayloadPartIO {
  readonly existing: (hashes: readonly string[]) => Promise<readonly string[]>;
  readonly write: (parts: readonly Part[]) => Promise<void>;
  readonly read: (hashes: readonly string[]) => Promise<readonly Part[]>;
}

/** Same immutable part serves payload, normalized evidence and every later candidate. */
export class CivicPayloadParts {
  private readonly cache = new Map<string, unknown>();
  private readonly io: CivicPayloadPartIO;
  constructor(io: CivicPayloadPartIO) { this.io = io; }

  async store(input: unknown, inlineFields?: readonly string[]): Promise<unknown> {
    const plan = partitionCivicPayload(input, inlineFields);
    const known = new Set<string>();
    for (let offset = 0; offset < plan.parts.length; offset += 512) {
      for (const hash of await this.io.existing(plan.parts.slice(offset, offset + 512).map(part => part.hash))) known.add(hash);
    }
    let batch: Part[] = [];
    let size = 0;
    for (const part of plan.parts) {
      this.cache.set(part.hash, part.payload);
      if (known.has(part.hash)) continue;
      const nextSize = bytes(part);
      if (batch.length && size + nextSize > 2 * 1024 * 1024) { await this.io.write(batch); batch = []; size = 0; }
      batch.push(part); size += nextSize;
    }
    if (batch.length) await this.io.write(batch);
    return plan.value;
  }

  async load(input: unknown, registrySelection?: readonly string[]): Promise<unknown> {
    const needed = new Set<string>();
    const collect = (value: unknown): void => {
      if (value && typeof value === "object" && AREA in value) return;
      if (ref(value)) { if (!this.cache.has(value[REF])) needed.add(value[REF]); }
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(input);
    // One part is bounded. Fetch batches also stay well below Neon's response cap.
    while (needed.size) {
      const hashes = [...needed].slice(0, 8);
      hashes.forEach(hash => needed.delete(hash));
      const found = await this.io.read(hashes);
      for (const part of found) { this.cache.set(part.hash, part.payload); collect(part.payload); }
      if (hashes.some(hash => !this.cache.has(hash))) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
    }
    const decode = (value: unknown): unknown => {
      if (value && typeof value === "object" && AREA in value) return value;
      if (ref(value)) {
        const part = this.cache.get(value[REF]);
        if (part === undefined) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
        if (part === null || typeof part !== "object" || Array.isArray(part)) return decode(part);
        const node = part as { kind?: string; chunks?: unknown[]; groups?: unknown[]; order?: unknown; value?: unknown };
        if (node.kind === "string") return node.chunks!.map(decode).join("");
        if (node.kind === "object") return decode(node.value);
        if (node.kind === "array") {
          const groups = node.groups!.map(group => decode(group) as unknown[]);
          const positions = groups.map(() => 0);
          return (JSON.parse(decode(node.order) as string) as number[]).map(group => groups[group][positions[group]++]);
        }
        return decode(part);
      }
      if (Array.isArray(value)) return value.map(decode);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
      return value;
    };
    // Cached parents may refer to not-yet-read children on a different read.
    const walkCached = (value: unknown): void => {
      if (value && typeof value === "object" && AREA in value) return;
      if (ref(value)) { const part = this.cache.get(value[REF]); if (part !== undefined) { collect(part); walkCached(part); } }
      else if (Array.isArray(value)) value.forEach(walkCached);
      else if (value && typeof value === "object") Object.values(value).forEach(walkCached);
    };
    walkCached(input);
    if (needed.size) return this.load(input, registrySelection);
    const expand = async (value: unknown): Promise<unknown> => {
      if (value && typeof value === "object" && AREA in value) return this.loadRegistryAreas((value as { $civicRegistryAreas: RegistryAreaManifest })[AREA], registrySelection);
      if (Array.isArray(value)) { const rows = []; for (const row of value) rows.push(await expand(row)); return rows; }
      if (value && typeof value === "object") { const rows: Record<string, unknown> = {}; for (const [key, row] of Object.entries(value)) rows[key] = await expand(row); return rows; }
      return value;
    };
    return expand(decode(input));
  }

  private async loadRegistryAreas(manifest: RegistryAreaManifest, requested?: readonly string[]): Promise<RegistryViewPayload> {
    const indexes: Record<string, AreaIndex> = {};
    const states = requested ? new Set(requested.map(stateOfArea)) : new Set(Object.keys(manifest.states));
    for (const state of states) {
      const pointer = manifest.states[state];
      if (!pointer) { indexes[state] = {}; continue; }
      if (!this.cache.has(pointer[REF])) { const [part] = await this.io.read([pointer[REF]]); if (!part) throw new Error("CIVIC_PAYLOAD_PART_MISSING"); this.cache.set(part.hash, part.payload); }
      const index = this.cache.get(pointer[REF]) as AreaIndex;
      if (digest(ordered(index)) !== pointer[REF]) throw new Error("REGISTRY_AREA_INDEX_CHANGED");
      indexes[state] = index;
    }
    const selection = requested ? [...new Set(requested)] : Object.values(indexes).flatMap(index => Object.keys(index));
    const { registry, ...rows } = emptyArea();
    const payload: RegistryRuntimeReadModel = { ...rows, formatVersion: manifest.header.formatVersion,
      registry: { ...registry, generatedAt: manifest.header.generatedAt },
      officialCandidacies: { formatVersion: manifest.header.candidacyFormatVersion, rule: manifest.header.candidacyRule, rows: [] } };
    for (const area of selection) {
      const entry = indexes[stateOfArea(area)]?.[area];
      if (!entry) continue;
      const rows = await this.load(entry.part) as AreaRows;
      if (digest(ordered(rows)) !== entry.sha256) throw new Error("REGISTRY_AREA_VIEW_CHANGED");
      payload.registry.divisions.push(...rows.registry.divisions); payload.registry.bodies.push(...rows.registry.bodies);
      (payload.bodyRosters as typeof rows.bodyRosters[number][]).push(...rows.bodyRosters);
      (payload.rosterReaderDispositions as typeof rows.rosterReaderDispositions[number][]).push(...rows.rosterReaderDispositions);
      (payload.statewideExecutives as typeof rows.statewideExecutives[number][]).push(...rows.statewideExecutives);
      (payload.officialCandidacies.rows as typeof rows.officialCandidacies.rows[number][]).push(...rows.officialCandidacies.rows);
      (payload.officialPhotos.photos as typeof rows.officialPhotos.photos[number][]).push(...rows.officialPhotos.photos);
      Object.assign(payload.rosterPhotos, rows.rosterPhotos);
    }
    return { ...payload, [VIEW]: { manifest, indexes, selection } };
  }
}
