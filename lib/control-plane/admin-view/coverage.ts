/**
 * **WHERE THE GAPS ARE — BODIES, CODES AND CONTAINERS.** (Admin redesign,
 * 2026-09-23; the Readiness drilldown: state → county / district / metro →
 * its codes → one code.)
 *
 * Three facts, never merged:
 *
 * ```
 *   membership   a code (ZCTA) is in a container when the published Census
 *                lookup says it overlaps it, wholly or in part; a partly
 *                overlapping code is included whole (the design's settled rule)
 *   placement    a body is at a code when the reader's ZIP division index says
 *                its division's territory reaches that code — the reader's own
 *                rule for what governs a ZIP
 *   coverage     whether a body has a way in: its registry coverage status
 *                (LIVE or MANUAL = a recorded route; KNOWN_UNCOVERED and
 *                NO_SOURCE_FOUND = looked, no route; NOT_ATTEMPTED = never
 *                walked) — and, separately, whether we watch its meetings now
 * ```
 *
 * A body reaching three codes is one body: every container and every state
 * counts distinct bodies (MW-003), so no container can claim more than the
 * state holds. A code outside the ZIP index is `indexed: false` and is named
 * as such; it never reads as a code with no bodies.
 *
 * PURE.
 */
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
  /** Bodies whose meetings we read on the standing clock now, by their standing. */
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
  /** The indexed code with the lowest share of bodies with a way in; null when no code is indexed. */
  readonly worst: CodeStanding | null;
}

export function normaliseStatus(raw: unknown): CoverageStatus {
  return raw === "LIVE" || raw === "MANUAL" || raw === "KNOWN_UNCOVERED" || raw === "NO_SOURCE_FOUND" || raw === "NOT_ATTEMPTED" ? raw : "OTHER";
}

export function stateOfBody(id: string, ocdId: string | null): string | null {
  const m = /state:([a-z]{2})/.exec(ocdId ?? id) ?? /^curated:([a-z]{2})\//.exec(id);
  return m ? m[1] : null;
}

/** A registry body as the drilldown needs it; the name is the recorded one, or the division's own name. */
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

/** A later measured read supersedes an old registry label, for this exact body
 * only. A retained publication still proves a route existed when a newer read
 * fails; its current failure and freshness remain on the separate BodyView. */
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

/** Bodies by every division they sit in or also serve: built once per page, looked up per code. */
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

/** Distinct bodies whose division (or a division they also serve) is among these. */
export function bodiesAtDivisions(divisions: Iterable<string>, index: BodyIndex): RegistryBody[] {
  const seen = new Map<string, RegistryBody>();
  for (const d of divisions) for (const b of index.get(d) ?? []) seen.set(b.id, b);
  return [...seen.values()];
}

export function wayInShare(c: CoverageCounts): number | null {
  return c.bodies === 0 ? null : c.wayIn / c.bodies;
}

/**
 * A watched body (a meeting source we read) matches a registry body by id.
 * The registry id and the meeting contract's body id are the same identity
 * for every meeting body (checked 2026-09-23: 119 of 119).
 */
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

export function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

/** "wholly inside" / "65% inside — whole code included". */
export function overlapWords(whole: boolean, fraction: number | null): string {
  if (whole) return "wholly inside";
  if (fraction === null) return "partly inside (no land area) — whole code included";
  const p = Math.round(fraction * 100);
  return `${p < 1 ? "under 1" : p}% inside — whole code included`;
}

/** The worst-gap sentence for a container row, generated from its worst code. */
export function worstGapWords(c: ContainerStanding): string {
  if (c.indexedCodes === 0) return "No code here is in the ZIP index this repository has geometry for, so nothing is known about its bodies. That is not a zero.";
  const w = c.worst;
  if (w === null || w.counts === null) return "Its indexed codes place no registered body.";
  const k = w.counts;
  const missing = k.bodies - k.wayIn;
  if (missing === 0) return `${w.zcta5}: every one of its ${k.bodies} bodies has a way in recorded.`;
  const parts: string[] = [];
  if (k.neverWalked > 0) parts.push(`${k.neverWalked} never walked`);
  if (k.lookedNoRoute > 0) parts.push(`${k.lookedNoRoute} looked at with no route found`);
  if (k.other > 0) parts.push(`${k.other} whose coverage is unresolved`);
  const who = k.bodies === 1 ? "its only body has" : missing === k.bodies ? `all ${k.bodies} of its bodies have` : `${missing} of its ${k.bodies} bodies have`;
  return `${w.zcta5} at ${pct(k.wayIn, k.bodies)} — ${who} no way in recorded (${parts.join(", ")}).`;
}

/**
 * A body's coverage status as the owner reads it. The registry's own status
 * codes stay in this model — they are internal vocabulary and never render
 * (RULING 28); a screen draws only the words and the tone.
 */
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
