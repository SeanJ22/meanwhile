import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { isUnassignedZcta, type GeographyType, type GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";
import { WHOLE_THRESHOLD } from "./build.ts";
import { CENSUS_ACQUISITION_PARSER, censusDirectoryFiles, censusSourceRelease, censusTextLines, heldSourcesUnchanged, sourceValidator, type CensusSourceOptions } from "./source-release.ts";
import type { GeographyApplicability } from "./selection.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { establishedApplicability } from "./selection.ts";

/** The 2026 congressional map from Census grf block files; the tab20 relationship files stop at the 119th Congress. Shares are area-based, as in the tab20 build. */
export const GRF_ROOT = "https://www2.census.gov/geo/docs/maps-data/data/grf/";

/** Every Census state and territory FIPS. Release listings omit unpublished
 * outlying territories; a missing requested state file fails acquisition. */
export const GRF_STATE_FIPS: readonly string[] = Object.keys(FIPS_TO_STATE)
  .filter((fips) => /^\d{2}$/.test(fips))
  .sort();

export interface GrfTarget {
  readonly type: GeographyType;
  readonly version: string;
  readonly column: "CDCURFP" | "SLDUST" | "SLDLST";
  /** District-code width: 2 for a congressional district, 3 for a state-leg district. */
  readonly districtWidth: number;
  readonly plan: string;
  readonly effectiveFor: string;
  readonly labelSuffix: string;
  readonly districtNoun: string;
}

export const GRF_CD120: GrfTarget = {
  type: "congressional_district",
  version: "cd:120",
  column: "CDCURFP",
  districtWidth: 2,
  plan: "120th Congress",
  effectiveFor: "2026 general election (120th Congress)",
  labelSuffix: "(120th Congress)",
  districtNoun: "Congressional District",
};

export interface GrfColumns {
  readonly state: number;
  readonly zcta: number;
  readonly land: number;
  readonly district: number;
}

export function parseGrfHeader(headerLine: string): string[] {
  return headerLine.replace(/^﻿/, "").trim().split("|");
}

export function resolveGrfColumns(header: readonly string[], column: GrfTarget["column"]): GrfColumns {
  const at = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`grf header is missing column "${name}"`);
    return i;
  };
  return { state: header.includes("CURSTATE") ? at("CURSTATE") : at("TABBLKST"), zcta: at("ZCTA5CE"), land: at("AREALAND"), district: at(column) };
}

function toNonNegative(raw: string | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * National accumulator for one grf target column. Holds only per-ZCTA and
 * per-(district, ZCTA) land totals, never the blocks — so a national build stays
 * small in memory even though the input is ~8M block rows.
 */
export class GrfAccumulator {
  private readonly zctaLand = new Map<string, number>();
  private readonly geoZctaLand = new Map<string, Map<string, number>>();
  private readonly geoState = new Map<string, string>();
  private blocks = 0;
  private readonly target: GrfTarget;
  private readonly cols: GrfColumns;

  constructor(target: GrfTarget, cols: GrfColumns) {
    this.target = target;
    this.cols = cols;
  }

  add(fields: readonly string[]): void {
    this.blocks += 1;
    const zcta = (fields[this.cols.zcta] ?? "").trim();
    if (isUnassignedZcta(zcta)) return;
    const land = toNonNegative(fields[this.cols.land]);
    this.zctaLand.set(zcta, (this.zctaLand.get(zcta) ?? 0) + land);
    const district = (fields[this.cols.district] ?? "").trim();
    if (district === "" || /^Z+$/i.test(district) || this.target.column !== "CDCURFP" && district === "999") return; // no district of this layer
    const stateFips = (fields[this.cols.state] ?? "").trim().padStart(2, "0");
    const geoid = stateFips + district.padStart(this.target.districtWidth, "0");
    this.geoState.set(geoid, stateFips);
    let m = this.geoZctaLand.get(geoid);
    if (m === undefined) {
      m = new Map();
      this.geoZctaLand.set(geoid, m);
    }
    m.set(zcta, (m.get(zcta) ?? 0) + land);
  }

  stats(): { blocks: number; zctas: number; districts: number } {
    return { blocks: this.blocks, zctas: this.zctaLand.size, districts: this.geoZctaLand.size };
  }

  finish(versionMeta: GeographyVersion): BuiltScope {
    const groupings: BuiltGrouping[] = [];
    let edges = 0;
    for (const [geoid, zm] of this.geoZctaLand) {
      const stateFips = this.geoState.get(geoid) ?? geoid.slice(0, 2);
      const stateAbbr = FIPS_TO_STATE[stateFips]?.postal ?? "??";
      const districtCode = geoid.slice(2);
      const districtLabel = districtCode === "00" ? "(At Large)" : districtCode.replace(/^0+/, "") || "0";
      const overlaps: BuiltOverlap[] = [];
      for (const [zcta5, land] of zm) {
        const total = this.zctaLand.get(zcta5) ?? 0;
        const fraction = total > 0 ? Math.min(1, land / total) : null;
        overlaps.push({ zcta5, whole: fraction !== null && fraction >= WHOLE_THRESHOLD, fraction });
      }
      overlaps.sort((a, b) => (a.zcta5 < b.zcta5 ? -1 : a.zcta5 > b.zcta5 ? 1 : 0));
      edges += overlaps.length;
      groupings.push({
        geoid,
        ocdId: null,
        label: `${stateAbbr} ${this.target.districtNoun} ${districtLabel} ${this.target.labelSuffix}`.replace(/\s+/g, " ").trim(),
        stateFips,
        stateAbbr,
        memberStates: [stateAbbr],
        overlaps,
      });
    }
    groupings.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
    return {
      type: this.target.type,
      version: versionMeta.key,
      versionMeta,
      fractionBasis: "area",
      groupings,
      instanceCount: groupings.length,
      zctaEdgeCount: edges,
    };
  }
}

export const GRF_SLDU2026: GrfTarget = legislativeTarget("SLDUST", 2026);
export const GRF_SLDL2026: GrfTarget = legislativeTarget("SLDLST", 2026);
export const GRF_2026_TARGETS: readonly GrfTarget[] = [GRF_CD120, GRF_SLDU2026, GRF_SLDL2026];

function ordinal(number: number): string {
  const last = number % 100;
  return `${number}${last >= 11 && last <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[number % 10] ?? "th"}`;
}

export function congressionalTarget(session: number): GrfTarget {
  const plan = `${ordinal(session)} Congress`;
  return { ...GRF_CD120, version: `cd:${session}`, plan, effectiveFor: `${1786 + 2 * session} general election (${plan})`, labelSuffix: `(${plan})` };
}

export function legislativeTarget(column: "SLDUST" | "SLDLST", year: number): GrfTarget {
  const upper = column === "SLDUST";
  return {
    type: upper ? "state_leg_upper" : "state_leg_lower", version: `${upper ? "sldu" : "sldl"}:${year}`,
    column, districtWidth: 3, plan: `${year} state ${upper ? "upper" : "lower"}-chamber plan`,
    effectiveFor: `${year} state legislative district plan`, labelSuffix: `(${year} plan)`,
    districtNoun: upper ? "State Senate District" : "State House District",
  };
}

/** GRFN establishes the Congress and legislative plan year; the directory year alone does not. */
export function grfTargetsFromNames(text: string): readonly GrfTarget[] {
  const lines = text.trim().split(/\r?\n/);
  const header = parseGrfHeader(lines.shift() ?? "");
  const vintage = header.indexOf("VINTAGE");
  // GRFN also lists historical (70) districts. The CUR columns in GRFC
  // correspond to GRFN's current (90) rows, never its decennial rows.
  const current = lines.map(line => line.split("|")).filter(row => vintage < 0 || row[vintage] === "90");
  const stateColumn = header.indexOf("STATEFP");
  const territory = stateColumn >= 0 && current.length > 0 && current.every(row => FIPS_TO_STATE[row[stateColumn]]?.prefix === "territory");
  const valueOf = (name: string): number | null => {
    const index = header.indexOf(name);
    if (index < 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `grfn header is missing ${name}`);
    const values = new Set(current.map(row => row[index]?.trim()).filter(value => value && /^\d+$/.test(value) && Number(value) > 0));
    if (name === "LSY" && values.size === 0 && territory) return null;
    if (values.size !== 1) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `grfn does not establish one ${name}: ${[...values].join(", ")}`);
    return Number([...values][0]);
  };
  const session = valueOf("CDSESSN"), legislativeYear = valueOf("LSY");
  if (session === null || session < 100 || legislativeYear !== null && legislativeYear < 2020) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "grfn plan metadata is out of range");
  return [congressionalTarget(session), ...(legislativeYear === null ? [] : [legislativeTarget("SLDUST", legislativeYear), legislativeTarget("SLDLST", legislativeYear)])];
}

export interface GrfRelease {
  readonly year: number;
  readonly files: readonly string[];
}

export async function discoverGrfReleases(options: CensusSourceOptions): Promise<readonly GrfRelease[]> {
  const years = (await censusDirectoryFiles(GRF_ROOT, options))
    .map(url => /^([2]\d{3})\/$/.exec(url.slice(GRF_ROOT.length))?.[1]).filter((year): year is string => !!year && Number(year) >= 2026)
    .map(Number).sort((a, b) => b - a);
  const releases: GrfRelease[] = [];
  for (const year of years) {
    const files = await censusDirectoryFiles(`${GRF_ROOT}${year}/`, options);
    if (files.some(url => /public_grfc_cur\d{2}_\d{2}\.txt$/.test(url))) releases.push({ year, files });
  }
  if (releases.length === 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Census published no current GRF block files");
  return releases;
}

export interface AcquireGrfOptions extends CensusSourceOptions {
  readonly states?: ReadonlySet<string>;
  readonly release?: GrfRelease;
  readonly previousScopes?: readonly BuiltScope[];
}

function electionDate(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const day = 1 + (8 - first.getUTCDay()) % 7 + 1;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}

export function planApplicability(version: string): readonly GeographyApplicability[] {
  const known = establishedApplicability(version);
  if (known.length > 0) return known;
  const match = /^(cd|sldu|sldl):(\d+)$/.exec(version);
  if (!match) return [];
  const year = match[1] === "cd" ? 1786 + 2 * Number(match[2]) : Number(match[2]);
  return [
    { purpose: "election", from: electionDate(year) },
    { purpose: "representation", from: `${year + 1}-01-${match[1] === "cd" ? "03" : "01"}` },
  ];
}

/** One state download supplies every requested district column. Held parsed
 * state rows are reused only after the exact block file passes a source check. */
export async function acquireGrfScopes(targets: readonly GrfTarget[], options: AcquireGrfOptions = {}): Promise<readonly BuiltScope[]> {
  const year = options.release?.year ?? 2026, suffix = String(year).slice(-2), base = `${GRF_ROOT}${year}`;
  const states = options.states ? GRF_STATE_FIPS.filter(state => options.states!.has(state)) : GRF_STATE_FIPS;
  const files = options.release?.files;
  const accumulators = new Map<string, { target: GrfTarget; groupings: BuiltGrouping[]; sourceUrls: string[]; sourceFiles: string[]; checksums: string[]; validators: NonNullable<GeographyVersion["provenance"]["sourceValidators"]>[number][] }>();
  const missing: string[] = [];
  for (const state of states) {
    const blockUrl = `${base}/public_grfc_cur${suffix}_${state}.txt`, namesUrl = `${base}/public_grfn_cur${suffix}_${state}.txt`;
    if (files && !files.includes(blockUrl)) {
      // Census does not publish every outlying territory in this product.
      if (FIPS_TO_STATE[state].prefix !== "territory" || options.states?.has(state)) missing.push(state);
      continue;
    }
    const names = await censusSourceRelease(namesUrl, options, bytes => { grfTargetsFromNames(new TextDecoder().decode(bytes)); });
    const plans = grfTargetsFromNames(new TextDecoder().decode(names.bytes)).filter(target => targets.some(requested => requested.column === target.column));
    const held = plans.map(target => options.previousScopes?.find(scope => scope.version === target.version && scope.type === target.type &&
      scope.versionMeta.retrievalComplete !== false && scope.versionMeta.provenance.parserVersion === CENSUS_ACQUISITION_PARSER &&
      scope.versionMeta.provenance.sourceDataset === `CENSUS_GRF_CUR${year}` &&
      scope.versionMeta.provenance.method.includes(`Source column ${target.column};`) &&
      scope.versionMeta.provenance.sourceUrls.includes(blockUrl) &&
      scope.versionMeta.provenance.sourceFiles.includes(blockUrl.split("/").pop()!)));
    const canReuse = held.every(scope => !!scope) && held.length > 0 &&
      await heldSourcesUnchanged(held[0]!.versionMeta.provenance, [blockUrl], options) &&
      held.every(scope => scope!.versionMeta.provenance.sourceValidators?.find(row => row.url === blockUrl)?.etag === held[0]!.versionMeta.provenance.sourceValidators?.find(row => row.url === blockUrl)?.etag &&
        scope!.versionMeta.provenance.sourceChecksums[scope!.versionMeta.provenance.sourceFiles.indexOf(blockUrl.split("/").pop()!)] ===
        held[0]!.versionMeta.provenance.sourceChecksums[held[0]!.versionMeta.provenance.sourceFiles.indexOf(blockUrl.split("/").pop()!)]);
    let stateScopes: readonly BuiltScope[], blockChecksum: string;
    let blockValidator: NonNullable<GeographyVersion["provenance"]["sourceValidators"]>[number];
    if (canReuse) {
      stateScopes = held.map(scope => ({ ...scope!, groupings: scope!.groupings.filter(grouping => grouping.stateFips === state) }));
      const provenance = held[0]!.versionMeta.provenance;
      blockChecksum = provenance.sourceChecksums[provenance.sourceFiles.indexOf(blockUrl.split("/").pop()!)]!;
      blockValidator = provenance.sourceValidators!.find(row => row.url === blockUrl)!;
    } else {
      const parse = (bytes: Uint8Array): readonly BuiltScope[] => {
        const lines = censusTextLines(bytes);
        const header = parseGrfHeader(lines.next().value ?? "");
        const accs = plans.map(target => new GrfAccumulator(target, resolveGrfColumns(header, target.column)));
        const currentState = header.indexOf(header.includes("CURSTATE") ? "CURSTATE" : "TABBLKST");
        for (const line of lines) {
          if (line !== "") {
            const fields = line.split("|");
            if (fields.length !== header.length || fields[currentState] !== state) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `grf malformed block row for ${state}`);
            for (const acc of accs) acc.add(fields);
          }
        }
        if (accs.some(acc => acc.stats().blocks === 0)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `grf returned no blocks for ${state}`);
        return accs.map((acc, index) => acc.finish({ key: plans[index].version, type: plans[index].type, plan: plans[index].plan,
          zctaTabulation: "2020", effectiveFor: plans[index].effectiveFor,
          provenance: { sourceUrls: [], sourceDataset: `CENSUS_GRF_CUR${year}`, sourceFiles: [], sourceChecksums: [], method: "pending source assembly", computedAt: new Date().toISOString() } }));
      };
      let parsed: readonly BuiltScope[] | undefined;
      const blocks = await censusSourceRelease(blockUrl, options, bytes => { parsed = parse(bytes); });
      stateScopes = parsed ?? parse(blocks.bytes);
      blockChecksum = blocks.sha256; blockValidator = sourceValidator(blocks);
    }
    for (let index = 0; index < plans.length; index++) {
      const target = plans[index];
      let aggregate = accumulators.get(target.version);
      if (!aggregate) { aggregate = { target, groupings: [], sourceUrls: [], sourceFiles: [], checksums: [], validators: [] }; accumulators.set(target.version, aggregate); }
      aggregate.groupings.push(...stateScopes[index].groupings);
      aggregate.sourceUrls.push(namesUrl, blockUrl);
      aggregate.sourceFiles.push(namesUrl.split("/").pop()!, blockUrl.split("/").pop()!);
      aggregate.checksums.push(names.sha256, blockChecksum);
      aggregate.validators.push(sourceValidator(names), blockValidator);
    }
  }
  if (missing.length > 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census GRF ${year} is missing requested state files: ${missing.join(", ")}`);
  if (accumulators.size === 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "grf: no state files read");
  return [...accumulators.values()].map(({ target, groupings, sourceUrls, sourceFiles, checksums, validators }) => {
    groupings.sort((a, b) => a.geoid.localeCompare(b.geoid));
    const versionMeta: GeographyVersion = {
      key: target.version, type: target.type, plan: target.plan, zctaTabulation: "2020", effectiveFor: target.effectiveFor,
      applicability: planApplicability(target.version), retrievalComplete: true,
      provenance: { sourceUrls, sourceDataset: `CENSUS_GRF_CUR${year}`, sourceFiles, sourceChecksums: checksums,
        sourceValidators: validators, parserVersion: CENSUS_ACQUISITION_PARSER,
        method: `Census ${year} current geographic reference (grf/${year} public_grfc_cur${suffix}_<st>); a ZCTA is an edge ` +
          `of a ${target.districtNoun} if it shares block land; area share = Σ block AREALAND in the district / ` +
          `ZCTA total block AREALAND (no population weight). Source column ${target.column}; ` +
          `each state's grfn names file establishes ${target.column === "CDCURFP" ? `CDSESSN=${target.version.split(":")[1]}` : `LSY=${target.version.split(":")[1]}`}.`,
        computedAt: new Date().toISOString() },
    };
    return { type: target.type, version: target.version, versionMeta, fractionBasis: "area", groupings,
      instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((count, grouping) => count + grouping.overlaps.length, 0) };
  });
}
