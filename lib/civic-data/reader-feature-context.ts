import { withFeatures } from "../control-plane/features.ts";
import { settingsEdgeStore, type SettingsEdgeStore } from "./reader-settings-publication.ts";

export async function withReaderFeatures<T>(run: () => Promise<T>, store?: SettingsEdgeStore): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let values = {};
  try {
    const read = (store ?? settingsEdgeStore()).read();
    const held = await Promise.race([read, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 350); })]);
    values = held?.snapshot.values ?? {};
  } catch {
    // Store failures preserve the committed switches and emergency environment overrides.
  } finally { clearTimeout(timer); }
  return withFeatures(values, run);
}
