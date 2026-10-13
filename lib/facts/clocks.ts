import { readSetting, registerSetting } from "../control-plane/settings.ts";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { FIELD_KINDS, type FieldKind } from "./check.ts";
import type { Clocks } from "./publish.ts";

type Hours = Readonly<Record<FieldKind, number>>;

export const FRESHNESS_HOURS_SETTING = "facts.freshnessHours";
export const FRESHNESS_HOURS_DEFAULT: Hours = {
  officeholder: 720, contact: 720, comment_rule: 720, meeting: 168, agenda: 168, outcome: 720, vote: 8760,
  money: 2160, statement: 87600, portrait: 8760, ballot: 720, law: 8760, news: 87600, same_person_link: 87600,
};
export const RETRY_MINUTES_SETTING = "facts.retryMinutes";
export const RETRY_MINUTES_DEFAULT: Hours = {
  officeholder: 1440, contact: 1440, comment_rule: 1440, meeting: 60, agenda: 60, outcome: 60, vote: 1440,
  money: 1440, statement: 1440, portrait: 1440, ballot: 720, law: 1440, news: 1440, same_person_link: 1440,
};

const perKind = (value: unknown): value is Hours => typeof value === "object" && value !== null && !Array.isArray(value) &&
  FIELD_KINDS.every(kind => { const n = (value as Record<string, unknown>)[kind]; return typeof n === "number" && Number.isFinite(n) && n > 0; });

registerSetting({ key: FRESHNESS_HOURS_SETTING, label: "How old a saved page can be to prove a fact, in hours, by kind of fact",
  defaultValue: FRESHNESS_HOURS_DEFAULT, readerFacing: false, control: "json", validate: perKind });
registerSetting({ key: RETRY_MINUTES_SETTING, label: "Minutes before a blank is tried again, by kind of fact",
  defaultValue: RETRY_MINUTES_DEFAULT, readerFacing: false, control: "json", validate: perKind });

export function factClocks(config: AdminConfig | null): Clocks {
  const hours = readSetting<Hours>(config, FRESHNESS_HOURS_SETTING, FRESHNESS_HOURS_DEFAULT);
  const retry = readSetting<Hours>(config, RETRY_MINUTES_SETTING, RETRY_MINUTES_DEFAULT);
  return { windowHours: kind => hours[kind], retryMinutes: kind => retry[kind] };
}
