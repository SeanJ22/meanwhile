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
