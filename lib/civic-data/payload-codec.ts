import { createHash } from "node:crypto";

const INLINE_BYTES = 32 * 1024;
const PART_BYTES = 256 * 1024;
const REF = "$civicPayloadPart";
type Ref = { readonly $civicPayloadPart: string };
type Part = { readonly hash: string; readonly payload: unknown };
const OMIT = Symbol("omitted JSON member");
const ID_KEYS = ["id", "key", "divisionId", "ocdId", "jurisdiction", "state", "subjectId"];
const NESTED_KEYS = ["value", "row", "record", "after", "before", "holder"];

/** The value JSON.stringify would write for `original` under `key`, or OMIT. */
function jsonValue(original: unknown, key: string): unknown {
  let value = original;
  if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, key);
  }
  if (value instanceof Number) value = Number(value);
  if (value instanceof String) value = String(value);
  if (value instanceof Boolean) value = Boolean.prototype.valueOf.call(value);
  if (Object.prototype.toString.call(value) === "[object BigInt]") value = BigInt.prototype.valueOf.call(value);
  if (typeof value === "bigint") throw new TypeError("A civic payload cannot contain a BigInt.");
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return OMIT;
  if (typeof value === "number") return Number.isFinite(value) ? value === 0 ? 0 : value : null;
  return value;
}

function stringBytes(value: string): number {
  let size = 2;
  for (let index = 0; index < value.length; index++) {
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

function stateOf(key: string, text: unknown): string | null {
  if (typeof text !== "string") return null;
  const state = /(?:\/state:|\bUS-)([a-z]{2})(?:\b|\/)/i.exec(text)?.[1];
  if (state) return state.toUpperCase();
  return key === "state" && /^[a-z]{2}$/i.test(text) ? text.toUpperCase() : null;
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

type Encoded = { readonly out: unknown; readonly size: number; readonly territory: string };
const REF_BYTES = civicPayloadBytes({ [REF]: "0".repeat(64) });

/** Storage encoding only. Readers reconstruct the exact JSON they already verify. */
export function partitionCivicPayload(input: unknown, inlineFields?: readonly string[], referencedFields?: readonly string[]): { readonly value: unknown; readonly parts: readonly Part[] } {
  const parts = new Map<string, Part>();
  const put = (payload: unknown): Ref => {
    const hash = digest(payload);
    parts.set(hash, { hash, payload });
    return { [REF]: hash };
  };
  const parents = new Set<object>();
  // One pass, bottom up: a value's JSON size is summed from its children, and a value already in JSON form is kept, not copied.
  const encode = (original: unknown, value: unknown, inline: boolean): Encoded => {
    if (value === null || typeof value !== "object") {
      const size = typeof value === "string" ? stringBytes(value) : Buffer.byteLength(JSON.stringify(value));
      if (size <= INLINE_BYTES || typeof value !== "string" || inline) return { out: value, size, territory: "shared" };
      const chunks: string[] = [];
      for (let index = 0; index < value.length; index += INLINE_BYTES / 4) chunks.push(value.slice(index, index + INLINE_BYTES / 4));
      return { out: put({ kind: "string", chunks: chunks.map(chunk => put(chunk)) }), size, territory: "shared" };
    }
    if (parents.has(value)) throw new TypeError("A civic payload cannot contain a circular structure.");
    parents.add(value);
    try {
      let changed = !Object.is(original, value) || typeof (original as { toJSON?: unknown }).toJSON === "function" ||
        Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype);
      let size = 2, members = 0, small: [string, Encoded][] | null = [];
      const groups = new Map<string, { rows: unknown[]; size: number; index: number }>(), all: unknown[][] = [], order: number[] = [];
      const inlineRows: unknown[] = [], inlineEntries: Record<string, unknown> = {}, scope: Record<string, unknown> = {};
      const keys = Array.isArray(value) ? null : Object.keys(value);
      const length = keys?.length ?? (value as unknown[]).length;
      const place = (key: string, child: Encoded) => {
        if (inline) {
          if (keys) Object.defineProperty(inlineEntries, key, { value: child.out, enumerable: true, configurable: true, writable: true });
          else inlineRows.push(child.out);
        } else if (keys) Object.defineProperty(inlineEntries, key, { value: child.out, enumerable: true, configurable: true, writable: true });
        else {
          const rowSize = isCivicPayloadPart(child.out) ? REF_BYTES : child.size;
          let group = groups.get(child.territory);
          if (!group || group.size + rowSize > PART_BYTES) {
            group = { rows: [], size: 0, index: all.length };
            groups.set(child.territory, group); all.push(group.rows);
          }
          group.rows.push(child.out); group.size += rowSize; order.push(group.index);
        }
      };
      for (let index = 0; index < length; index++) {
        const key = keys ? keys[index] : String(index), raw = (value as Record<string, unknown>)[key];
        let converted = jsonValue(raw, key);
        if (converted === OMIT) {
          changed = true;
          if (keys) continue;
          converted = null;
        }
        const child = encode(raw, converted, inline);
        if (!Object.is(raw, child.out) || Object.getOwnPropertyDescriptor(value, key)?.get) changed = true;
        if (keys && ID_KEYS.includes(key)) scope[key] = converted;
        if (keys && NESTED_KEYS.includes(key)) scope[key] = child.territory;
        size += (members++ ? 1 : 0) + (keys ? stringBytes(key) + 1 : 0) + child.size;
        if (small) {
          small.push([key, child]);
          if (size > INLINE_BYTES) { small.forEach(([held, row]) => place(held, row)); small = null; }
        } else place(key, child);
      }
      const territory = keys ? ID_KEYS.map(key => stateOf(key, scope[key])).find(Boolean) ??
        NESTED_KEYS.map(key => scope[key] as string | undefined).find(state => state !== undefined && state !== "shared") ?? "shared" : "shared";
      if (small) {
        const out = !changed ? value : keys ? Object.fromEntries(small.map(([key, child]) => [key, child.out])) : small.map(([, child]) => child.out);
        return { out, size, territory };
      }
      if (keys) return { out: inline ? inlineEntries : put({ kind: "object", value: inlineEntries }), size, territory };
      if (inline) return { out: inlineRows, size, territory };
      // Ordering stays outside state partitions, so adding one state never rewrites another state's rows.
      return { out: put({ kind: "array", groups: all.map(rows => put(rows)), order: encode(null, `[${order.join(",")}]`, false).out }), size, territory };
    } finally { parents.delete(value); }
  };
  const root = jsonValue(input, "");
  if (root === OMIT) throw new TypeError("A civic payload needs a JSON value.");
  const fields = (inlineFields || referencedFields) && root !== null && typeof root === "object";
  const keys = fields && Array.isArray(root) ? Array.from({ length: root.length }, (_, index) => String(index)) : null;
  const value = inlineFields || referencedFields ? Object.fromEntries((keys ?? Object.keys(root as object)).flatMap(key => {
    const raw = (root as Record<string, unknown>)[key];
    let converted = jsonValue(raw, key);
    if (keys && converted === OMIT) converted = null;
    if (converted === OMIT) return [];
    const encoded = encode(raw, converted, inlineFields?.includes(key) ?? false).out;
    return [[key, referencedFields?.includes(key) && !isCivicPayloadPart(encoded) ? put({ kind: "object", value: encoded }) : encoded]];
  })) : encode(input, root, false).out;
  return { value, parts: [...parts.values()] };
}
