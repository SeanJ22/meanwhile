import { createHash } from "node:crypto";

/** Hash canonical JSON incrementally: a national ACS payload need not exist
 * as a second whole-country string and parsed object just to fingerprint it. */
export function acsPayloadHash(value: unknown): string {
  const hash = createHash("sha256");
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      hash.update("["); node.forEach((child, index) => { if (index) hash.update(","); visit(child ?? null); }); hash.update("]");
    } else if (node !== null && typeof node === "object") {
      hash.update("{");
      Object.entries(node).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, child], index) => {
        if (index) hash.update(","); hash.update(JSON.stringify(key)); hash.update(":"); visit(child);
      });
      hash.update("}");
    } else hash.update(JSON.stringify(node) ?? "null");
  };
  visit(value);
  return hash.digest("hex");
}
