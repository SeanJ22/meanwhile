import type { AdminConfig } from "../gateway/admin-config.ts";
import { huntPlaceKey } from "./v6-hunts-read.ts";

/**
 * When a place's mission started: the time of the instruction that sent it (the `expansion.scope.set` receipt), kept on the saved
 * scope as `budgetStartedAt` for a lifetime hunt and `decidedAt` otherwise. The earliest across the saved scopes for exactly this place;
 * null when the place has no saved scope. A place never sent has no starting list, so nothing is called "added" there.
 */
export function missionStartOf(config: AdminConfig | null, placeKey: string): string | null {
  const times = (config?.expansionScopes ?? [])
    .filter((scope) => huntPlaceKey(scope) === placeKey)
    .map((scope) => scope.budgetStartedAt ?? scope.decidedAt)
    .filter((at) => Number.isFinite(Date.parse(at)));
  return times.length === 0 ? null : times.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}
