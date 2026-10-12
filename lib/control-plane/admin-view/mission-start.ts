import type { AdminConfig } from "../gateway/admin-config.ts";
import { huntPlaceKey } from "./v6-hunts-read.ts";

/** Null when the place has no saved scope; a place never sent has no starting list, so nothing is called "added". */
export function missionStartOf(config: AdminConfig | null, placeKey: string): string | null {
  const times = (config?.expansionScopes ?? [])
    .filter((scope) => huntPlaceKey(scope) === placeKey)
    .map((scope) => scope.budgetStartedAt ?? scope.decidedAt)
    .filter((at) => Number.isFinite(Date.parse(at)));
  return times.length === 0 ? null : times.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}
