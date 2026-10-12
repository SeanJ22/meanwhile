/** Server-side read of the owner's key-vote picks in force: the published setting, else the empty default. */
import { readReaderSetting } from "../civic-data/reader-settings-publication.ts";
import type { SettingValue } from "../control-plane/settings.ts";
import { DEFAULT_KEY_VOTE_PICKS, KEY_VOTE_PICKS_SETTING, validKeyVotePicks, type KeyVotePick } from "./key-vote-picks.ts";

export async function readKeyVotePicks(): Promise<readonly KeyVotePick[]> {
  try {
    const value = await readReaderSetting<SettingValue>(KEY_VOTE_PICKS_SETTING, DEFAULT_KEY_VOTE_PICKS as unknown as SettingValue);
    return validKeyVotePicks(value) ? value : DEFAULT_KEY_VOTE_PICKS;
  } catch {
    return DEFAULT_KEY_VOTE_PICKS;
  }
}
