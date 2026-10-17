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

export const civicPayloadBytes = (value: unknown): number => {
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
export const isCivicPayloadPart = (value: unknown): value is Ref => value !== null && typeof value === "object" &&
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
export function partitionCivicPayload(input: unknown, inlineFields?: readonly string[], referencedFields?: readonly string[]): { readonly value: unknown; readonly parts: readonly Part[] } {
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
        const size = civicPayloadBytes(encoded);
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
  const keys = (inlineFields || referencedFields) && Array.isArray(root.value) ? Array.from({ length: root.value.length }, (_, index) => String(index)) : null;
  const value = inlineFields || referencedFields ? Object.fromEntries((keys ?? Object.keys(root.value as object)).flatMap(key => {
    const child = childNode(root, key);
    if (keys && child.value === OMIT) child.value = null;
    if (child.value === OMIT) return [];
    const encoded = encode(child, inlineFields?.includes(key));
    return [[key, referencedFields?.includes(key) && !isCivicPayloadPart(encoded) ? put({ kind: "object", value: encoded }) : encoded]];
  })) : encode(root);
  return { value, parts: [...parts.values()] };
}
