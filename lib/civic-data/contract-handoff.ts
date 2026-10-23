import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

type Named = string | { readonly id: string };
const idOf = (value: Named): string => typeof value === "string" ? value : value?.id;
const hash = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

function validate(values: unknown): asserts values is Named[] {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof idOf(value) !== "string" || !idOf(value).trim())) {
    throw new Error("CONTRACT_HANDOFF_SELECTION_INVALID: a non-empty exact selection is required");
  }
  if (new Set(values.map(idOf)).size !== values.length) throw new Error("CONTRACT_HANDOFF_DUPLICATE_ID");
}

/** Pure encoding is shared; source children can reach no filesystem writer through this module. */
export function encodeContractHandoff<T extends Named>(values: readonly T[]): { readonly bytes: string; readonly count: number; readonly sha256: string } {
  validate(values);
  const bytes = JSON.stringify(values);
  return { bytes, count: values.length, sha256: hash(bytes) };
}

/** Never reconstruct a selection from the current registry: it may have changed since the parent's pass began. */
export function readContractHandoff<T extends Named>(args: readonly string[]): readonly T[] {
  const required = (name: string) => {
    const matching = args.filter(arg => arg.startsWith(`--${name}=`));
    if (matching.length !== 1 || !matching[0]!.slice(name.length + 3)) throw new Error(`CONTRACT_HANDOFF_ARGUMENT_INVALID:${name}`);
    return matching[0]!.slice(name.length + 3);
  };
  const path = required("contracts-file"), count = required("contracts-count"), checksum = required("contracts-sha256");
  if (!/^[1-9]\d*$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error("CONTRACT_HANDOFF_COUNT_INVALID");
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("CONTRACT_HANDOFF_SHA256_INVALID");
  let bytes: string;
  try { bytes = readFileSync(path, "utf8"); }
  catch (error) { throw new Error(`CONTRACT_HANDOFF_UNREADABLE:${(error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`); }
  let values: unknown;
  try { values = JSON.parse(bytes); }
  catch { throw new Error("CONTRACT_HANDOFF_JSON_INVALID"); }
  if (!Array.isArray(values) || values.length !== Number(count)) {
    throw new Error(`CONTRACT_HANDOFF_COUNT_MISMATCH: parent=${count}, child=${Array.isArray(values) ? values.length : "not an array"}`);
  }
  if (hash(bytes) !== checksum) throw new Error("CONTRACT_HANDOFF_CONTENT_MISMATCH");
  validate(values);
  return values as T[];
}
