/**
 * **HOW LONG A DEAD END WAITS.** (DP-11; checklist REC-20.)
 *
 * A proven absence used to wait a fixed 30 days. It now waits as long as its
 * source's own pace (the cadence the obligation is checked on), or a number of
 * days the owner sets for its record class, and never longer than the longest a
 * dead end may wait, which starts at 5 days while the factory is expanding
 * (Sean, Oct 3). Both are Admin settings, read when the absence is recorded, so
 * a change applies to the next absence with no deploy.
 */
import type { AdminConfig } from "../gateway/admin-config.ts";
import { readSetting, registerSetting } from "../settings.ts";
import { scheduleObligation, type FreshnessObligation } from "./obligation.ts";

/** The longest a dead end may wait, in days. */
export const ABSENCE_MAX_HOLD_SETTING = "absence.maxHoldDays";
export const ABSENCE_MAX_HOLD_DEFAULT_DAYS = 5;
/** Days a dead end waits, per record class; a class not named waits its source's own pace. */
export const ABSENCE_HOLD_BY_CLASS_SETTING = "absence.holdDaysByClass";

const isDays = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 365;

registerSetting({
  key: ABSENCE_MAX_HOLD_SETTING, label: "Longest a dead end may wait", defaultValue: ABSENCE_MAX_HOLD_DEFAULT_DAYS, unit: "days",
  readerFacing: false, control: "number", validate: isDays,
});
registerSetting<{ readonly [recordClass: string]: number }>({
  key: ABSENCE_HOLD_BY_CLASS_SETTING, label: "How long a dead end waits, by kind of record (unnamed kinds wait their source's own pace)",
  defaultValue: {}, readerFacing: false, control: "json",
  validate: (value): value is { readonly [recordClass: string]: number } =>
    !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isDays),
});

export interface AbsenceHold {
  readonly until: string;
  /** One plain line saying where the length came from. */
  readonly basis: string;
}

/** When an absence recorded `now` for this obligation ends, under the owner's two settings. */
export function absenceHold(obligation: FreshnessObligation, now: string, config: AdminConfig | null): AbsenceHold {
  const nowMs = Date.parse(now);
  const maxDays = readSetting(config, ABSENCE_MAX_HOLD_SETTING, ABSENCE_MAX_HOLD_DEFAULT_DAYS);
  const byClass = readSetting<{ readonly [recordClass: string]: number }>(config, ABSENCE_HOLD_BY_CLASS_SETTING, {});
  const named = byClass[obligation.recordClass];
  const scheduled = scheduleObligation({ ...obligation, readerImpactAt: null }, nowMs);
  /* "Daily, for want of any signal" is not the source's pace; such a dead end waits the longest wait. */
  const paceDays = "cadenceHours" in scheduled && scheduled.cadenceSource !== "DEFAULT_NO_SIGNAL" ? scheduled.cadenceHours / 24 : null;
  const [days, why] = named !== undefined ? [named, `set for ${obligation.recordClass}`]
    : paceDays !== null ? [paceDays, "its source's own pace"] : [maxDays, "the longest a dead end may wait"];
  const held = Math.min(days, maxDays);
  return { until: new Date(nowMs + held * 86_400_000).toISOString(),
    basis: held < days ? `${maxDays} days, the longest a dead end may wait (${why} is longer)` : `${+held.toFixed(2)} days, ${why}` };
}
