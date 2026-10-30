import { registerSetting } from "../settings.ts";

/** The longest a dead end may wait before another free try, in days. */
export const ABSENCE_MAX_HOLD_SETTING = "absence.maxHoldDays";
export const ABSENCE_MAX_HOLD_DEFAULT_DAYS = 5;

registerSetting({
  key: ABSENCE_MAX_HOLD_SETTING, label: "Longest a dead end may wait", defaultValue: ABSENCE_MAX_HOLD_DEFAULT_DAYS, unit: "days",
  readerFacing: false, control: "number", validate: (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 365,
});
