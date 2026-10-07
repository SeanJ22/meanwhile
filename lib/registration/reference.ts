/**
 * The committed registration reference, read for one state. `scripts/build-registration-reference.mts`
 * writes one file per state under `data/derived/registration/`. Only the registration child script reads
 * these files (never a request path).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ReferenceLayer = "state" | "county" | "place" | "cousub" | "unsd" | "elsd" | "scsd";
/** A territory's county, county-subdivision and place divisions also carry their TIGER/Line LSAD, FUNCSTAT and CLASSFP. */
export type ReferenceDivision = readonly [ocdId: string, layer: ReferenceLayer, geoid: string, censusName: string, lsad?: string, funcstat?: string, classfp?: string];
/** `pid6` is the Census of Governments id, or `<layer>:<GEOID>` for a territory government read from TIGER/Line's functional status. */
export type ReferenceGovernment = readonly [pid6: string, jurisdictionId: string, name: string, govType: string, division: number, how: string, alternate: number];

export interface RegistrationReference {
  readonly formatVersion: 1;
  readonly state: string;
  /**
   * A territory only. The 2022 Census of Governments does not enumerate the territories, so their governments are
   * the divisions TIGER/Line 2023 gives a governing functional status, read from this committed extract; `sources`
   * names the archive each layer's status came from.
   */
  readonly functionalStatus?: { readonly dataset: string; readonly sha256: string; readonly sources: Readonly<Record<string, string>> };
  readonly divisions: readonly ReferenceDivision[];
  readonly governments: readonly ReferenceGovernment[];
}

export interface LoadedReference {
  readonly reference: RegistrationReference;
  /** sha256 of the state file's exact text, bound into every candidate built from it. */
  readonly sha256: string;
  /** The date this state's file was last built with a change (`index.json`): the records' collectedAt, stable until then. */
  readonly generatedAt: string;
}

export function loadRegistrationReference(root: string, state: string): LoadedReference {
  const dir = join(/* turbopackIgnore: true */ root, "data", "derived", "registration");
  const text = readFileSync(join(dir, `${state.toLowerCase()}.json`), "utf8");
  const reference = JSON.parse(text) as RegistrationReference;
  if (reference.formatVersion !== 1 || reference.state !== state.toLowerCase()) throw new Error(`REGISTRATION_REFERENCE_INVALID:${state}`);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { generatedAt: string; states: Record<string, { sha256: string; generatedAt?: string }> };
  const sha256 = createHash("sha256").update(text).digest("hex");
  const entry = index.states[state.toLowerCase()];
  if (entry?.sha256 !== sha256) throw new Error(`REGISTRATION_REFERENCE_DRIFT:${state}: the state file does not match index.json`);
  // A rebuild that left this state's bytes alone left its date alone, so its records promote UNCHANGED.
  return { reference, sha256, generatedAt: entry.generatedAt ?? index.generatedAt };
}

/**
 * The governments a state's committed reference pairs to a division, with the body id the registration
 * writer mints for each (`<division>#governing`, `#board` for a school district). The state is
 * upper-case, as the registry's divisions carry it.
 */
export function registeredGovernments(loaded: LoadedReference, state: string): {
  readonly bodies: readonly { readonly id: string; readonly ocdId: string }[];
  readonly divisions: readonly { readonly ocdId: string; readonly state: string }[];
} {
  const { reference } = loaded;
  const bodies: { id: string; ocdId: string }[] = [];
  const divisions = new Map<string, { ocdId: string; state: string }>();
  for (const [, , , govType, division] of reference.governments) {
    if (govType === "STATE" || division < 0) continue;
    const ocdId = reference.divisions[division][0];
    const school = govType === "SCHOOL DISTRICT" || govType === "DEPENDENT SCHOOL SYSTEM";
    bodies.push({ id: `${ocdId}#${school ? "board" : "governing"}`, ocdId });
    divisions.set(ocdId, { ocdId, state: state.toUpperCase() });
  }
  return { bodies, divisions: [...divisions.values()] };
}
