import { readSetting, registerSetting } from "../control-plane/settings.ts";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { FIELD_KINDS, type FieldKind } from "./check.ts";
import type { Clocks, Query } from "./publish.ts";

type Hours = Readonly<Record<FieldKind, number>>;

const FRESHNESS_HOURS_SETTING = "facts.freshnessHours";
export const FRESHNESS_HOURS_DEFAULT: Hours = {
  officeholder: 720, contact: 720, comment_rule: 720, meeting: 168, agenda: 168, outcome: 720, vote: 8760,
  money: 2160, statement: 87600, portrait: 8760, ballot: 720, law: 8760, news: 87600, same_person_link: 87600,
};
const RETRY_MINUTES_SETTING = "facts.retryMinutes";
const RETRY_MINUTES_DEFAULT: Hours = {
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

/** The two fact clocks Sean sets, kept current: `refresh` reads them (one row) and says whether his settings changed since the last look. */
export function adminClocks(query: Query) {
  let version: string | undefined, clocks = factClocks(null);
  return { clocks: () => clocks, refresh: async () => {
    const [row] = await query(`SELECT md5((value->'settings')::text) AS version, jsonb_build_object('settings',jsonb_build_object('facts.freshnessHours',value#>'{settings,facts.freshnessHours}',
      'facts.retryMinutes',value#>'{settings,facts.retryMinutes}')) AS value FROM cp_admin_config WHERE id='current'`);
    if (row?.version === version) return false;
    clocks = factClocks((row?.value ?? null) as Parameters<typeof factClocks>[0]); version = String(row?.version);
    return true;
  } };
}
