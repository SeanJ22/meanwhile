/** A partly overlapping code is included whole; containers and states count distinct bodies; a code outside the ZIP index is `indexed: false`, never a code with no bodies. */
import { displayNameOf } from "../display-name.ts";
import type { BodyStatus, BodyView } from "./bodies.ts";

export type CoverageStatus = "LIVE" | "MANUAL" | "KNOWN_UNCOVERED" | "NO_SOURCE_FOUND" | "NOT_ATTEMPTED" | "READ_UNRESOLVED" | "OTHER";

export interface RegistryBody {
  readonly id: string;
  readonly name: string;
  readonly ocdId: string | null;
  readonly alsoServesOcdIds: readonly string[];
  readonly coverageStatus: CoverageStatus;
  readonly bodyClass: string | null;
  readonly stateCode: string | null;
}

export interface CodeInput {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly indexed: boolean;
  readonly divisions: readonly string[];
}

export interface CoverageCounts {
  readonly bodies: number;
  readonly wayIn: number;
  readonly lookedNoRoute: number;
  readonly neverWalked: number;
  readonly other: number;
  readonly watched: Readonly<Record<BodyStatus, number>>;
}

export interface CodeStanding {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly indexed: boolean;
  readonly counts: CoverageCounts | null;
  readonly bodyIds: readonly string[];
}

export interface ContainerStanding {
  readonly codes: number;
  readonly wholeCodes: number;
  readonly indexedCodes: number;
  /** Distinct bodies over every indexed code — a body at three codes counts once. */
  readonly counts: CoverageCounts;
  readonly perCode: readonly CodeStanding[];
  readonly worst: CodeStanding | null;
}

export function normaliseStatus(raw: unknown): CoverageStatus {
  return raw === "LIVE" || raw === "MANUAL" || raw === "KNOWN_UNCOVERED" || raw === "NO_SOURCE_FOUND" || raw === "NOT_ATTEMPTED" ? raw : "OTHER";
}

export function stateOfBody(id: string, ocdId: string | null): string | null {
  const m = /state:([a-z]{2})/.exec(ocdId ?? id) ?? /^curated:([a-z]{2})\//.exec(id);
  return m ? m[1] : null;
}

export function registryBodyOf(raw: {
  readonly id: string;
  readonly name?: string | null;
  readonly ocdId?: string | null;
  readonly alsoServesOcdIds?: readonly string[] | null;
  readonly coverageStatus?: unknown;
  readonly bodyClass?: string | null;
}): RegistryBody {
  const ocdId = raw.ocdId ?? null;
  const named = raw.name && raw.name.trim() !== "" ? raw.name.trim() : null;
  const fromDivision = ocdId ? displayNameOf(ocdId).name : null;
  const cls = raw.bodyClass ?? null;
  const suffix = cls === "GOVERNING" ? "governing body" : cls ? cls.toLowerCase().replace(/_/g, " ") : "body";
  return {
    id: raw.id,
    name: named ?? (fromDivision ? `${fromDivision} — ${suffix}` : raw.id),
    ocdId,
    alsoServesOcdIds: raw.alsoServesOcdIds ?? [],
    coverageStatus: normaliseStatus(raw.coverageStatus),
    bodyClass: cls,
    stateCode: stateOfBody(raw.id, ocdId),
  };
}

const NO_WATCH: Readonly<Record<BodyStatus, number>> = { WORKING: 0, "NEEDS ATTENTION": 0, STUCK: 0, "NOT READ YET": 0 };

/** A later measured read supersedes an old registry label, for this exact body only. */
export function observedCoverageStatus(body: RegistryBody, watched?: BodyView): CoverageStatus {
  if (!watched || watched.id !== body.id) return body.coverageStatus;
  if (watched.recordSources > 0 || watched.lastSuccessAt) return "LIVE";
  if (body.coverageStatus === "NOT_ATTEMPTED" && watched.lastReadAt) return "READ_UNRESOLVED";
  return body.coverageStatus;
}

export function countBodies(bodies: readonly RegistryBody[], watchedById: ReadonlyMap<string, BodyView>): CoverageCounts {
  const watched: Record<BodyStatus, number> = { ...NO_WATCH };
  let wayIn = 0;
  let lookedNoRoute = 0;
  let neverWalked = 0;
  let other = 0;
  const seenWatched = new Set<string>();
  for (const b of bodies) {
    const w = watchedById.get(b.id);
    const status = observedCoverageStatus(b, w);
    if (status === "LIVE" || status === "MANUAL") wayIn += 1;
    else if (status === "KNOWN_UNCOVERED" || status === "NO_SOURCE_FOUND") lookedNoRoute += 1;
    else if (status === "NOT_ATTEMPTED") neverWalked += 1;
    else other += 1;
    if (w && !seenWatched.has(w.id)) {
      seenWatched.add(w.id);
      watched[w.status] += 1;
    }
  }
  return { bodies: bodies.length, wayIn, lookedNoRoute, neverWalked, other, watched };
}

export type BodyIndex = ReadonlyMap<string, readonly RegistryBody[]>;

export function indexBodies(bodies: readonly RegistryBody[]): BodyIndex {
  const out = new Map<string, RegistryBody[]>();
  const add = (d: string, b: RegistryBody) => {
    const list = out.get(d);
    if (list) {
      if (!list.includes(b)) list.push(b);
    } else out.set(d, [b]);
  };
  for (const b of bodies) {
    if (b.ocdId !== null) add(b.ocdId, b);
    for (const d of b.alsoServesOcdIds) add(d, b);
  }
  return out;
}

export function bodiesAtDivisions(divisions: Iterable<string>, index: BodyIndex): RegistryBody[] {
  const seen = new Map<string, RegistryBody>();
  for (const d of divisions) for (const b of index.get(d) ?? []) seen.set(b.id, b);
  return [...seen.values()];
}

export function wayInShare(c: CoverageCounts): number | null {
  return c.bodies === 0 ? null : c.wayIn / c.bodies;
}

export function watchedIndex(views: readonly BodyView[]): { byId: ReadonlyMap<string, BodyView>; byOcd: ReadonlyMap<string, readonly BodyView[]> } {
  const byId = new Map<string, BodyView>();
  const byOcd = new Map<string, BodyView[]>();
  for (const v of views) {
    byId.set(v.id, v);
    if (v.ocdId) byOcd.set(v.ocdId, [...(byOcd.get(v.ocdId) ?? []), v]);
  }
  return { byId, byOcd };
}

export function containerStanding(codes: readonly CodeInput[], index: BodyIndex, watched: readonly BodyView[]): ContainerStanding {
  const w = watchedIndex(watched);
  const all = new Map<string, RegistryBody>();
  const perCode: CodeStanding[] = codes.map((code) => {
    if (!code.indexed) return { zcta5: code.zcta5, whole: code.whole, fraction: code.fraction, indexed: false, counts: null, bodyIds: [] };
    const here = bodiesAtDivisions(code.divisions, index);
    for (const b of here) all.set(b.id, b);
    return {
      zcta5: code.zcta5,
      whole: code.whole,
      fraction: code.fraction,
      indexed: true,
      counts: countBodies(here, w.byId),
      bodyIds: here.map((b) => b.id),
    };
  });
  const indexed = perCode.filter((c) => c.indexed && c.counts !== null && c.counts.bodies > 0);
  const worst =
    indexed.length === 0
      ? null
      : [...indexed].sort((a, b) => (wayInShare(a.counts!) ?? 1) - (wayInShare(b.counts!) ?? 1) || b.counts!.bodies - a.counts!.bodies)[0];
  return {
    codes: codes.length,
    wholeCodes: codes.filter((c) => c.whole).length,
    indexedCodes: codes.filter((c) => c.indexed).length,
    counts: countBodies([...all.values()], w.byId),
    perCode,
    worst,
  };
}

/** Registry status codes are internal vocabulary and never render; a screen draws only the words and the tone. */
export function coverageStatusPill(status: CoverageStatus): { readonly pill: string; readonly tone: "teal" | "gold" | "amber" | "slate" } {
  switch (status) {
    case "LIVE":
      return { pill: "WAY IN", tone: "teal" };
    case "MANUAL":
      return { pill: "WAY IN · MANUAL", tone: "teal" };
    case "KNOWN_UNCOVERED":
      return { pill: "LOOKED · NO ROUTE", tone: "amber" };
    case "NO_SOURCE_FOUND":
      return { pill: "LOOKED · NO SOURCE", tone: "amber" };
    case "NOT_ATTEMPTED":
      return { pill: "NEVER WALKED", tone: "slate" };
    case "READ_UNRESOLVED":
      return { pill: "READ · UNRESOLVED", tone: "gold" };
    default:
      return { pill: "STATUS NOT RECORDED", tone: "gold" };
  }
}
