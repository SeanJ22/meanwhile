/** The runner's one measured hour. Admin never reconstructs it from raw tables. */
import type { ControlPlaneRepositories } from "../repository/types.ts";

export interface HourlyVitalSigns {
  readonly from: string;
  readonly through: string;
  readonly readAt: string;
  /** Verified new or updated reader records, matching publication-flow's unit. */
  readonly factsLive: number | null;
  readonly factsLivePerHour: number | null;
  readonly settledSpendUsd: number | null;
  readonly costPerFactUsd: number | null;
  readonly neon: {
    readonly gbPerHour: number | null;
    /** Only measured causes. An empty list does not mean no transfer. */
    readonly causes: readonly { readonly cause: string; readonly gbPerHour: number | null }[];
  } | null;
  readonly rounds: { readonly finished: number | null; readonly killed: number | null } | null;
}
export interface VitalSignsReading { readonly row: HourlyVitalSigns | null }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const measured = (v: unknown): v is number | null => v === null || typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): boolean => measured(v) && (v === null || Number.isSafeInteger(v));
const instant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
/** Validate the whole row; malformed readings never turn into convincing partial numbers. */
export function isHourlyVitalSigns(v: unknown): v is HourlyVitalSigns {
  if (!object(v) || !instant(v.from) || !instant(v.through) || !instant(v.readAt)) return false;
  const elapsed = Date.parse(v.through) - Date.parse(v.from);
  if (elapsed !== 3_600_000 || Date.parse(v.readAt) < Date.parse(v.through)) return false;
  if (!integer(v.factsLive) || !measured(v.factsLivePerHour) || !measured(v.settledSpendUsd) || !measured(v.costPerFactUsd)) return false;
  if (v.factsLivePerHour !== v.factsLive) return false;
  if (v.factsLive === null || v.factsLive === 0 || v.settledSpendUsd === null) {
    if (v.costPerFactUsd !== null) return false;
  } else if (v.costPerFactUsd === null || Math.abs(v.costPerFactUsd as number - (v.settledSpendUsd as number) / (v.factsLive as number)) > 0.000001) return false;
  if (v.neon !== null) {
    if (!object(v.neon) || !measured(v.neon.gbPerHour) || !Array.isArray(v.neon.causes) || v.neon.causes.length > 30) return false;
    if (!v.neon.causes.every(c => object(c) && typeof c.cause === "string" && c.cause.trim().length > 0 && c.cause.length <= 240 && measured(c.gbPerHour))) return false;
  }
  return v.rounds === null || object(v.rounds) && integer(v.rounds.finished) && integer(v.rounds.killed);
}
/** One narrow point read, bounded to the row. No ledger, costs, rounds or provider API fallback. */
export async function readHourlyVitalSigns(repos: Pick<ControlPlaneRepositories, "ownerSnapshots">): Promise<HourlyVitalSigns | null> {
  const saved = await repos.ownerSnapshots.readNarrowed("current", { hourlyVitalSigns: true });
  const value: unknown = saved?.value;
  return object(value) && isHourlyVitalSigns(value.hourlyVitalSigns) ? value.hourlyVitalSigns : null;
}
