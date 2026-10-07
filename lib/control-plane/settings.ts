/**
 * Typed settings on `AdminConfig.settings`, changed through one gateway action with every change logged for
 * undo. Each lane registers its keys with `registerSetting`; the runner reads them from the config it re-reads
 * every pass. A change names its maker only when factory code made it. Pure.
 */
import type { AdminConfig } from "./gateway/admin-config.ts";

export type SettingValue = null | boolean | number | string | readonly SettingValue[] | { readonly [key: string]: SettingValue };

/** How Admin offers a new value: a number box, On/Off, a line of text, or structured data. */
export type SettingControl = "number" | "boolean" | "text" | "json";

export interface SettingDefinition<T extends SettingValue = SettingValue> {
  /** Stable machine key, e.g. `detective.shutThreshold`. Never shown in Admin. */
  readonly key: string;
  /** What Admin calls it, in plain words. */
  readonly label: string;
  readonly defaultValue: T;
  /** Published to the reader edge when it changes (windows, topics, copy, switches). */
  readonly readerFacing: boolean;
  readonly validate: (value: unknown) => value is T;
  /** Plain unit words after a number ("failures", "minutes"). */
  readonly unit?: string;
  /** How Admin offers a new value. Defaults from the code default's type. */
  readonly control?: SettingControl;
}

export interface SettingChange {
  readonly id: string;
  readonly key: string;
  readonly before: SettingValue;
  readonly after: SettingValue;
  readonly at: string;
  /** Optional note. Empty when none was given. */
  readonly why: string;
  /** Human changes omit this field; only factory changes name their maker. */
  readonly factory?: string;
  /** The change this one undid, when it was an undo. */
  readonly undoOf?: string;
}

/** The log keeps the newest changes; older ones fall off the end. Undo only ever needs a key's newest change. */
export const SETTING_HISTORY_MAX = 500;

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;
const definitions = new Map<string, SettingDefinition>();

/** Each lane registers its keys here, with its own validation and code default. */
export function registerSetting<T extends SettingValue>(definition: SettingDefinition<T>): void {
  if (!KEY_PATTERN.test(definition.key) || !definition.validate(definition.defaultValue) || !definition.label.trim()) {
    throw new Error("Invalid setting definition");
  }
  const held = definitions.get(definition.key);
  if (held === definition) return;
  if (held) throw new Error(`Setting already registered: ${definition.key}`);
  definitions.set(definition.key, definition as unknown as SettingDefinition);
}


/** Consecutive failures before a door goes to a detective. The code default stays 3. */
export const DETECTIVE_SHUT_THRESHOLD_SETTING = "detective.shutThreshold";
registerSetting({
  key: DETECTIVE_SHUT_THRESHOLD_SETTING, label: "Failures before a detective is sent", defaultValue: 3, unit: "failures in a row",
  readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100,
});

/** The checklist items a county's residents most need, whose arrival the Scoreboard times from a mission's start. Changing it changes what the "time to core information live" figure waits for. */
export const CORE_ITEMS_SETTING = "scorecard.coreItems";
export const CORE_ITEMS_DEFAULT: readonly string[] = ["GOV-01", "GOV-02", "OFF-04", "MTG-06"];
registerSetting({
  key: CORE_ITEMS_SETTING, label: "Core resident information", defaultValue: CORE_ITEMS_DEFAULT, readerFacing: false, control: "json",
  validate: (value): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every((id) => typeof id === "string" && /^[A-Z]{2,4}-[A-Za-z0-9]{1,6}$/.test(id)),
});

/**
 * Controls that existed before the settings map keep their own field and action,
 * and log into the same history so the Settings view shows their changes and undo.
 */
export const SPEND_CEILING_LOG_KEY = "fleet.spendCeilingUsd";


export function settingDefinition(key: string): SettingDefinition | null { return definitions.get(key) ?? null; }
export function settingDefinitions(): readonly SettingDefinition[] { return [...definitions.values()]; }
export function controlOf(definition: SettingDefinition): SettingControl {
  if (definition.control) return definition.control;
  const v = definition.defaultValue;
  return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : typeof v === "string" ? "text" : "json";
}

/** Pass the newly read config each runner pass; no process-wide settings snapshot. An invalid stored value reads as the fallback. */
export function readSetting<T extends SettingValue>(config: AdminConfig | null, key: string, fallback: T): T {
  const definition = settingDefinition(key);
  const value = config?.settings?.[key];
  return definition && value !== undefined && definition.validate(value) ? value as T : fallback;
}
export function settingReader(config: AdminConfig | null) {
  return <T extends SettingValue>(key: string, fallback: T): T => readSetting(config, key, fallback);
}

/** Every change to one key, newest first. */
export function settingLog(config: AdminConfig | null, key: string): readonly SettingChange[] {
  return (config?.settingHistory ?? []).filter((entry) => entry.key === key).reverse();
}


function appendHistory(history: readonly SettingChange[], entry: SettingChange): readonly SettingChange[] {
  const next = [...history, entry];
  return next.length > SETTING_HISTORY_MAX ? next.slice(next.length - SETTING_HISTORY_MAX) : next;
}

/** Set a registered key and log it. Replaying the same change id changes nothing. */
export function withSetting(config: AdminConfig, change: Omit<SettingChange, "before">): AdminConfig {
  const definition = settingDefinition(change.key);
  if (!definition || !definition.validate(change.after)) throw new Error("Invalid setting value");
  const history = config.settingHistory ?? [];
  if (history.some((entry) => entry.id === change.id)) return config;
  if (change.undoOf && settingLog(config, change.key)[0]?.id !== change.undoOf) {
    throw new Error("This setting has changed again; refresh before undoing it");
  }
  const before = readSetting(config, change.key, definition.defaultValue);
  return { ...config, settings: { ...config.settings, [change.key]: change.after },
    settingHistory: appendHistory(history, { ...change, before }), updatedAt: change.at };
}

/** Log a change to a control that keeps its own field (the spend ceiling). Replaying the same id changes nothing. */
export function withLoggedChange(config: AdminConfig, change: SettingChange): AdminConfig {
  const history = config.settingHistory ?? [];
  if (history.some((entry) => entry.id === change.id)) return config;
  return { ...config, settingHistory: appendHistory(history, change) };
}

/** The undo for a change: only a key's newest change can be undone, so an undo never jumps over a later change. */
export function settingUndo(config: AdminConfig, id: string): { key: string; value: SettingValue; why: string; undoOf: string } | null {
  const entry = config.settingHistory?.find((change) => change.id === id);
  if (!entry || settingLog(config, entry.key)[0]?.id !== id) return null;
  return { key: entry.key, value: entry.before, why: entry.why ? `Undo: ${entry.why}` : "Undo", undoOf: id };
}

/** Only registered public keys cross into the reader edge. Logs and internal keys stay in Admin. */
export function readerSettings(config: AdminConfig | null): Readonly<Record<string, SettingValue>> {
  return Object.fromEntries(settingDefinitions().filter((definition) => definition.readerFacing)
    .map((definition) => [definition.key, readSetting(config, definition.key, definition.defaultValue)]));
}


/** What the runner applied on a pass, written into its heartbeat so Admin can say a value is in force. */
export interface RunnerSettingsApplied {
  /** When the runner read the config it applied: that pass's start. */
  readonly appliedAt: string;
  /** Every runner-side (not reader-facing) registered key, as the runner read it. */
  readonly values: Readonly<Record<string, SettingValue>>;
}

/** Build the heartbeat's `settings` field from the config this pass read. */
export function runnerSettingsEcho(config: AdminConfig | null, appliedAt: string): RunnerSettingsApplied {
  return { appliedAt, values: Object.fromEntries(settingDefinitions().filter((definition) => !definition.readerFacing)
    .map((definition) => [definition.key, readSetting(config, definition.key, definition.defaultValue)])) };
}


/** A value in plain words for Admin. */
export function settingValueWords(value: SettingValue, unit?: string): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return `${value.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
  if (typeof value === "string") return value === "" ? "(empty)" : `“${value}”`;
  if (Array.isArray(value)) return value.length ? value.map((v) => typeof v === "string" ? v : settingValueWords(v)).join(", ") : "(none)";
  return `${Object.keys(value).length.toLocaleString("en-US")} entries`;
}

/** Cadence registrations can speed checks up, but cannot exceed the adopted interval. */
export function meetingCheckInterval(maxMinutes: 60 | 720): (value: unknown) => value is number {
  return (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maxMinutes;
}
