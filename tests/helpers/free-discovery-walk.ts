import type { MeetingsDiscoveryNeed } from "../../lib/hunt/meetings-discovery.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";
import { writeFieldManual } from "../../lib/control-plane/field-manual.ts";
import { discoveryFieldManualEntries, walkMeetingsDiscoveryNeed, type DiscoveryRuntime } from "../../lib/control-plane/discovery/meetings-discovery-executor.ts";

/** Exercise the free walk directly; national platform scheduling has its own focused tests. */
export async function recordFreeDiscoveryWalks(input: {
  repos: Pick<ControlPlaneRepositories, "discoveryAttempts" | "fieldManual">;
  needs: readonly MeetingsDiscoveryNeed[];
  runtime: DiscoveryRuntime;
}) {
  for (const need of input.needs) {
    const attempt = await walkMeetingsDiscoveryNeed(need, input.runtime);
    await input.repos.discoveryAttempts.append(need.jurisdictionId, attempt.attemptId, attempt, attempt.finishedAt);
    const saved = await writeFieldManual(input.repos, discoveryFieldManualEntries(attempt), attempt.finishedAt);
    if (saved.error) throw new Error(saved.error);
  }
}
