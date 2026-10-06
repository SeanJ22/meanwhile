/** Server-side read of the stance topics in force: the published setting, else the code default. */
import { readReaderSetting } from "../civic-data/reader-settings-publication.ts";
import type { SettingValue } from "../control-plane/settings.ts";
import { DEFAULT_STANCE_TOPICS, STANCE_TOPICS_SETTING, validStanceTopics, type StanceTopic } from "./topics.ts";

export async function readStanceTopics(): Promise<readonly StanceTopic[]> {
  const value = await readReaderSetting<SettingValue>(STANCE_TOPICS_SETTING, DEFAULT_STANCE_TOPICS as unknown as SettingValue);
  return validStanceTopics(value) ? value : DEFAULT_STANCE_TOPICS;
}
