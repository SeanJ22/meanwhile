import { DEFAULT_RADIUS_KM } from "./constants.ts";
import type { ResolvedMeetingSource } from "./snapshot-source.ts";
import { readReaderMeetingSettings } from "./reader-settings.ts";
import { type MeetingSearchResult, searchMeetingsFromSource } from "./query.ts";

export async function searchMeetings(
  lat: number,
  lng: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
  now: Date = new Date(),
  divisionsAtPoint: ReadonlySet<string> = new Set(),
  injectedSource?: ResolvedMeetingSource,
  shownSettings?: Pick<import("./settings.ts").MeetingSettings, "shownBackDays" | "shownAheadDays">,
  bodyIds: ReadonlySet<string> = new Set(),
  /** The bodies the registry lists; a meeting of any other body is placed by its own division. */
  registeredBodyIds?: ReadonlySet<string>,
): Promise<MeetingSearchResult> {
  const source = injectedSource ?? (await import("./registry.ts")).getMeetingSource();
  return searchMeetingsFromSource(lat, lng, radiusKm, now, divisionsAtPoint, source, shownSettings ?? await readReaderMeetingSettings(), bodyIds, registeredBodyIds);
}
