/** DP-23. A proof label is a measurement; it never holds back a verified fact. */
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { registerSetting, readSetting } from "../control-plane/settings.ts";
import { applyFixResult, type FixMapRow } from "./fix-map.ts";

export interface FixProofBar { readonly places: number; readonly areas: number; readonly successShare: number }
export const DEFAULT_FIX_PROOF_BAR: FixProofBar = { places: 5, areas: 2, successShare: 0.9 };
export const FIX_PROOF_PLACES = "methods.proofPlaces";
export const FIX_PROOF_AREAS = "methods.proofAreas";
export const FIX_PROOF_SHARE = "methods.proofSuccessShare";
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
registerSetting({ key: FIX_PROOF_PLACES, label: "Places where a method must work", defaultValue: 5, unit: "places", readerFacing: false, validate: positive });
registerSetting({ key: FIX_PROOF_AREAS, label: "Different districts or states needed to prove a method", defaultValue: 2, readerFacing: false, validate: positive });
registerSetting({ key: FIX_PROOF_SHARE, label: "Share of tried places where a method must work", defaultValue: 0.9, readerFacing: false,
  validate: (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 });
export function readFixProofBar(config: AdminConfig | null): FixProofBar {
  return { places: readSetting(config, FIX_PROOF_PLACES, 5), areas: readSetting(config, FIX_PROOF_AREAS, 2), successShare: readSetting(config, FIX_PROOF_SHARE, 0.9) };
}
export interface FixProofGeography {
  /** Held district and state identifiers per place; missing geography cannot establish spread. */
  readonly places?: Readonly<Record<string, { readonly district?: string; readonly state?: string }>>;
  /** True when this kind of door is known to exist in more than one state. */
  readonly multipleStates?: boolean;
}
function geography(place: string, held: FixProofGeography) {
  const state = place.match(/(?:^|\/)state:([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase();
  const district = place.match(/^(.+\/(?:county|congressional-district|sldu|sldl|school-district):[^/]+)/)?.[1];
  return { state, district, ...held.places?.[place] };
}
export function fixProof(map: readonly FixMapRow[], bar: FixProofBar = DEFAULT_FIX_PROOF_BAR, held: FixProofGeography = {}) {
  if (!positive(bar.places) || !positive(bar.areas) || !Number.isFinite(bar.successShare) || bar.successShare <= 0 || bar.successShare > 1) throw new Error("Invalid proof bar");
  if (new Set(map.map(r => r.methodId)).size > 1) throw new Error("Read one method's map before measuring proof");
  const latest = new Map<string, FixMapRow>();
  for (const row of map) latest.set(row.placeId, applyFixResult(latest.get(row.placeId) ?? null, row));
  const works = [...latest.values()].filter(r => r.state === "WORKS");
  const failures = [...latest.values()].filter(r => r.state === "FAILS");
  const states = new Set(works.map(r => geography(r.placeId, held).state).filter(Boolean));
  const districts = new Set(works.map(r => geography(r.placeId, held).district).filter(Boolean));
  const tried = works.length + failures.length;
  const share = tried ? works.length / tried : null;
  const spread = Math.max(states.size, districts.size) >= bar.areas && (!held.multipleStates || states.size > 1);
  return { status: works.length >= bar.places && spread && share !== null && share >= bar.successShare ? "PROVEN" as const : "TESTING" as const,
    works: works.length, tried, successShare: share, states: states.size, districts: districts.size,
    failingPlaces: failures.map(r => r.placeId).sort() };
}
export function fixStatus(map: readonly FixMapRow[], bar: FixProofBar = DEFAULT_FIX_PROOF_BAR, held: FixProofGeography = {}): "TESTING" | "PROVEN" {
  return fixProof(map, bar, held).status;
}

/* ------------------------------------------- DP-26: shown once, then quiet */

/**
 * Where a method stands, kept so each status change is told once. TESTING is a
 * queue row; PROVEN is quiet. `brokeAt` stays on a proven fix that broke, so
 * the Scoreboard can name it.
 */
export interface MethodStanding {
  readonly methodId: string;
  /** Plain words for Admin; the id never shows. */
  readonly title: string;
  readonly status: "TESTING" | "PROVEN";
  readonly works: number;
  readonly tried: number;
  /** When it entered this status. */
  readonly since: string;
  readonly provenAt: string | null;
  readonly brokeAt: string | null;
  readonly lessonAt: string | null;
}

export type StandingUpdateKind = "PROVEN" | "LESSON" | "BROKE";

export interface StandingUpdate {
  readonly id: string;
  readonly kind: StandingUpdateKind;
  readonly what: string;
  readonly at: string;
  readonly label: "PROVEN" | "TESTING";
  /** A setback is never shown as a win. */
  readonly setback: boolean;
  /** For a Proven update, the numbers it claims (DP-33 recomputes them). */
  readonly claim?: { readonly kind: "FIX_PROVEN"; readonly methodId: string; readonly works: number; readonly failed: number };
}

export interface StandingEvent {
  /** Places where the method had worked and has now failed. */
  readonly brokeIn?: number;
  /** A lesson from its losses changed the method; it has to prove itself again. */
  readonly lesson?: string;
}

const places = (k: number): string => `${k.toLocaleString("en-US")} place${k === 1 ? "" : "s"}`;

/**
 * The next standing and the one update a status change writes, if any. A first
 * result enters Testing quietly (the queue shows it); proving out, a lesson and
 * a proven fix breaking each write one update. Nothing else writes.
 */
export function nextStanding(methodId: string, prior: MethodStanding | null, proof: ReturnType<typeof fixProof>, title: string, at: string,
  event: StandingEvent = {}): { readonly standing: MethodStanding; readonly update: StandingUpdate | null } {
  const failed = proof.tried - proof.works;
  const base = { methodId, title: title.trim() || prior?.title || "A reusable way in", works: proof.works, tried: proof.tried };
  const update = (kind: StandingUpdateKind, what: string, label: StandingUpdate["label"], setback: boolean): StandingUpdate =>
    ({ id: `fix-status:${base.methodId}:${kind.toLowerCase()}:${at}`, kind, what, at, label, setback });
  const keep = (s: Partial<MethodStanding>): MethodStanding => ({
    since: prior?.since ?? at, provenAt: prior?.provenAt ?? null, brokeAt: prior?.brokeAt ?? null, lessonAt: prior?.lessonAt ?? null,
    status: prior?.status ?? "TESTING", ...base, ...s,
  });
  if (event.lesson?.trim()) {
    const standing = keep({ status: "TESTING", since: at, lessonAt: at, provenAt: null });
    return { standing, update: update("LESSON", `A lesson changed ${base.title}: ${event.lesson.trim().replace(/\.$/, "")}. It is being tested again.`, "TESTING", false) };
  }
  if (prior?.status === "PROVEN" && ((event.brokeIn ?? 0) > 0 || proof.status === "TESTING")) {
    const standing = keep({ status: proof.status, since: proof.status === prior.status ? prior.since : at, brokeAt: at });
    const where = (event.brokeIn ?? 0) > 0 ? `stopped working in ${places(event.brokeIn!)} where it had worked` : `failed in new places`;
    const still = proof.status === "PROVEN" ? "It is still proven" : "It is back in testing";
    return { standing, update: update("BROKE", `A proven fix broke: ${base.title} ${where}. ${still}: works in ${places(proof.works)} of ${places(proof.tried)} tried.`, "TESTING", true) };
  }
  if (proof.status === "PROVEN" && prior?.status !== "PROVEN") {
    const standing = keep({ status: "PROVEN", since: at, provenAt: at });
    return { standing, update: { ...update("PROVEN", `Proven: ${base.title} worked in ${places(proof.works)}, failed in ${places(failed)}.`, "PROVEN", false),
      claim: { kind: "FIX_PROVEN", methodId, works: proof.works, failed } } };
  }
  return { standing: keep({ status: prior?.status ?? "TESTING" }), update: null };
}

export const METHOD_STANDINGS_CAP = 1000;

/** Keeps the list bounded: the oldest quiet proven fixes that never broke go first; fixes in testing are never dropped. */
export function capStandings(list: readonly MethodStanding[]): readonly MethodStanding[] {
  if (list.length <= METHOD_STANDINGS_CAP) return list;
  const quiet = list.filter((s) => s.status === "PROVEN" && s.brokeAt === null).sort((a, b) => a.since.localeCompare(b.since));
  const drop = new Set(quiet.slice(0, list.length - METHOD_STANDINGS_CAP).map((s) => s.methodId));
  return list.filter((s) => !drop.has(s.methodId));
}
