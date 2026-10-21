import type { SettingsEdgeStore } from "../civic-data/reader-settings-publication.ts";
import { meetingSettingsFromValues, type MeetingSettings } from "./settings.ts";

/** Published settings only; an absent edge keeps the ordinary shown window. */
export async function readReaderMeetingSettings(store?: SettingsEdgeStore): Promise<MeetingSettings> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Start the place/database reads before loading the settings publication graph.
    const source=store ?? (await import("../civic-data/reader-settings-publication.ts")).settingsEdgeStore();
    const held = await Promise.race([source.read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 350); })]);
    return meetingSettingsFromValues(held?.snapshot.values);
  } catch { return meetingSettingsFromValues(); }
  finally { clearTimeout(timer); }
}
