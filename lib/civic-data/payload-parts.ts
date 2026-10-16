import { createHash } from "node:crypto";

const INLINE_BYTES = 32 * 1024;
const PART_BYTES = 256 * 1024;
const REF = "$civicPayloadPart";
type Ref = { readonly $civicPayloadPart: string };
type Part = { readonly hash: string; readonly payload: unknown };
const OMIT = Symbol("omitted JSON member");
type JsonNode = { original: unknown; value: unknown; converted: boolean; children?: Map<string, JsonNode>; keys?: string[]; length?: number; size?: number; durable?: unknown; territory?: string };

function jsonNode(original: unknown, key: string): JsonNode {
  let value = original, converted = false;
  if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") { value = toJSON.call(value, key); converted = true; }
  }
  if (value instanceof Number) value = Number(value);
  if (value instanceof String) value = String(value);
  if (value instanceof Boolean) value = Boolean.prototype.valueOf.call(value);
  if (Object.prototype.toString.call(value) === "[object BigInt]") value = BigInt.prototype.valueOf.call(value);
  if (typeof value === "bigint") throw new TypeError("A civic payload cannot contain a BigInt.");
  if (value === undefined || typeof value === "function" || typeof value === "symbol") value = OMIT;
  if (typeof value === "number") value = Number.isFinite(value) ? value === 0 ? 0 : value : null;
  return { original, value, converted };
}

function childNode(node: JsonNode, key: string): JsonNode {
  node.children ??= new Map();
  let child = node.children.get(key);
  if (!child) { child = jsonNode((node.value as Record<string, unknown>)[key], key); node.children.set(key, child); }
  return child;
}

function stringBytes(value: string, limit: number): number {
  let size = 2;
  for (let index = 0; index < value.length && size <= limit; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) size += 2;
    else if (code < 32) size += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) size++;
    else if (code < 2048) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { size += 4; index++; } else size += 6;
    } else size += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
  }
  return size;
}

function probe(node: JsonNode, limit: number, parents: Set<object>): number {
  if (node.size !== undefined) return node.size;
  const value = node.value;
  if (value === null || typeof value !== "object") {
    const size = typeof value === "string" ? stringBytes(value, limit) : Buffer.byteLength(JSON.stringify(value));
    if (size <= limit) { node.size = size; node.durable = value; }
    return size;
  }
  if (parents.has(value)) throw new TypeError("A civic payload cannot contain a circular structure.");
  parents.add(value);
  try {
    let size = 2, changed = node.converted || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype);
    const entries: [string, unknown][] = [];
    const keys = Array.isArray(value) ? null : node.keys ??= Object.keys(value);
    const length = keys?.length ?? (node.length ??= (value as unknown[]).length);
    for (let index = 0; index < length; index++) {
      const key = keys ? keys[index] : String(index), child = childNode(node, key);
      if (child.value === OMIT) {
        changed = true;
        if (keys) continue;
        child.value = null;
      }
      if (entries.length) size++;
      if (keys) size += stringBytes(key, limit - size) + 1;
      if (size > limit) return size;
      size += probe(child, limit - size, parents);
      if (size > limit) return size;
      entries.push([key, child.durable]);
      if (!Object.is(child.original, child.durable)) changed = true;
      if (Object.getOwnPropertyDescriptor(value, key)?.get) changed = true;
    }
    node.size = size;
    node.durable = changed ? keys ? Object.fromEntries(entries) : entries.map(([, child]) => child) : value;
    node.territory = territory(node.durable);
    node.children = undefined;
    return size;
  } finally { parents.delete(value); }
}

function jsonTokens(value: unknown, write: (token: string) => void): void {
  if (value === null || typeof value !== "object") { write(JSON.stringify(value)); return; }
  if (Array.isArray(value)) {
    write("[");
    for (let index = 0; index < value.length; index++) { if (index) write(","); jsonTokens(value[index], write); }
    write("]");
  } else {
    write("{"); let first = true;
    for (const key of Object.keys(value)) {
      if (!first) write(","); first = false;
      write(JSON.stringify(key)); write(":"); jsonTokens((value as Record<string, unknown>)[key], write);
    }
    write("}");
  }
}

const bytes = (value: unknown): number => {
  let size = 0; jsonTokens(value, token => { size += Buffer.byteLength(token); }); return size;
};
const digest = (value: unknown): string => {
  const hash = createHash("sha256"); let buffered = "";
  jsonTokens(value, token => {
    if (buffered.length + token.length > 65_536) { hash.update(buffered); buffered = ""; }
    buffered += token;
  });
  return hash.update(buffered).digest("hex");
};
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
  const parents = new Set<object>();
  const encode = (node: JsonNode, inline = false): unknown => {
    if (probe(node, INLINE_BYTES, parents) <= INLINE_BYTES) return node.durable;
    const value = node.value;
    if (typeof value === "string") {
      if (inline) return value;
      const chunks: string[] = [];
      for (let index = 0; index < value.length; index += INLINE_BYTES / 4) chunks.push(value.slice(index, index + INLINE_BYTES / 4));
      return put({ kind: "string", chunks: chunks.map(chunk => put(chunk)) });
    }
    parents.add(value as object);
    try { if (Array.isArray(value)) {
      const groups = new Map<string, { rows: unknown[]; size: number; index: number }>();
      const all: unknown[][] = [];
      const order: number[] = [];
      const inlineRows: unknown[] = [];
      for (let index = 0; index < node.length!; index++) {
        const child = childNode(node, String(index));
        if (child.value === OMIT) child.value = null;
        const encoded = encode(child, inline), key = child.territory ?? "shared";
        node.children?.delete(String(index));
        if (inline) { inlineRows.push(encoded); continue; }
        const size = bytes(encoded);
        let group = groups.get(key);
        if (!group || group.size + size > PART_BYTES) {
          group = { rows: [], size: 0, index: all.length };
          groups.set(key, group); all.push(group.rows);
        }
        group.rows.push(encoded); group.size += size; order.push(group.index);
      }
      if (inline) return inlineRows;
      // Ordering stays outside state partitions, so adding one state never rewrites another state's rows.
      return put({ kind: "array", groups: all.map(rows => put(rows)), order: encode(jsonNode(`[${order.join(",")}]`, "order")) });
    }
    const encoded: Record<string, unknown> = {}, scope: Record<string, unknown> = {};
    for (const key of node.keys!) {
      const child = childNode(node, key);
      if (child.value !== OMIT) {
        Object.defineProperty(encoded, key, { value: encode(child, inline), enumerable: true, configurable: true, writable: true });
        if (["id", "key", "divisionId", "ocdId", "jurisdiction", "state", "subjectId"].includes(key)) scope[key] = child.value;
        if (["value", "row", "record", "after", "before", "holder"].includes(key)) scope[key] = { state: child.territory };
      }
      node.children?.delete(key);
    }
    node.territory = territory(scope);
    return inline ? encoded : put({ kind: "object", value: encoded });
    } finally { parents.delete(value as object); }
  };
  const root = jsonNode(input, "");
  if (root.value === OMIT) throw new TypeError("A civic payload needs a JSON value.");
  const keys = inlineFields && Array.isArray(root.value) ? Array.from({ length: root.value.length }, (_, index) => String(index)) : null;
  const value = inlineFields ? Object.fromEntries((keys ?? Object.keys(root.value as object)).flatMap(key => {
    const child = childNode(root, key);
    if (keys && child.value === OMIT) child.value = null;
    return child.value === OMIT ? [] : [[key, encode(child, inlineFields.includes(key))]];
  })) : encode(root);
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
