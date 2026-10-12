import type { PlaceOwedItem } from "./place-owed.ts";

/**
 * Coverage counted against what the place should have, or "total unknown"
 * where that cannot be known. Never turns an unknown total into a number.
 *   governments  expected from the place's Census and school-district divisions;
 *                statistical, inactive and fictitious geography is not a government
 *   bodies       no expected total: the found count and the sources checked
 *   seats        expected from held body compositions where present, else unknown
 *   people       seats plus the candidates on held contests
 * Pure.
 */
export interface CoverageFigure {
  readonly accounted: number;
  /** Null when no expected total can be known. */
  readonly expected: number | null;
}

export interface PlaceCoverage {
  readonly governments: CoverageFigure;
  readonly bodies: { readonly found: number; readonly total: null; readonly sourcesChecked: number };
  readonly seats: CoverageFigure;
  readonly people: CoverageFigure;
}

const GOVERNMENT_SEGMENT = /\/(?:state|county|place|cousub|school_district|special_district|territory):[^/]+$/;

/** A division is a government when its own last segment names one and Census has not marked it statistical. */
export function isGovernmentDivision(division: { readonly id: string; readonly funcstat?: string }): boolean {
  return GOVERNMENT_SEGMENT.test(division.id) && !["F", "N", "S", "I"].includes(division.funcstat ?? "");
}

export function placeCoverage(rows: readonly PlaceOwedItem[], divisions: readonly { readonly id: string; readonly funcstat?: string }[]): PlaceCoverage {
  const subjects = new Map(rows.map(row => [row.subject.id, row.subject]));
  // The owed list carries each division's held Census status even when the caller's own list does not.
  const governments = divisions.filter(division => isGovernmentDivision({ id: division.id, funcstat: division.funcstat ?? subjects.get(division.id)?.funcstat }));
  // A government is accounted for once any body of it has its identity captured.
  const heldBodies = rows.filter(row => row.subject.kind === "body" && !row.subject.id.includes("#inventory:") && row.checklistId === "GOV-01" && row.held.length > 0);
  const accountedDivisions = new Set(heldBodies.flatMap(row => row.subject.divisionIds));
  const bodies = [...subjects.values()].filter(subject => subject.kind === "body" && !subject.id.includes("#inventory:"));
  const sources = new Set(rows.filter(row => row.subject.kind === "body" && row.checklistId === "GOV-01")
    .flatMap(row => row.held.map(field => field.sourceUrl)));
  const seats = [...subjects.values()].filter(subject => subject.kind === "seat");
  // Seats expected come only from body compositions that are held (a legal composition, REF-06, or a seat count, OFF-10,
  // carrying the authorized seats). One count per body; no composition means no expected total.
  const compositions = rows.filter(row => row.checklistId === "REF-06" || row.checklistId === "OFF-10").flatMap(row => row.held
    .map(field => (field.value as { authorizedSeats?: unknown } | null | undefined)?.authorizedSeats)
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0).slice(0, 1));
  const expectedSeats = compositions.length ? compositions.reduce((a, b) => a + b, 0) : null;
  const seatOccupied = seats.filter(seat => rows.some(row => row.subject.id === seat.id && row.checklistId === "OFF-04" && row.held.length > 0)).length;
  const candidates = [...subjects.values()].filter(subject => subject.captureKind === "candidate");
  const candidatesHeld = candidates.filter(candidate => rows.some(row => row.subject.id === candidate.id && row.checklistId === "CAN-01" && row.held.length > 0)).length;
  return {
    governments: { accounted: governments.filter(division => accountedDivisions.has(division.id)).length, expected: governments.length },
    bodies: { found: bodies.length, total: null, sourcesChecked: sources.size },
    seats: { accounted: seatOccupied, expected: expectedSeats },
    people: { accounted: seatOccupied + candidatesHeld, expected: expectedSeats === null ? null : expectedSeats + candidates.length },
  };
}

/** "Governments: 12 of 15 accounted for · Bodies: 40 found, total unknown". */
export function coverageWords(coverage: PlaceCoverage): string[] {
  const figure = (name: string, f: CoverageFigure) => f.expected === null ? `${name}: ${f.accounted} accounted for, total unknown`
    : `${name}: ${f.accounted} of ${f.expected} accounted for`;
  return [figure("Governments", coverage.governments),
    `Bodies: ${coverage.bodies.found} found, total unknown${coverage.bodies.sourcesChecked ? ` · ${coverage.bodies.sourcesChecked} sources checked` : ""}`,
    figure("Seats", coverage.seats), figure("People", coverage.people)];
}
