import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { readSetting, registerSetting } from "../control-plane/settings.ts";
import { DEFAULT_KINDS, KINDS_SETTING, kindTableValid, type KindTable } from "./kinds.ts";

registerSetting({ key: KINDS_SETTING, label: "Kinds of governments, bodies, offices and sources", control: "json",
  defaultValue: DEFAULT_KINDS, readerFacing: true, validate: kindTableValid });
/** Caller passes freshly read config, not a process-wide snapshot. */
export function runtimeKinds(config: AdminConfig | null): KindTable {
  return readSetting(config, KINDS_SETTING, DEFAULT_KINDS);
}
