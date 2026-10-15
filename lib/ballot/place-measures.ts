import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { genericBallotProblems } from "./generic-projection.ts";
import type { BallotSet } from "./types.ts";

export const PLACE_MEASURE_SCOPE = "US:ballot-measures";
export interface PlaceMeasureProjection {
  readonly kind: "ballot-measures";
  readonly ocdId: string;
  readonly ballots: Readonly<Record<string, BallotSet>>;
}

export function placeMeasureScope(ocdId: string): string {
  if (!jurisdictionFromOcdId(ocdId) || !/^ocd-division\/country:us\/(?:state|district|territory):[^/]+\/.+/.test(ocdId)) {
    throw new Error("Local measures require one county, city or district.");
  }
  return `${PLACE_MEASURE_SCOPE}:${ocdId}`;
}

export function isPlaceMeasureScope(scope: string): boolean {
  if (!scope.startsWith(`${PLACE_MEASURE_SCOPE}:`)) return false;
  try { return placeMeasureScope(scope.slice(PLACE_MEASURE_SCOPE.length + 1)) === scope; }
  catch { return false; }
}

export function placeDivisionForMeasureTarget(id: string): string | null {
  const encoded = /^ballot-measure:(ocd-division%2F[^:]+):/.exec(id)?.[1];
  if (!encoded) return null;
  try { const division = decodeURIComponent(encoded); placeMeasureScope(division); return division; }
  catch { return null; }
}

export function placeMeasureProblems(value: PlaceMeasureProjection): string[] {
  if (!value || value.kind !== "ballot-measures" || !isPlaceMeasureScope(`${PLACE_MEASURE_SCOPE}:${value.ocdId}`)) return ["Local measures lack their exact place."];
  const problems = genericBallotProblems({ kind: "ballot-contests", ballots: value.ballots }, jurisdictionFromOcdId(value.ocdId)?.usps, value.ocdId);
  if (Object.values(value.ballots ?? {}).some(ballot => ballot.contests.some(contest => contest.ocdId !== value.ocdId || contest.type !== "MEASURE") || ballot.candidacies.length || ballot.absences.length)) {
    problems.push("Local measure records contain another place or record type.");
  }
  return problems;
}

export async function readPlaceMeasureProjection(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const scope = placeMeasureScope(ocdId);
  const edgeContext = options.store === undefined && options.edge === undefined ? currentReaderAuthorityEdge() : null;
  const edge = edgeContext ? await edgeContext.localMeasures?.load(ocdId) : null;
  if (edgeContext && !edge) throw new Error("The local measure reader has no published place artifact.");
  const result = await readPromotedCivicData<PlaceMeasureProjection>("BALLOT_CANDIDACY", scope, { ...options, ...(edge ? { edge } : {}) });
  if (result.kind === "PROMOTED" && (result.value.ocdId !== ocdId || placeMeasureProblems(result.value).length)) throw new Error("Published measures do not match their exact place or source.");
  return result;
}
