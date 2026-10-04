import type { AdminConfig } from "./gateway/admin-config.ts";

export type SettingValue = null | boolean | number | string | readonly SettingValue[] | { readonly [key: string]: SettingValue };
export interface SettingDefinition<T extends SettingValue = SettingValue> {
  readonly key: string;
  readonly label: string;
  readonly defaultValue: T;
  readonly readerFacing: boolean;
  readonly validate: (value: unknown) => value is T;
}
export interface SettingChange {
  readonly id: string;
  readonly key: string;
  readonly before: SettingValue;
  readonly after: SettingValue;
  readonly at: string;
  readonly why: string;
  /** Human changes omit this field; only factory changes name their maker. */
  readonly factory?: string;
  readonly undoOf?: string;
}

const definitions = new Map<string, SettingDefinition>();
/** Each lane registers its keys here, with its own validation and code default. */
export function registerSetting<T extends SettingValue>(definition: SettingDefinition<T>): void {
  if (!/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(definition.key) || !definition.validate(definition.defaultValue)) {
    throw new Error("Invalid setting definition");
  }
  if (definitions.has(definition.key)) throw new Error(`Setting already registered: ${definition.key}`);
  definitions.set(definition.key, definition);
}
export const DETECTIVE_SHUT_THRESHOLD = "detective.shutThreshold";
registerSetting({ key: DETECTIVE_SHUT_THRESHOLD, label: "Failures before sending a detective", defaultValue: 3,
  readerFacing: false, validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 });

export function settingDefinition(key: string): SettingDefinition | null { return definitions.get(key) ?? null; }
export function settingDefinitions(): readonly SettingDefinition[] { return [...definitions.values()]; }
/** Pass the newly read config each runner pass; no process-wide settings snapshot. */
export function readSetting<T extends SettingValue>(config: AdminConfig | null, key: string, fallback: T): T {
  const definition = settingDefinition(key);
  const value = config?.settings?.[key];
  return definition && value !== undefined && definition.validate(value) ? value as T : fallback;
}
export function settingReader(config: AdminConfig | null) {
  return <T extends SettingValue>(key: string, fallback: T): T => readSetting(config, key, fallback);
}
export function withSetting(config: AdminConfig, change: Omit<SettingChange, "before">): AdminConfig {
  const definition = settingDefinition(change.key);
  if (!definition || !definition.validate(change.after)) throw new Error("Invalid setting value");
  const history = config.settingHistory ?? [];
  if (history.some(entry => entry.id === change.id)) return config;
  if (change.undoOf && [...history].reverse().find(entry => entry.key === change.key)?.id !== change.undoOf) {
    throw new Error("This setting has changed again; refresh before undoing it");
  }
  const before = readSetting(config, change.key, definition.defaultValue);
  return { ...config, settings: { ...config.settings, [change.key]: change.after },
    settingHistory: [...history, { ...change, before }], updatedAt: change.at };
}
export function settingUndo(config: AdminConfig, id: string): { key: string; value: SettingValue; why: string; undoOf: string } | null {
  const entry = config.settingHistory?.find(change => change.id === id);
  if (!entry || [...config.settingHistory!].reverse().find(change => change.key === entry.key)?.id !== id) return null;
  return { key: entry.key, value: entry.before, why: `Undo: ${entry.why}`, undoOf: id };
}
/** Only registered public keys cross into the reader edge. Logs and internal keys stay in Admin. */
export function readerSettings(config: AdminConfig): Readonly<Record<string, SettingValue>> {
  return Object.fromEntries(settingDefinitions().filter(definition => definition.readerFacing)
    .map(definition => [definition.key, readSetting(config, definition.key, definition.defaultValue)]));
}
/** Cadence registrations can speed checks up, but cannot exceed the adopted interval. */
export function meetingCheckInterval(maxMinutes: 60 | 720): (value: unknown) => value is number {
  return (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maxMinutes;
}
