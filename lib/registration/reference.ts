/**
 * The committed registration reference, read for one state (2026-09-23).
 *
 * `scripts/build-registration-reference.mts` writes one file per state under
 * `data/derived/registration/`: the state's Census divisions and its
 * governments, each paired to a division by Census code or school name, or
 * carrying the reason it is not. Only the registration child script reads
 * these files (never a request path), so a plain read from the repository
 * root is the whole loader.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ReferenceLayer = "state" | "county" | "place" | "cousub" | "unsd" | "elsd" | "scsd";
export type ReferenceDivision = readonly [ocdId: string, layer: ReferenceLayer, geoid: string, censusName: string];
export type ReferenceGovernment = readonly [pid6: string, jurisdictionId: string, name: string, govType: string, division: number, how: string, alternate: number];

export interface RegistrationReference {
  readonly formatVersion: 1;
  readonly state: string;
  readonly divisions: readonly ReferenceDivision[];
  readonly governments: readonly ReferenceGovernment[];
}

export interface LoadedReference {
  readonly reference: RegistrationReference;
  /** sha256 of the state file's exact text, bound into every candidate built from it. */
  readonly sha256: string;
  /** The reference's build date (`index.json` generatedAt): the records' collectedAt, stable until a rebuild. */
  readonly generatedAt: string;
}

export function loadRegistrationReference(root: string, state: string): LoadedReference {
  const dir = join(/* turbopackIgnore: true */ root, "data", "derived", "registration");
  const text = readFileSync(join(dir, `${state.toLowerCase()}.json`), "utf8");
  const reference = JSON.parse(text) as RegistrationReference;
  if (reference.formatVersion !== 1 || reference.state !== state.toLowerCase()) throw new Error(`REGISTRATION_REFERENCE_INVALID:${state}`);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { generatedAt: string; states: Record<string, { sha256: string }> };
  const sha256 = createHash("sha256").update(text).digest("hex");
  if (index.states[state.toLowerCase()]?.sha256 !== sha256) throw new Error(`REGISTRATION_REFERENCE_DRIFT:${state}: the state file does not match index.json`);
  return { reference, sha256, generatedAt: index.generatedAt };
}
