import { readReaderSetting, type SettingsEdgeStore } from "../civic-data/reader-settings-publication.ts";
import { DEFAULT_KINDS, KINDS_SETTING, kindTableValid, type KindTable } from "./kinds.ts";
export { runtimeKinds } from "./kinds-runtime.ts";

/** Site reads the existing edge settings blob; it never reads Admin's database. */
export async function readerKinds(store?: SettingsEdgeStore): Promise<KindTable> {
  const table = await readReaderSetting(KINDS_SETTING, DEFAULT_KINDS, store);
  return kindTableValid(table) ? table : DEFAULT_KINDS;
}
