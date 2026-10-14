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

type Node = { kind?: string; chunks?: unknown[]; groups?: unknown[]; order?: unknown; value?: unknown };

/** The refs directly inside a value, not inside the parts they name. */
function refsIn(value: unknown, into: Set<string>): Set<string> {
  if (ref(value)) into.add(value[REF]);
  else if (Array.isArray(value)) for (const child of value) refsIn(child, into);
  else if (value && typeof value === "object") for (const child of Object.values(value)) refsIn(child, into);
  return into;
}

/* Parts are immutable by hash, so the most recently read are kept, up to a fixed size. */
const CACHED_PART_BYTES = 64 * 1024 * 1024;

export class CivicPayloadParts {
  private readonly io: CivicPayloadPartIO;
  private readonly cached = new Map<string, { readonly payload: unknown; readonly size: number }>();
  private cachedBytes = 0;
  constructor(io: CivicPayloadPartIO) { this.io = io; }

  private remember(part: Part): void {
    const size = bytes(part.payload);
    if (size > CACHED_PART_BYTES / 8 || this.cached.has(part.hash)) return;
    this.cached.set(part.hash, { payload: part.payload, size });
    this.cachedBytes += size;
    for (const [hash, held] of this.cached) {
      if (this.cachedBytes <= CACHED_PART_BYTES) break;
      this.cached.delete(hash); this.cachedBytes -= held.size;
    }
  }

  private async read(hashes: readonly string[]): Promise<readonly Part[]> {
    const hit = hashes.flatMap(hash => {
      const held = this.cached.get(hash);
      if (!held) return [];
      this.cached.delete(hash); this.cached.set(hash, held);
      return [{ hash, payload: held.payload }];
    });
    const missing = hashes.filter(hash => !this.cached.has(hash));
    const read = missing.length ? await this.io.read(missing) : [];
    read.forEach(part => this.remember(part));
    return [...hit, ...read];
  }

  async store(input: unknown, inlineFields?: readonly string[]): Promise<unknown> {
    const plan = partitionCivicPayload(input, inlineFields);
    const known = new Set<string>();
    for (let offset = 0; offset < plan.parts.length; offset += 512) {
      for (const hash of await this.io.existing(plan.parts.slice(offset, offset + 512).map(part => part.hash))) known.add(hash);
    }
    let batch: Part[] = [];
    let size = 0;
    for (const part of plan.parts) {
      if (known.has(part.hash)) continue;
      const nextSize = bytes(part);
      if (batch.length && size + nextSize > 2 * 1024 * 1024) { await this.io.write(batch); batch = []; size = 0; }
      batch.push(part); size += nextSize;
    }
    if (batch.length) await this.io.write(batch);
    return plan.value;
  }

  /** Reads parts eight at a time and assembles each as soon as its children are in. */
  async load(input: unknown): Promise<unknown> {
    const decoded = new Map<string, unknown>();
    const build = (value: unknown): unknown => {
      if (ref(value)) {
        if (!decoded.has(value[REF])) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
        return decoded.get(value[REF]);
      }
      if (Array.isArray(value)) return value.map(build);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, build(child)]));
      return value;
    };
    const assemble = (payload: unknown): unknown => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return build(payload);
      const node = payload as Node;
      if (node.kind === "string") return node.chunks!.map(build).join("");
      if (node.kind === "object") return build(node.value);
      if (node.kind === "array") {
        const groups = node.groups!.map(group => build(group) as unknown[]);
        const positions = groups.map(() => 0);
        return (JSON.parse(build(node.order) as string) as number[]).map(group => groups[group][positions[group]++]);
      }
      return build(payload);
    };
    const resolve = async (values: readonly unknown[]): Promise<void> => {
      const hashes = [...values.reduce<Set<string>>((into, value) => refsIn(value, into), new Set())].filter(hash => !decoded.has(hash));
      for (let at = 0; at < hashes.length; at += 8) {
        const wanted = hashes.slice(at, at + 8);
        const parts = await this.read(wanted);
        if (wanted.some(hash => !parts.some(part => part.hash === hash))) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
        await resolve(parts.map(part => part.payload));
        for (const part of parts) decoded.set(part.hash, assemble(part.payload));
      }
    };
    await resolve([input]);
    return build(input);
  }
}
