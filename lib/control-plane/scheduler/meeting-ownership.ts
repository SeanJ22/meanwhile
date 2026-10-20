import { readDerivedMeetingWiring, type DerivedWiringProjection } from "../../civic-data/derived-meeting-wiring.ts";
import { MEETING_PARTITION_CONTRACTS } from "../../civic-data/meeting-partitions.ts";
import type { CivicDataReadResult } from "../../civic-data/read-model.ts";
import type { RegistrationReadModel } from "../../registration/candidate.ts";
import { readRegistrationProjection } from "../../registration/reader.ts";
import { loadRegistrationReference, type LoadedReference } from "../../registration/reference.ts";
import { readRegistryRuntimeProjection } from "../../registry/runtime-read-model.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import { promotedRegistries, type MeetingPartitionOwnership } from "./provider-inputs.ts";

/** Registration intentionally omits governments already held by the reviewed registry.
 * Recover only their exact Census reference joins, bound to the promoted source vintage. */
export function reviewedGovernmentPairs(reference: LoadedReference, referenceSha256: string, reviewed: ReadonlySet<string>): readonly { id: string; bodyId: string }[] {
  if (reference.sha256 !== referenceSha256) throw new Error("MEETING_OWNERSHIP_REFERENCE_VERSION_MISMATCH");
  return reference.reference.governments.flatMap(([, id, , kind, division, , alternate]) => {
    if (kind === "STATE" || division < 0) return [];
    const suffix = kind === "SCHOOL DISTRICT" || kind === "DEPENDENT SCHOOL SYSTEM" ? "board" : "governing";
    const candidates = [...new Set([division, alternate].filter(i => i >= 0).map(i => `${reference.reference.divisions[i]?.[0]}#${suffix}`))].filter(body => reviewed.has(body));
    // Carry every conflict to ownerOf, which refuses a government with two body IDs.
    return candidates.map(bodyId => ({ id, bodyId }));
  });
}

/** One cycle's exact government/body join. Never join display names, hosts or county membership. */
export function createMeetingPartitionOwnership(input: {
  readonly root?: string;
  readonly readWiring?: (state: string) => Promise<CivicDataReadResult<DerivedWiringProjection>>;
  readonly readRegistration?: (state: string) => Promise<CivicDataReadResult<RegistrationReadModel>>;
  readonly staticBodies?: ReadonlySet<string>;
  readonly registryBodies?: () => Iterable<{ readonly id: string; readonly bodyId?: string | null }>;
} = {}): MeetingPartitionOwnership & { readStates(states: Iterable<string>): Promise<void>; release(): void } {
  const staticBodies = input.staticBodies ?? new Set(MEETING_PARTITION_CONTRACTS.filter(p => p.derivedFamily === null).map(p => p.bodyId));
  const familyStates = new Set<string>(MEETING_PARTITION_CONTRACTS.flatMap(p => p.derivedFamily === null ? [] : [p.derivedFamily]));
  const bodies = new Map<string, Set<string>>();
  const states = new Set<string>();
  const failures = new Map<string, string>();
  const derivedBodies = new Set<string>();
  let wiringRead = false;
  const wiringKnown = new Set<string>();
  const add = (id: string, bodyId: string) => {
    const set = bodies.get(id) ?? new Set<string>();
    set.add(bodyId);
    bodies.set(id, set);
  };
  const registryBodies = input.registryBodies ?? (() => {
    const reading = promotedRegistries();
    return "registries" in reading ? [...reading.registries.values()].flatMap(r => r.jurisdictions) : [];
  });
  return {
    release() { bodies.clear(); states.clear(); failures.clear(); derivedBodies.clear(); wiringKnown.clear(); wiringRead = false; },
    get source() {
      return `exact registered government/body IDs and production meeting partitions; ${!wiringRead ? "source readings not started" : [...failures.values()].join("; ") || "source readings complete"}`;
    },
    ownerOf(jurisdictionId) {
      const ids = new Set(bodies.get(jurisdictionId) ?? []);
      if (ids.size !== 1) return "UNKNOWN";
      const body = [...ids][0]!;
      if (staticBodies.has(body) || derivedBodies.has(body)) return "PARTITION";
      return wiringKnown.has(jurisdictionId.split(":")[0].toLowerCase()) ? "NONE" : "UNKNOWN";
    },
    bodyIdFor(jurisdictionId) {
      const ids = bodies.get(jurisdictionId);
      return ids?.size === 1 ? [...ids][0]! : null;
    },
    reasonFor(jurisdictionId) {
      const ids = bodies.get(jurisdictionId);
      if (!ids?.size) {
        const readFailure = failures.get(jurisdictionId.split(":")[0]);
        return `${jurisdictionId}: no exact registered governing-body identity; ${readFailure ? `${readFailure}; recover the authority reading` : "resolve its Census/registry pairing"} before assigning its meeting clock`;
      }
      if (ids.size !== 1) return `${jurisdictionId}: conflicting exact governing-body IDs (${[...ids].sort().join(", ")}); repair the identity conflict`;
      const body = [...ids][0]!;
      if (staticBodies.has(body) || derivedBodies.has(body)) return `${jurisdictionId}: the ${body} production partition owns this meeting clock`;
      if (!wiringKnown.has(jurisdictionId.split(":")[0].toLowerCase())) return `${jurisdictionId}: ${failures.get("wiring") ?? "meeting source wiring has not been read"}; recover that reading before opening a second clock`;
      return `${jurisdictionId}: ${body} has no existing production meeting partition; its registered acquisition route owns the work`;
    },
    async readStates(wanted) {
      // A registry can be installed later in this same cycle by an Admin scope.
      for (const row of registryBodies()) if (row.bodyId) add(row.id, row.bodyId);
      for (const state of new Set([...wanted].map(s => s.toLowerCase()).filter(s => /^[a-z]{2}$/.test(s)))) {
        if (states.has(state)) continue;
        states.add(state);
        wiringRead = true;
        try {
          const read = await (input.readWiring ?? (state => readDerivedMeetingWiring({ state, bypassCache: true })))(state);
          if (read.kind === "PROMOTED" || read.kind === "NOT_RECORDED") wiringKnown.add(state);
          if (read.kind === "PROMOTED") {
            for (const { row } of read.value.records) {
              if (!familyStates.has(row.state) || row.state !== `US-${state.toUpperCase()}`) continue;
              // Suspended routes still own their partition and its last verified data.
              derivedBodies.add(row.bodyId);
              if (/#(?:governing|board)$/.test(row.bodyId)) add(row.jurisdictionId, row.bodyId);
            }
          } else if (!wiringKnown.has(state)) failures.set("wiring", `${state.toUpperCase()} meeting source wiring is ${read.kind}`);
        } catch (error) {
          failures.set("wiring", `${state.toUpperCase()} meeting source wiring unread: ${sanitizedErrorDiagnostic(error)}`);
        }
        let reviewedBodies: ReadonlySet<string> | null = null;
        if (input.root) {
          try {
            const read = await readRegistryRuntimeProjection([state]);
            if (read.kind === "PROMOTED") reviewedBodies = new Set(read.value.registry.bodies.map(body => body.id));
            else failures.set(state, `${state.toUpperCase()} reviewed body registry is ${read.kind}; unpaired governments remain UNKNOWN`);
          } catch (error) {
            failures.set(state, `${state.toUpperCase()} reviewed body registry unread: ${sanitizedErrorDiagnostic(error)}`);
          }
        }
        try {
          const read = await (input.readRegistration ?? ((s) => readRegistrationProjection(s, { bypassCache: true })))(state);
          if (read.kind !== "PROMOTED") {
            failures.set(state, `${state.toUpperCase()} registration is ${read.kind}; unpaired governments remain UNKNOWN`);
            continue;
          }
          for (const body of read.value.bodies) if (body.jurisdictionId !== null) add(body.jurisdictionId, body.id);
          if (input.root && reviewedBodies) {
            for (const pair of reviewedGovernmentPairs(loadRegistrationReference(input.root, state), read.value.vintage.referenceSha256, reviewedBodies)) add(pair.id, pair.bodyId);
          }
        } catch (error) {
          failures.set(state, `${state.toUpperCase()} registration unread: ${sanitizedErrorDiagnostic(error)}`);
        }
      }
    },
  };
}
