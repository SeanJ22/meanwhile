import type { LoadedReference } from "../../registration/reference.ts";

/**
 * Resolve a Census government's body when registration omitted it because the
 * reviewed registry already owns that exact body id. The Census reference
 * supplies the government-to-division pairing; a division name alone never
 * supplies a body. Ambiguous primary/alternate matches stay unpaired.
 */
export function reviewedBodyForGovernment(
  loaded: LoadedReference,
  jurisdictionId: string,
  reviewedBodies: readonly { readonly id: string; readonly ocdId: string | null; readonly bodyClass: string; readonly censusId?: string }[],
): { readonly bodyId: string; readonly ocdId: string; readonly publishingOrg: string } | null {
  const government = loaded.reference.governments.find((row) => row[1] === jurisdictionId);
  if (government === undefined || government[3] === "STATE") return null;
  const matches = reviewedBodies.filter((body) =>
    body.bodyClass === "GOVERNING" && body.ocdId !== null && body.censusId === government[0]);
  if (matches.length !== 1) return null;
  const body = matches[0];
  const division = loaded.reference.divisions.find((row) => row[0] === body.ocdId);
  if (body.ocdId === null) return null;
  return { bodyId: body.id, ocdId: body.ocdId, publishingOrg: division?.[3] ?? government[2] };
}
