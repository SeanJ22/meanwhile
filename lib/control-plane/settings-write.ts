/**
 * **A SETTING CHANGED BY THE FACTORY (BR-05).**
 *
 * Sean changes settings through the gateway (`config.setSetting`), and those
 * log entries carry no name. When code itself changes a setting (a lane's tuning
 * step, a migration of an old value), it writes here, and the log names the part
 * of the factory that made it. Same validation, same history, same undo.
 */
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig } from "./gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { settingDefinition, withSetting, type SettingValue } from "./settings.ts";
import { publishReaderSettings } from "../civic-data/reader-settings-publication.ts";

export interface FactorySettingChange {
  /** Stable id for this change, so a retried call logs it once. */
  readonly id: string;
  readonly key: string;
  readonly value: SettingValue;
  /** Which part of the factory made the change, in plain words ("The runner", "The coach"). */
  readonly factory: string;
  readonly why: string;
  readonly at: string;
}

/** Write one factory change with a compare-and-set, retried once on a concurrent write. Returns false when the key or value is invalid. */
export async function setSettingAsFactory(repos: Pick<ControlPlaneRepositories, "adminConfig">, change: FactorySettingChange,
  options: { publish?: typeof publishReaderSettings } = {}): Promise<boolean> {
  const definition = settingDefinition(change.key);
  if (!definition || !definition.validate(change.value) || !change.factory.trim()) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(change.at);
    const next = withSetting(current, { id: change.id, key: change.key, after: change.value, at: change.at, why: change.why, factory: change.factory.trim() });
    if (next === current) return true;
    try {
      const written = held ? await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, held.revision, next, change.at)
        : (await repos.adminConfig.put(ADMIN_CONFIG_ID, next, change.at)).persisted;
      if (definition.readerFacing) await (options.publish ?? publishReaderSettings)(next, written.revision).catch(() => false);
      return true;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return false;
}
