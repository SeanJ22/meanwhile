import { failedAcquisitionCandidate } from "./candidate-builders.ts";
import { authorityFor } from "./source-authority.ts";
import type { RoutineCandidate } from "./types.ts";

/**
 * A meeting source whose read failed records that failure under the first request its registered publication rules
 * accept. A request the rules refuse (a plain-HTTP page, a route off the source's hosts) cannot name the attempt, so
 * it is stated in the failure itself with its rule code, and the board's true outcome is still recorded.
 */
export function failedMeetingAcquisitionCandidate(input: {
  readonly sourceId: string;
  readonly scope: string;
  readonly acquisitions: readonly { readonly requestedUrl: string }[] | undefined;
  readonly attemptedAt: string;
  readonly failureDetail: string;
}): RoutineCandidate {
  let requestedUrl = "";
  const refused = new Map<string, string>();
  for (const { requestedUrl: url } of input.acquisitions ?? []) {
    const authority = authorityFor(input.sourceId, "MEETING", url);
    if (authority.ok) { requestedUrl ||= url; continue; }
    if (refused.size < 3 && !refused.has(url)) refused.set(url, `${authority.code}: ${authority.detail}`);
  }
  const failureDetail = refused.size === 0 ? input.failureDetail
    : `${input.failureDetail} The read also requested what this source's publication rules refuse: ${[...refused.values()].join("; ")}`;
  return failedAcquisitionCandidate({ sourceId: input.sourceId, recordClass: "MEETING", scope: input.scope, requestedUrl,
    attemptedAt: input.attemptedAt, failureDetail, parserVersion: "meetings-composite/2" });
}
