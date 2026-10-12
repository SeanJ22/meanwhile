import { createHash } from "node:crypto";

const INLINE_BYTES = 32 * 1024;
const PART_BYTES = 256 * 1024;
const REF = "$civicPayloadPart";
type Ref = { readonly $civicPayloadPart: string };
type Part = { readonly hash: string; readonly payload: unknown };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ref = (value: unknown): value is Ref => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Ref)[REF] === "string";

function territory(value: unknown): string {
  if (value === null || typeof value !== "object") return "shared";
  const row = value as Record<string, unknown>;
  for (const key of ["id", "key", "divisionId", "ocdId", "jurisdiction", "state", "subjectId"]) {
    const text = row[key];
    if (typeof text !== "string") continue;
    const state = /(?:\/state:|\bUS-)([a-z]{2})(?:\b|\/)/i.exec(text)?.[1];
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
            // Ordering stays outside state partitions, so adding one state never rewrites another state's rows.
      return put({ kind: "array", groups: all.map(rows => put(rows)), order: encode(JSON.stringify(order)) });
    }
    const encoded = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, encode(child)]));
    return put({ kind: "object", value: encoded });
  };
    // Omits optional undefined properties exactly as the jsonb driver does, so hashes stay unchanged.
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

  async load(input: unknown): Promise<unknown> {
    const needed = new Set<string>();
    const collect = (value: unknown): void => {
      if (ref(value)) { if (!this.cache.has(value[REF])) needed.add(value[REF]); }
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(input);
    while (needed.size) {
      const hashes = [...needed].slice(0, 8);
      hashes.forEach(hash => needed.delete(hash));
      const found = await this.io.read(hashes);
      for (const part of found) { this.cache.set(part.hash, part.payload); collect(part.payload); }
      if (hashes.some(hash => !this.cache.has(hash))) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
    }
    const decode = (value: unknown): unknown => {
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
      if (ref(value)) { const part = this.cache.get(value[REF]); if (part !== undefined) { collect(part); walkCached(part); } }
      else if (Array.isArray(value)) value.forEach(walkCached);
      else if (value && typeof value === "object") Object.values(value).forEach(walkCached);
    };
    walkCached(input);
    if (needed.size) return this.load(input);
    return decode(input);
  }
}
