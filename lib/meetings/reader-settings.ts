import { settingsEdgeStore, type SettingsEdgeStore } from "../civic-data/reader-settings-publication.ts";
import { meetingSettingsFromValues, type MeetingSettings } from "./settings.ts";

/** Published settings only; an absent edge keeps the ordinary shown window. */
export async function readReaderMeetingSettings(store?: SettingsEdgeStore): Promise<MeetingSettings> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const held = await Promise.race([(store ?? settingsEdgeStore()).read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 350); })]);
    return meetingSettingsFromValues(held?.snapshot.values);
  } catch { return meetingSettingsFromValues(); }
  finally { clearTimeout(timer); }
}
