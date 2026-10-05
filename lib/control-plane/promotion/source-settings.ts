import type { AdminConfig } from "../gateway/admin-config.ts";
import { readSetting, registerSetting } from "../settings.ts";
import { DEFAULT_SOURCE_HOSTS, DEFAULT_SOURCE_KINDS, SOURCE_HOSTS_SETTING, SOURCE_KINDS_SETTING,
  validSourceHosts, validSourceKinds, type SourcePolicy } from "./source-kinds.ts";

registerSetting({ key: SOURCE_HOSTS_SETTING, label: "Kinds of sources by website", defaultValue: DEFAULT_SOURCE_HOSTS,
  readerFacing: false, control: "json", validate: validSourceHosts });
registerSetting({ key: SOURCE_KINDS_SETTING, label: "Which source kinds count", defaultValue: DEFAULT_SOURCE_KINDS,
  readerFacing: false, control: "json", validate: validSourceKinds });

export function publicationSourcePolicy(config: AdminConfig | null): SourcePolicy {
  return { hosts: readSetting(config, SOURCE_HOSTS_SETTING, DEFAULT_SOURCE_HOSTS),
    enabled: readSetting(config, SOURCE_KINDS_SETTING, DEFAULT_SOURCE_KINDS) };
}
