import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { readSetting, registerSetting, type SettingValue } from "../control-plane/settings.ts";
import { meetingScheduleFromSettings } from "../meetings/settings.ts";
import type { RoutineCadencePolicy, SittingWindowSchedule } from "./contracts.ts";

const MINUTE = 60_000;
const defaults = {
  "sources.membersEveryMinutes": 1440,
  "sources.billsInSessionEveryMinutes": 1440,
  "sources.billsOutsideSessionEveryMinutes": 10080,
  "sources.moneyEveryMinutes": 10080,
  "sources.moneyDeadlineEveryMinutes": 1440,
  "sources.ballotsDuringElectionEveryMinutes": 1440,
  "sources.ballotsOutsideElectionEveryMinutes": 10080,
} as const;
const labels: Record<keyof typeof defaults, string> = {
  "sources.membersEveryMinutes": "Minutes between member checks",
  "sources.billsInSessionEveryMinutes": "Minutes between bill checks during a session",
  "sources.billsOutsideSessionEveryMinutes": "Minutes between bill checks outside a session",
  "sources.moneyEveryMinutes": "Minutes between money checks after filing deadlines",
  "sources.moneyDeadlineEveryMinutes": "Minutes between money checks on filing deadlines",
  "sources.ballotsDuringElectionEveryMinutes": "Minutes between ballot checks from filing deadline through election day",
  "sources.ballotsOutsideElectionEveryMinutes": "Minutes between ballot checks outside an election",
};
for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) registerSetting({
  key, label: labels[key], defaultValue: defaults[key], readerFacing: false, unit: "minutes",
  validate: (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= defaults[key],
});

export interface SourceCalendar {
  readonly scope: string;
  readonly kind: "session" | "election" | "filing";
  readonly startsAt: string;
  readonly endsAt: string;
}
const calendarsKey = "sources.calendars";
const intervalKey = "sources.intervalsMinutes";
const calendarsValid = (value: unknown): value is readonly (SourceCalendar & { readonly [key: string]: SettingValue })[] =>
  Array.isArray(value) && value.length <= 10000 && value.every(row => row !== null && typeof row === "object" &&
    typeof row.scope === "string" && row.scope.length > 0 && ["session", "election", "filing"].includes(row.kind) &&
    typeof row.startsAt === "string" && typeof row.endsAt === "string" && Number.isFinite(Date.parse(row.startsAt)) &&
    Number.isFinite(Date.parse(row.endsAt)) && Date.parse(row.startsAt) <= Date.parse(row.endsAt));
registerSetting({ key: calendarsKey, label: "Session, election and filing dates by place", defaultValue: [], readerFacing: false, control: "json", validate: calendarsValid });
registerSetting({ key: intervalKey, label: "Minutes between checks for individual sources", defaultValue: {}, readerFacing: false, control: "json",
  validate: (value): value is Record<string, number> => value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).length <= 10000 && Object.entries(value).every(([key, interval]) => key.length > 0 && typeof interval === "number" && Number.isFinite(interval) && interval >= 1) });

interface ClockTask {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly cadenceMs: number;
  readonly contract: { readonly cadence: RoutineCadencePolicy; readonly schedule?: SittingWindowSchedule };
}

export function applyRoutineClockSettings<T extends ClockTask>(task: T, config: AdminConfig | null, nowMs: number, heldCalendars: readonly SourceCalendar[] = []): T & { readonly clockBoundaryAt?: string } {
  const minuteValue = (key: keyof typeof defaults) => readSetting<number>(config, key, defaults[key]) * MINUTE;
  if (task.contract.schedule) return { ...task, contract: { ...task.contract,
    schedule: { ...task.contract.schedule, ...meetingScheduleFromSettings(config) } } };
  const calendars = [...heldCalendars, ...readSetting(config, calendarsKey, [] as readonly (SourceCalendar & { readonly [key: string]: SettingValue })[])]
    .filter(row => row.scope === task.sourceId || row.scope === task.scope || task.scope.startsWith(`${row.scope}:`));
  const family = task.recordClass === "STATE_LEGISLATOR" || task.recordClass === "FEDERAL_DIRECTORY" ? "members"
    : ["STATE_BILL", "STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES", "FEDERAL_ROLL_CALL", "FEDERAL_KEY_VOTE"].includes(task.recordClass) ? "bills"
    : ["FEC_FUNDING", "STATE_CAMPAIGN_FINANCE", "LOCAL_CAMPAIGN_FINANCE"].includes(task.recordClass) ? "money"
    : ["BALLOT_FILING", "BALLOT_CANDIDACY", "GOOGLE_CIVIC_VOTERINFO"].includes(task.recordClass) ? "ballots" : null;
  const kind = family === "bills" ? "session" : family === "money" ? "filing" : family === "ballots" ? "election" : null;
  const own = calendars.filter(row => row.kind === kind);
  const inside = own.some(row => Date.parse(row.startsAt) <= nowMs && nowMs <= Date.parse(row.endsAt));
  let cadenceMs = task.cadenceMs;
  if (family === "members") cadenceMs = minuteValue("sources.membersEveryMinutes");
  if (family === "bills") cadenceMs = minuteValue(inside || own.length === 0 ? "sources.billsInSessionEveryMinutes" : "sources.billsOutsideSessionEveryMinutes");
  if (family === "money") cadenceMs = minuteValue(inside ? "sources.moneyDeadlineEveryMinutes" : "sources.moneyEveryMinutes");
  if (family === "ballots") cadenceMs = minuteValue(inside || own.length === 0 ? "sources.ballotsDuringElectionEveryMinutes" : "sources.ballotsOutsideElectionEveryMinutes");
  const overrides = readSetting(config, intervalKey, {} as Record<string, number>);
  const override = overrides[task.id] ?? overrides[task.sourceId];
  if (override !== undefined) cadenceMs = Math.min(cadenceMs, override * MINUTE);
  const activeStarts = own.filter(row => Date.parse(row.startsAt) <= nowMs && nowMs <= Date.parse(row.endsAt)).map(row => Date.parse(row.startsAt));
  const boundaries = activeStarts.length ? [Math.max(...activeStarts)] : own.map(row => Date.parse(row.startsAt)).filter(at => at > nowMs);
  const clockBoundaryAt = boundaries.length ? new Date(Math.min(...boundaries)).toISOString() : undefined;
  return { ...task, cadenceMs, ...(clockBoundaryAt ? { clockBoundaryAt } : {}), contract: { ...task.contract,
    cadence: family !== null || override !== undefined ? { defaultEveryMs: cadenceMs, description: "Admin source clock" } : task.contract.cadence } };
}

export async function readHeldFinanceCalendars(
  query: (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  targets: readonly { readonly recordClass: string; readonly scope: string }[],
  now: string,
): Promise<readonly SourceCalendar[]> {
  const calendars: SourceCalendar[] = [];
  for (const target of targets) {
    const rows = await query(`SELECT DISTINCT due.value #>> '{}' AS deadline FROM civic_data_promotions p
      CROSS JOIN LATERAL jsonb_path_query(p.payload,
        '$.records[*].ourGap.nextDue') AS due(value)
      WHERE p.record_class = $1 AND p.scope = $2 AND jsonb_typeof(due.value) = 'string'
        AND due.value #>> '{}' >= substr($3, 1, 10)
      UNION
      SELECT p.payload #>> '{lineupReconciliation,agencyNextFilingDue,filingPeriodEndDate}' AS deadline
      FROM civic_data_promotions p WHERE p.record_class = $1 AND p.scope = $2
        AND p.payload #>> '{lineupReconciliation,agencyNextFilingDue,filingPeriodEndDate}' >= substr($3, 1, 10)
      ORDER BY deadline LIMIT 32`, [target.recordClass, target.scope, new Date(Date.parse(now) - 86_400_000).toISOString()]);
    for (const row of rows) {
      const date = String(row.deadline);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) continue;
      const state = /^(US-[A-Z]{2})(?=:|$)/.exec(target.scope)?.[1] ?? target.scope;
      calendars.push({ scope: state, kind: "filing", startsAt: new Date(date).toISOString(),
        endsAt: new Date(Date.parse(date) + 2 * 86_400_000 - 1).toISOString() });
    }
  }
  return calendars;
}
