/**
 * **A STATE'S REGISTRATION, AS THE READER COMPOSES IT.** (2026-09-23.)
 *
 * Pure. The reader holds the reviewed registry (`lib/registry/`) and, for the
 * state a request is about, that state's promoted registration
 * (`lib/registration/reader.ts`). This is the one place they meet:
 *
 * ```
 *   reviewed wins       a division or body id the reviewed registry holds now
 *                       is never composed from registration, even when the
 *                       registration was derived against an older reviewed
 *                       version
 *   one government,     a registered body is left out when the reviewed
 *   one body            registry already keys a body on its division, or
 *                       lists the same Census government
 *   nothing invented    a state with no promoted registration composes to
 *                       nothing; the reader drops an id it cannot place,
 *                       exactly as before
 * ```
 *
 * The records already carry the registry's own shapes (`candidate.ts`), so
 * nothing is translated here.
 */
import type { Body, Division } from "../registry/types.ts";
import type { RegistrationReadModel } from "./candidate.ts";

export interface RegistrationLayer {
  /** Postal code, upper case. */
  readonly state: string;
  /** The registration version this layer was composed from. */
  readonly versionId: string;
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
}

export function composeRegistration(
  reviewed: { readonly divisions: readonly Pick<Division, "ocdId">[]; readonly bodies: readonly Pick<Body, "id" | "ocdId" | "alsoServesOcdIds" | "censusId">[] },
  model: RegistrationReadModel,
  versionId: string,
): RegistrationLayer {
  const divisionIds = new Set(reviewed.divisions.map((d) => d.ocdId));
  const bodyIds = new Set(reviewed.bodies.map((b) => b.id));
  const keyedDivisions = new Set<string>();
  const censusIds = new Set<string>();
  for (const body of reviewed.bodies) {
    if (body.ocdId) keyedDivisions.add(body.ocdId);
    for (const other of body.alsoServesOcdIds ?? []) keyedDivisions.add(other);
    if (body.censusId) censusIds.add(body.censusId);
  }
  return {
    state: model.state.toUpperCase(),
    versionId,
    divisions: model.divisions.filter((d) => !divisionIds.has(d.ocdId)),
    bodies: model.bodies.filter(
      (b) => !bodyIds.has(b.id) && !keyedDivisions.has(b.ocdId) && !(b.alsoServesOcdIds ?? []).some(id => keyedDivisions.has(id)) && !(b.censusId !== undefined && censusIds.has(b.censusId)),
    ),
  };
}
