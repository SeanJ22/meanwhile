/**
 * Registration on the reader edge. Pure. The reader reads each state's registration from its own edge
 * artifact (`ReaderManifest.registrations`), never from the database on an ordinary visit. From each
 * pointer's identity alone, the runner decides:
 *
 * ```
 *   carried   the manifest already serves exactly this version
 *   publish   a state the manifest does not serve, or serves at another version: read once, proven,
 *             and written
 * ```
 *
 * A state the published section does not name has no promoted registration.
 */
import type { AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import { REGISTRATION_TARGETS } from "./publication.ts";

/** Every registration scope, one per state, DC and territory: the pointers the runner reads identities for. */
export const REGISTRATION_SCOPES: readonly string[] = REGISTRATION_TARGETS.map((target) => target.scope);

const STATE_OF_SCOPE = new Map(REGISTRATION_TARGETS.map((target) => [target.scope, target.state.toLowerCase()]));

export interface RegistrationPointer {
  readonly scope: string;
  readonly versionId: string;
}

export interface RegistrationEdgePlan {
  /** Lower-case state → the version the manifest already serves. */
  readonly carried: Readonly<Record<string, string>>;
  /** Lower-case state → the promoted version to read and publish this pass. */
  readonly publish: Readonly<Record<string, string>>;
}

export function registrationEdgePlan(
  pointers: readonly RegistrationPointer[],
  served: Readonly<Record<string, AuthorityArtifactRef>> | undefined,
): RegistrationEdgePlan {
  const carried: Record<string, string> = {};
  const publish: Record<string, string> = {};
  for (const pointer of pointers) {
    const state = STATE_OF_SCOPE.get(pointer.scope);
    if (state === undefined) continue;
    if (served?.[state]?.version === pointer.versionId) carried[state] = pointer.versionId;
    else publish[state] = pointer.versionId;
  }
  return { carried, publish };
}
