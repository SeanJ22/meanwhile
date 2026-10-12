/** Definitions live with the meeting readers; the shared settings registry loads this module. */
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { registerSetting, readSetting, type SettingValue } from "../control-plane/settings.ts";
import { CONCLUDED_LOOKBACK_DAYS, UPCOMING_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS, MEETING_HELD_HORIZON_DAYS } from "./constants.ts";

export const MEETING_SETTING_DEFAULTS = {
  "meetings.shownBackDays": CONCLUDED_LOOKBACK_DAYS, "meetings.shownAheadDays": UPCOMING_HORIZON_DAYS,
  "meetings.heldBackDays": MEETING_HELD_LOOKBACK_DAYS, "meetings.heldAheadDays": MEETING_HELD_HORIZON_DAYS,
  "meetings.hourlyWindowDays": 7, "meetings.postedToLiveTargetMinutes": 60,
  "meetings.hotEveryMinutes": 60, "meetings.baseEveryMinutes": 720,
} as const;
export type MeetingSettingKey = keyof typeof MEETING_SETTING_DEFAULTS;
const labels: Record<MeetingSettingKey, string> = {
  "meetings.shownBackDays": "Past meeting days shown", "meetings.shownAheadDays": "Upcoming meeting days shown",
  "meetings.heldBackDays": "Past meeting days kept", "meetings.heldAheadDays": "Upcoming meeting days kept",
  "meetings.hourlyWindowDays": "Days around a meeting with frequent checks", "meetings.postedToLiveTargetMinutes": "Minutes from a meeting update to readers",
  "meetings.hotEveryMinutes": "Minutes between checks near a meeting", "meetings.baseEveryMinutes": "Minutes between other meeting checks",
};
export function validMeetingSetting(key: MeetingSettingKey, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  if (key === "meetings.hotEveryMinutes" || key === "meetings.postedToLiveTargetMinutes") return value <= 60;
  if (key === "meetings.baseEveryMinutes") return value <= 720;
  if (!Number.isSafeInteger(value)) return false;
  if (key === "meetings.hourlyWindowDays") return value >= 7;
  if (key.startsWith("meetings.held")) return value >= 120;
  return true;
}
for (const key of Object.keys(MEETING_SETTING_DEFAULTS) as MeetingSettingKey[]) registerSetting({
  key, label: labels[key], defaultValue: MEETING_SETTING_DEFAULTS[key], readerFacing: key.startsWith("meetings.shown"),
  unit: key.endsWith("Days") ? "days" : "minutes", validate: (v): v is number => validMeetingSetting(key, v),
});
export interface MeetingSettings { readonly shownBackDays: number; readonly shownAheadDays: number; readonly heldBackDays: number; readonly heldAheadDays: number;
  readonly hourlyWindowDays: number; readonly postedToLiveTargetMinutes: number; readonly hotEveryMinutes: number; readonly baseEveryMinutes: number }
export function meetingSettingsFromValues(values: Readonly<Record<string, SettingValue>> = {}): MeetingSettings {
  return Object.fromEntries((Object.keys(MEETING_SETTING_DEFAULTS) as MeetingSettingKey[]).map(key =>
    [key.slice("meetings.".length), validMeetingSetting(key, values[key]) ? values[key] : MEETING_SETTING_DEFAULTS[key]])) as unknown as MeetingSettings;
}
export function readMeetingSettings(config: AdminConfig | null): MeetingSettings {
  return meetingSettingsFromValues(Object.fromEntries((Object.keys(MEETING_SETTING_DEFAULTS) as MeetingSettingKey[])
    .map(key => [key, readSetting(config, key, MEETING_SETTING_DEFAULTS[key])])));
}
/** Required schedules can go faster and their hourly window can grow, never shrink. */
export function meetingScheduleFromSettings(config: AdminConfig | null) {
  const settings = readMeetingSettings(config);
  return { kind: "SITTING_WINDOW" as const, windowMs: settings.hourlyWindowDays * 86_400_000,
    hotEveryMs: settings.hotEveryMinutes * 60_000, baseEveryMs: settings.baseEveryMinutes * 60_000 };
}

/** Wider held acquisition windows; this does not remove permanent meeting history. */
export function meetingHeldWindowFromSettings(anchor: string, config: AdminConfig | null) {
  const now = Date.parse(anchor); if (!Number.isFinite(now)) return null;
  const settings = readMeetingSettings(config);
  return { lowerBound: new Date(now - settings.heldBackDays * 86_400_000).toISOString(),
    upperBound: new Date(now + settings.heldAheadDays * 86_400_000).toISOString() };
}
