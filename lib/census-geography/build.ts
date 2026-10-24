import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { isUnassignedZcta, type FractionBasis, type GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";

/** A ZCTA whose area lies this fraction (or more) inside a geography is "whole". */
export const WHOLE_THRESHOLD = 0.9999;

export interface Tab20Spec {
  readonly type: BuiltScope["type"];
  /** Version key, e.g. "cd:119". */
  readonly version: string;
  /**
   * The suffix Census uses in this file's geography column names, e.g.
   * "CD119_20" for `GEOID_CD119_20`, "COUNTY_20" for `GEOID_COUNTY_20`.
   */
  readonly geoTag: string;
  /** Appended to the label, e.g. "(119th Congress)". */
  readonly labelSuffix?: string;
}

export interface Tab20Columns {
  readonly geoGeoid: number;
  readonly geoName: number;
  readonly geoAreaLand: number;
  readonly zctaGeoid: number;
  readonly zctaAreaLand: number;
  readonly areaLandPart: number;
}

export function parseTab20Header(headerLine: string): string[] {
  return headerLine.replace(/^﻿/, "").trim().split("|");
}

/** Resolve the columns we need by name; throws loudly if the header changed. */
export function resolveTab20Columns(header: readonly string[], geoTag: string): Tab20Columns {
  const at = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) {
      throw new Error(
        `tab20 header is missing column "${name}"; header = ${JSON.stringify(header)}`,
      );
    }
    return i;
  };
  return {
    geoGeoid: at(`GEOID_${geoTag}`),
    geoName: at(`NAMELSAD_${geoTag}`),
    geoAreaLand: at(`AREALAND_${geoTag}`),
    zctaGeoid: at("GEOID_ZCTA5_20"),
    zctaAreaLand: at("AREALAND_ZCTA5_20"),
    areaLandPart: at("AREALAND_PART"),
  };
}

interface GeoAccumulator {
  name: string;
  geoAreaLand: number;
  overlaps: Map<string, { part: number; zctaAreaLand: number }>;
}

/** Accumulates one scope row by row. Columns are keyed by name, never index; the share is area-based (AREALAND_PART over the ZCTA's own land), since these files carry no population. */
export class ScopeAccumulator {
  private readonly geos = new Map<string, GeoAccumulator>();
  private rows = 0;
  private skippedBlank = 0;
  private readonly spec: Tab20Spec;
  private readonly cols: Tab20Columns;

  // Explicit field assignment (not a constructor parameter property): the
  // promote path runs under `node --experimental-strip-types`, which rejects
  // parameter properties.
  constructor(spec: Tab20Spec, cols: Tab20Columns) {
    this.spec = spec;
    this.cols = cols;
  }

  add(fields: readonly string[]): void {
    this.rows += 1;
    const zcta = (fields[this.cols.zctaGeoid] ?? "").trim();
    const geoid = (fields[this.cols.geoGeoid] ?? "").trim();
    // Unassigned ZCTA codes and a blank geography side establish no overlap.
    if (isUnassignedZcta(zcta) || geoid === "") {
      this.skippedBlank += 1;
      return;
    }
    const part = toNonNegative(fields[this.cols.areaLandPart]);
    const zctaAreaLand = toNonNegative(fields[this.cols.zctaAreaLand]);
    let geo = this.geos.get(geoid);
    if (geo === undefined) {
      geo = {
        name: (fields[this.cols.geoName] ?? "").trim(),
        geoAreaLand: toNonNegative(fields[this.cols.geoAreaLand]),
        overlaps: new Map(),
      };
      this.geos.set(geoid, geo);
    }
    const existing = geo.overlaps.get(zcta);
    if (existing === undefined) {
      geo.overlaps.set(zcta, { part, zctaAreaLand });
    } else {
      // Defensive: a repeated (geo, zcta) pair sums rather than overwrites, so
      // a split relationship is never silently collapsed to one part.
      existing.part += part;
      if (existing.zctaAreaLand === 0) existing.zctaAreaLand = zctaAreaLand;
    }
  }

  stats(): { rows: number; skippedBlank: number; geographies: number } {
    return { rows: this.rows, skippedBlank: this.skippedBlank, geographies: this.geos.size };
  }

  finish(versionMeta: GeographyVersion): BuiltScope {
    const groupings: BuiltGrouping[] = [];
    let edges = 0;
    for (const [geoid, geo] of this.geos) {
      const stateFips = geoid.slice(0, 2);
      const stateEntry = FIPS_TO_STATE[stateFips];
      const stateAbbr = stateEntry?.postal ?? "??";
      const overlaps: BuiltOverlap[] = [];
      for (const [zcta5, { part, zctaAreaLand }] of geo.overlaps) {
        const fraction = zctaAreaLand > 0 ? Math.min(1, part / zctaAreaLand) : null;
        overlaps.push({
          zcta5,
          whole: fraction !== null && fraction >= WHOLE_THRESHOLD,
          fraction,
        });
      }
      overlaps.sort((a, b) => (a.zcta5 < b.zcta5 ? -1 : a.zcta5 > b.zcta5 ? 1 : 0));
      edges += overlaps.length;
      const suffix = this.spec.labelSuffix ? ` ${this.spec.labelSuffix}` : "";
      groupings.push({
        geoid,
        ocdId: null,
        label: `${stateAbbr} ${geo.name}${suffix}`.trim(),
        stateFips,
        stateAbbr,
        memberStates: [stateAbbr],
        overlaps,
      });
    }
    groupings.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
    const basis: FractionBasis = "area";
    return {
      type: this.spec.type,
      version: this.spec.version,
      versionMeta,
      fractionBasis: basis,
      groupings,
      instanceCount: groupings.length,
      zctaEdgeCount: edges,
    };
  }
}

function toNonNegative(raw: string | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
