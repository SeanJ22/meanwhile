import type { SeatHolder } from "../officials/lookup.ts";
import type { RosterReaderGap } from "./body-rosters.ts";
import type { CoverageSummary, CoveredBody } from "./coverage.ts";

/** Client-safe view of a body roster already projected by the server Reader. */
export interface BodyRosterClientProjection {
  readonly members: readonly SeatHolder[];
  readonly gaps: readonly RosterReaderGap[];
}

const EMPTY: BodyRosterClientProjection = Object.freeze({ members: [], gaps: [] });

export function projectedBodyRoster(
  body: Pick<CoveredBody, "readerRoster"> | null | undefined,
): BodyRosterClientProjection {
  return body?.readerRoster ?? EMPTY;
}

/** Names needed by the unopened list, without claiming a complete roster. */
export function projectedRosterPreview(body: Pick<CoveredBody, "readerRoster" | "readerRosterPreview">): readonly SeatHolder[] {
  return body.readerRoster?.members ?? body.readerRosterPreview ?? [];
}

function governingBodyForDivision(body: CoveredBody, ocdId: string): boolean {
  return body.bodyId === `${ocdId}#governing` || body.bodyId === `${ocdId}#board`;
}

/** The local holders already carried on the coverage response for this division. */
export function projectedGoverningHoldersForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): SeatHolder[] {
  if (!coverage || !ocdId) return [];
  return coverage.bodies
    .filter((body) => governingBodyForDivision(body, ocdId))
    .flatMap((body) => [...projectedBodyRoster(body).members]);
}

/** Completeness gaps already carried on governing/board bodies for a division. */
export function projectedRosterGapsForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): RosterReaderGap[] {
  if (!coverage || !ocdId) return [];
  return coverage.bodies
    .filter((body) => governingBodyForDivision(body, ocdId))
    .flatMap((body) => [...projectedBodyRoster(body).gaps]);
}
