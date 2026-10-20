import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { registerSetting, readSetting } from "../control-plane/settings.ts";
import type { MethodStatistics } from "./fix-map.ts";

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
/** How far back "still working today" looks. Older results still count toward the bar, but recent ones must hold it too. */
export const FIX_PROOF_RECENT_DAYS = "methods.proofRecentDays";
registerSetting({ key: FIX_PROOF_RECENT_DAYS, label: "Days of recent results a proven method must still pass", defaultValue: 30, unit: "days", readerFacing: false, validate: positive });
export function readFixProofRecentDays(config: AdminConfig | null): number {
  return readSetting(config, FIX_PROOF_RECENT_DAYS, 30);
}
export function readFixProofBar(config: AdminConfig | null): FixProofBar {
  return { places: readSetting(config, FIX_PROOF_PLACES, 5), areas: readSetting(config, FIX_PROOF_AREAS, 2), successShare: readSetting(config, FIX_PROOF_SHARE, 0.9) };
}
export function proofFromStatistics(stats: MethodStatistics, bar: FixProofBar = DEFAULT_FIX_PROOF_BAR, recent = true, multipleStates = false) {
  if (!positive(bar.places) || !positive(bar.areas) || !Number.isFinite(bar.successShare) || bar.successShare <= 0 || bar.successShare > 1) throw new Error("Invalid fix proof bar");
  const successShare = stats.tried ? stats.works / stats.tried : null;
  const whole = stats.works >= bar.places && Math.max(stats.states, stats.districts) >= bar.areas && (!multipleStates || stats.states > 1) && successShare !== null && successShare >= bar.successShare;
  const holds = !recent || stats.recentTried === 0 || stats.recentWorks / stats.recentTried >= bar.successShare;
  return { status: whole && holds ? "PROVEN" as const : "TESTING" as const, works: stats.works, tried: stats.tried,
    successShare, states: stats.states, districts: stats.districts,
    recentTried: whole && recent ? stats.recentTried : null, recentWorks: whole && recent ? stats.recentWorks : null };
}

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
  /** For a Proven update, the numbers it claims. */
  readonly claim?: { readonly kind: "FIX_PROVEN"; readonly methodId: string; readonly works: number; readonly failed: number };
}

export interface StandingEvent {
  /** Places where the method had worked and has now failed. */
  readonly brokeIn?: number;
  /** A lesson from its losses changed the method; it has to prove itself again. */
  readonly lesson?: string;
}

const places = (k: number): string => `${k.toLocaleString("en-US")} place${k === 1 ? "" : "s"}`;

export function nextStanding(methodId: string, prior: MethodStanding | null, proof: Pick<ReturnType<typeof proofFromStatistics>, "status" | "works" | "tried">, title: string, at: string,
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
    const where = (event.brokeIn ?? 0) > 0 ? `stopped working in ${places(event.brokeIn!)} where it had worked` : `no longer meets the proof bar on recent results`;
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
