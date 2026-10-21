import { createMeetingPartitionOwnership, reviewedGovernmentPairs } from "../control-plane/scheduler/meeting-ownership.ts";
import type { Jurisdiction } from "../hunt/jurisdiction-universe.ts";
import { loadRegistrationReference } from "../registration/reference.ts";
import type { plannerStateReads } from "./planner-state-read.ts";

/** Ownership needs reviewed body IDs, not rosters, portraits or the state's
 * complete reader registry. The existing resolver still owns every decision. */
export function plannerMeetingOwnership(input: {
  readonly root: string;
  readonly reads: ReturnType<typeof plannerStateReads>;
  readonly registryBodies: () => Iterable<Pick<Jurisdiction, "id" | "bodyId">>;
}) {
  const pairs = new Map<string, { id: string; bodyId: string }[]>();
  const prepared = new Set<string>();
  const ownership = createMeetingPartitionOwnership({
    readWiring: input.reads.wiring,
    readRegistration: input.reads.registration,
    registryBodies: () => [...input.registryBodies(), ...[...pairs.values()].flat()],
  });
  return { ...ownership,
    get source() { return ownership.source; },
    async readStates(states: Iterable<string>) {
      const wanted = [...new Set([...states].map(state => state.toLowerCase()).filter(state => /^[a-z]{2}$/.test(state)))];
      for (const state of wanted) {
        if (prepared.has(state)) continue;
        prepared.add(state);
        try {
          const [registration, reviewed] = await Promise.all([input.reads.registration(state), input.reads.bodyIds()]);
          if (registration.kind === "PROMOTED" && reviewed.kind === "PROMOTED") {
            pairs.set(state, [...reviewedGovernmentPairs(loadRegistrationReference(input.root, state),
              registration.value.vintage.referenceSha256, new Set(reviewed.value.ids))]);
          }
        } catch { /* The resolver records refused registration; an unpaired reviewed body stays UNKNOWN. */ }
      }
      await ownership.readStates(wanted);
    },
  };
}
