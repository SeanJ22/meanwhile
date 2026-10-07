/**
 * Every government's OCD id, nationally, assigned once. The ZIP index
 * (`scripts/build-zip-division-shards.mts`) and the registration reference
 * (`scripts/build-registration-reference.mts`) both read this, so a government
 * has the same id in each:
 *
 * ```
 *   county   countyIdentity(STATEFP, NAME)
 *   place    placeIdentity(STATEFP, NAME, LSAD)
 *   cousub   subdivisionIdentity(STATEFP, NAMELSADCO, NAMELSAD, LSAD)
 *   school   schoolIdentity(STATEFP, NAME)      (unified, elementary, secondary)
 * ```
 *
 * Every side of a name collision takes its Census GEOID suffix, except an id
 * already in committed geometry, which never moves: the registry, bodies and
 * sources join on it. A shared id whose every holder is pinned to it is
 * carried as it is; any other shared id refuses.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { readBoundaryAttributes } from "../../lib/geo/shapefile.ts";
import { geometryFiles } from "../../lib/holdings/discovery.ts";
import { countyIdentity, placeIdentity, schoolIdentity, subdivisionIdentity, type DivisionIdentity } from "../../lib/ocd/divisions.ts";

export type Layer = "county" | "place" | "cousub" | "unsd" | "elsd" | "scsd";
export const LAYERS: readonly Layer[] = ["county", "place", "cousub", "unsd", "elsd", "scsd"];
export const TIGER_FILE: Readonly<Record<Layer, string>> = {
  county: "cb_2023_us_county_500k.zip",
  place: "cb_2023_us_place_500k.zip",
  cousub: "cb_2023_us_cousub_500k.zip",
  unsd: "cb_2023_us_unsd_500k.zip",
  elsd: "cb_2023_us_elsd_500k.zip",
  scsd: "cb_2023_us_scsd_500k.zip",
};

function identityOf(layer: Layer, row: Record<string, string>): DivisionIdentity | null {
  switch (layer) {
    case "county":
      return countyIdentity(row.STATEFP ?? "", row.NAME ?? "");
    case "place":
      return placeIdentity(row.STATEFP ?? "", row.NAME ?? "", row.LSAD);
    case "cousub":
      return subdivisionIdentity(row.STATEFP ?? "", row.NAMELSADCO ?? "", row.NAMELSAD ?? "", row.LSAD);
    default:
      return schoolIdentity(row.STATEFP ?? "", row.NAME ?? "");
  }
}

/** One Census division with its final id. `key` is `<layer>:<GEOID>`, the join key every build uses. */
export interface NationalDivision {
  readonly key: string;
  readonly layer: Layer;
  readonly geoid: string;
  readonly statefp: string;
  readonly ocdId: string;
  /** The constructor's display label (what the committed geometry calls it). */
  readonly label: string;
  /** The Census NAMELSAD, or NAME where the layer has none. */
  readonly censusName: string;
  readonly lsad: string | null;
}

export interface NationalDivisionIds {
  /** Every division the Census files carry, by `<layer>:<GEOID>`. */
  readonly divisions: ReadonlyMap<string, NationalDivision>;
  /** `<layer>:<GEOID>` → the id committed geometry already gives it. */
  readonly pinned: ReadonlyMap<string, string>;
  readonly collisions: readonly string[];
  readonly pinnedKept: number;
  /** Committed ids that already name more than one government, carried as committed. */
  readonly inheritedCollapses: ReadonlyMap<string, ReadonlySet<string>>;
  /** Pinned keys the national layers do not carry (a vintage difference, kept out rather than guessed). */
  readonly pinsNotNational: readonly string[];
  /** Census divisions the constructors give no OCD id (e.g. "County subdivisions not defined"), by `<layer>:<GEOID>`. */
  readonly withoutId: ReadonlySet<string>;
  readonly rowsByLayer: Readonly<Record<string, number>>;
}

/** The committed ids, which never move: `<layer>:<GEOID>` → ocdId, from every committed geometry file. */
export function committedIds(root: string): Map<string, string> {
  const COMMITTED_LAYER: Readonly<Record<string, Layer>> = { "county-us": "county", place: "place", cousub: "cousub", unsd: "unsd", elsd: "elsd", scsd: "scsd" };
  const pinned = new Map<string, string>();
  for (const file of geometryFiles(root)) {
    const stem = basename(file).replace(/\.geojson$/, "");
    const layer = COMMITTED_LAYER[stem] ?? COMMITTED_LAYER[stem.replace(/-\d{2}$/, "")];
    if (!layer) continue;
    const parsed = JSON.parse(readFileSync(join(root, file), "utf8")) as { features?: { properties: Record<string, string> }[] };
    for (const f of parsed.features ?? []) {
      const geoid = String(f.properties.geoid ?? "");
      const ocdId = String(f.properties.ocdId ?? "");
      if (geoid && ocdId) pinned.set(`${layer}:${geoid}`, ocdId);
    }
  }
  return pinned;
}

export function nationalDivisionIds(root: string, tiger: string): NationalDivisionIds {
  const pinned = committedIds(root);
  const members = new Map<string, { readonly key: string; readonly geoid: string; readonly label: string }[]>();
  const attributes = new Map<string, Omit<NationalDivision, "ocdId">>();
  const rowsByLayer: Record<string, number> = {};
  const withoutId = new Set<string>();
  for (const layer of LAYERS) {
    const path = join(tiger, TIGER_FILE[layer]);
    if (!existsSync(path)) throw new Error(`${path} is missing. Run \`pnpm tiger:fetch\`, or pass --tiger=<the directory holding the Census files>.`);
    const rows = readBoundaryAttributes(readFileSync(path)) as Record<string, string>[];
    rowsByLayer[layer] = rows.length;
    for (const row of rows) {
      const identity = identityOf(layer, row);
      const geoid = row.GEOID ?? "";
      if (geoid !== "" && identity === null) withoutId.add(`${layer}:${geoid}`);
      if (identity === null || geoid === "") continue;
      const key = `${layer}:${geoid}`;
      const list = members.get(identity.ocdId) ?? [];
      list.push({ key, geoid, label: `${identity.label} (${layer} ${geoid})` });
      members.set(identity.ocdId, list);
      attributes.set(key, {
        key,
        layer,
        geoid,
        statefp: row.STATEFP ?? "",
        label: identity.label,
        censusName: row.NAMELSAD ?? row.NAME ?? "",
        lsad: row.LSAD ?? null,
      });
    }
  }

  const finalId = new Map<string, string>();
  const collisions: string[] = [];
  let pinnedKept = 0;
  for (const [id, group] of members) {
    if (group.length === 1) {
      const only = group[0];
      finalId.set(only.key, pinned.get(only.key) ?? id);
      continue;
    }
    collisions.push(`${id}: ${group.map((m) => m.label).join(" | ")}`);
    for (const m of group) {
      const pin = pinned.get(m.key);
      if (pin !== undefined) pinnedKept++;
      finalId.set(m.key, pin ?? `${id}_${m.geoid}`);
    }
  }
  /*
   * Committed geometry already gives two governments one id where they sit in
   * different layer files, because that build checks collisions one file at a
   * time. Renaming either would move a committed id, so a shared id whose every
   * holder is pinned to it is carried as it is; any other shared id refuses.
   */
  const owners = new Map<string, string>();
  const inheritedCollapses = new Map<string, Set<string>>();
  for (const [key, id] of finalId) {
    const other = owners.get(id);
    if (other !== undefined && other !== key) {
      if (pinned.get(key) === id && pinned.get(other) === id) {
        const holders = inheritedCollapses.get(id) ?? new Set([other]);
        holders.add(key);
        inheritedCollapses.set(id, holders);
        continue;
      }
      throw new Error(`${id} names two governments (${other} and ${key}). An OCD id is a join key; a shared one is a collapsed join.`);
    }
    owners.set(id, key);
  }
  const divisions = new Map<string, NationalDivision>();
  for (const [key, ocdId] of finalId) divisions.set(key, { ...attributes.get(key)!, ocdId });
  return {
    divisions,
    pinned,
    collisions,
    pinnedKept,
    inheritedCollapses,
    pinsNotNational: [...pinned.keys()].filter((key) => !finalId.has(key)),
    withoutId,
    rowsByLayer,
  };
}
