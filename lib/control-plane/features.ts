/** Per-pass and per-request switches; concurrent readers never share mutable settings. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AdminConfig } from "./gateway/admin-config.ts";
import { registerSetting, readSetting, type SettingValue } from "./settings.ts";

const context = new AsyncLocalStorage<Readonly<Record<string, SettingValue>>>();
export function featureKey(name: string): string { return `features.${name}`; }
export function registerFeature(name: string, label: string, fallback: boolean, readerFacing = false): void {
  registerSetting({ key: featureKey(name), label, defaultValue: fallback, readerFacing,
    validate: (v): v is boolean => typeof v === "boolean" });
}
export function readFeature(name: string, fallback: boolean, config?: AdminConfig | null): boolean {
  if (config !== undefined) return readSetting(config, featureKey(name), fallback);
  const value = context.getStore()?.[featureKey(name)];
  return typeof value === "boolean" ? value : fallback;
}
export function withFeatures<T>(values: Readonly<Record<string, SettingValue>>, run: () => T): T {
  return context.run(values, run);
}
