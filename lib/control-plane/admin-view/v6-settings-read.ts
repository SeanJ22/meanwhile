import "../../ask/model.ts";
import "../../facts/clocks.ts";
import "../scheduler/provider-limits.ts";
/** The machine key travels as the control's target and is never rendered. */
import { fleetSpendCeilingOverrideUsd, type AdminConfig } from "../gateway/admin-config.ts";
import { resolveRollingCeiling } from "../fleet-safety.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import {
  controlOf, readSetting, settingDefinitions, settingLog, settingValueWords, SPEND_CEILING_LOG_KEY,
  type SettingControl, type SettingValue,
} from "../settings.ts";

export const SETTINGS_LOG_SHOWN = 20;

export interface SettingLogRow {
  readonly at: string;
  readonly beforeWords: string;
  readonly afterWords: string;
  readonly why: string | null;
    /** Named only when the factory made the change; the owner's own changes carry no name. */
  readonly by: string | null;
  readonly wasUndo: boolean;
}

export interface SettingRow {
  /** The control's target. Never rendered. */
  readonly key: string;
  readonly label: string;
  readonly valueWords: string;
  readonly valueInput: string;
  readonly isDefault: boolean;
  readonly changedAt: string | null;
  readonly control: SettingControl | "ceiling";
  readonly unit: string | null;
  readonly choices?: readonly { readonly value: string; readonly label: string }[];
  readonly inForce: { readonly where: "runner" | "readers" | "next-read"; readonly yes: boolean | null; readonly since: string | null };
  readonly undo: { readonly changeId: string; readonly value: string; readonly valueWords: string } | null;
  readonly log: readonly SettingLogRow[];
}

export interface SettingsView {
  readonly observedAt: string;
  readonly rows: readonly SettingRow[];
  readonly runnerAppliedAt: string | null;
}

function same(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function inputOf(value: SettingValue, control: SettingControl): string {
  if (control === "number") return typeof value === "number" ? String(value) : "";
  if (control === "boolean") return value === true ? "on" : "off";
  if (control === "text" || control === "choice") return typeof value === "string" ? value : "";
  return JSON.stringify(value);
}

function logRows(config: AdminConfig | null, key: string, words: (v: SettingValue) => string): readonly SettingLogRow[] {
  return settingLog(config, key).slice(0, SETTINGS_LOG_SHOWN).map((entry) => ({
    at: entry.at, beforeWords: words(entry.before), afterWords: words(entry.after),
    why: entry.why ? entry.why : null, by: entry.factory ?? null, wasUndo: Boolean(entry.undoOf),
  }));
}

export function projectSettings(input: {
  readonly config: AdminConfig | null;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly published: Readonly<Record<string, SettingValue>> | null;
  readonly observedAt: string;
}): SettingsView {
  const { config, heartbeat, published } = input;
  const applied = heartbeat?.settings ?? null;
  const rows: SettingRow[] = settingDefinitions().map((definition) => {
    const value = readSetting(config, definition.key, definition.defaultValue);
    const control = controlOf(definition);
    const words = (v: SettingValue) => settingValueWords(v, definition.unit, definition.choices);
    const log = logRows(config, definition.key, words);
    const newest = settingLog(config, definition.key)[0] ?? null;
    const inForce = definition.readerFacing
      ? { where: "readers" as const, yes: published === null ? null : same(published[definition.key], value), since: null }
      : { where: "runner" as const, yes: applied === null ? null : same(applied.values[definition.key], value),
          since: applied !== null && same(applied.values[definition.key], value) ? applied.appliedAt : null };
    return {
      key: definition.key, label: definition.label, valueWords: words(value), valueInput: inputOf(value, control),
      isDefault: config?.settings?.[definition.key] === undefined || same(value, definition.defaultValue) && !newest,
      changedAt: newest?.at ?? null, control, unit: definition.unit ?? null, ...(definition.choices ? { choices: definition.choices } : {}), inForce,
      undo: newest ? { changeId: newest.id, value: JSON.stringify(newest.before), valueWords: words(newest.before) } : null,
      log,
    };
  });
  const override = fleetSpendCeilingOverrideUsd(config);
  const ceiling = resolveRollingCeiling(override).rollingCeilingUsd;
  const dollars = (v: SettingValue) => typeof v === "number" ? `$${v.toFixed(2)} a day` : "—";
  const decided = config?.fleetSpendCeiling ?? null;
  // A ceiling set before the log existed still shows its one recorded change and its undo.
  const newestCeiling = settingLog(config, SPEND_CEILING_LOG_KEY)[0] ??
    (override !== null && decided ? { id: decided.receiptId, key: SPEND_CEILING_LOG_KEY, before: decided.previousUsd, after: decided.rollingCeilingUsd, at: decided.decidedAt, why: "" } : null);
  const ceilingLog = logRows(config, SPEND_CEILING_LOG_KEY, dollars);
  rows.unshift({
    key: SPEND_CEILING_LOG_KEY, label: "Most the workers may spend in any rolling 24 hours", valueWords: dollars(ceiling),
    valueInput: String(ceiling), isDefault: override === null, changedAt: newestCeiling?.at ?? null,
    control: "ceiling", unit: null, inForce: { where: "next-read", yes: null, since: null },
    // The ceiling control takes only an amount above $0 (stopping is a pause), so a change from the $0 default has no undo.
    undo: newestCeiling && typeof newestCeiling.before === "number" && newestCeiling.before > 0
      ? { changeId: newestCeiling.id, value: String(newestCeiling.before), valueWords: dollars(newestCeiling.before) } : null,
    log: ceilingLog.length || !newestCeiling ? ceilingLog
      : [{ at: newestCeiling.at, beforeWords: dollars(newestCeiling.before), afterWords: dollars(newestCeiling.after), why: null, by: null, wasUndo: false }],
  });
  return { observedAt: input.observedAt, rows, runnerAppliedAt: applied?.appliedAt ?? null };
}
