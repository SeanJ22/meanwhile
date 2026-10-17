import { createHash } from "node:crypto";
import { types } from "node:util";

export function canonicalCivicDataHash(value: unknown, options: { readonly durable?: boolean } = {}): string {
  const hash = createHash("sha256");
  let buffered = "";
  const write = (text: string) => {
    if (buffered.length + text.length > 65_536) { hash.update(buffered); buffered = ""; }
    if (text.length > 65_536) hash.update(text);
    else buffered += text;
  };
  const durableValue = (child: unknown, key: string): unknown => {
    if (child !== null && (typeof child === "object" || typeof child === "function" || typeof child === "bigint")) {
      const toJSON = (child as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") child = toJSON.call(child, key);
    }
    if (types.isNumberObject(child)) return Number(child);
    if (types.isStringObject(child)) return String(child);
    if (types.isBooleanObject(child)) return Boolean.prototype.valueOf.call(child);
    if (types.isBigIntObject(child)) return BigInt.prototype.valueOf.call(child);
    return child;
  };
  const omitted = (child: unknown) => child === undefined || typeof child === "function" || typeof child === "symbol";
  const ancestors = new Set<object>();
  const visit = (child: unknown, inArray = false) => {
    if (child === null || typeof child !== "object") {
      const encoded = JSON.stringify(child);
      write(encoded ?? (inArray ? options.durable ? "null" : "" : "undefined"));
      return;
    }
    if (ancestors.has(child)) throw new TypeError("A canonical hash cannot contain a circular value.");
    ancestors.add(child);
    if (Array.isArray(child)) {
      write("[");
      const length = child.length;
      for (let index = 0; index < length; index++) {
        if (index) write(",");
        visit(options.durable ? durableValue(child[index], String(index)) : child[index], true);
      }
      write("]");
    } else {
      write("{");
      const row = child as Record<string, unknown>;
      const prepared = options.durable ? new Map(Object.entries(row).map(([key, value]) => [key, durableValue(value, key)])) : null;
      const keys = (prepared ? [...prepared.keys()].filter(key => !omitted(prepared.get(key))) : Object.keys(row)).sort((a, b) => a.localeCompare(b));
      for (let index = 0; index < keys.length; index++) {
        if (index) write(",");
        const key = keys[index];
        write(JSON.stringify(key)); write(":"); visit(prepared ? prepared.get(key) : row[key]);
      }
      write("}");
    }
    ancestors.delete(child);
  };
  const root = options.durable ? durableValue(value, "") : value;
  if (omitted(root)) throw new TypeError("A canonical hash needs a JSON value.");
  visit(root); hash.update(buffered);
  return hash.digest("hex");
}
