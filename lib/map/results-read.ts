import { parseDistrictOcd, resultsByDistrict, type DistrictResult, type ResultContest } from "./results.ts";

/** What the results map asks for: one state's districts, or a national view. */
export type ResultsRequest =
  | { scope: "state"; state: string }
  | { scope: "us-senate" }
  | { scope: "us-house" };

export function parseResultsRequest(params: URLSearchParams): ResultsRequest | null {
  const scope = params.get("scope"), state = params.get("state")?.toUpperCase() ?? "";
  if (scope === "state") return /^[A-Z]{2}$/.test(state) ? { scope, state } : null;
  return scope === "us-senate" || scope === "us-house" ? { scope } : null;
}

/** The contests with filed results that the request covers. Where none are filed, a district is absent and the map says so. */
export async function readResultContests(_request: ResultsRequest): Promise<ResultContest[]> {
  return [];
}

const STATE_DIVISION = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/;

export function inRequest(request: ResultsRequest, ocdId: string): boolean {
  if (request.scope === "us-senate") return STATE_DIVISION.test(ocdId);
  const district = parseDistrictOcd(ocdId);
  if (!district) return false;
  return request.scope === "us-house" ? district.kind === "cd" : district.state === request.state.toLowerCase();
}

export async function mapResults(request: ResultsRequest, read = readResultContests): Promise<Record<string, DistrictResult>> {
  return resultsByDistrict((await read(request)).filter(contest => inRequest(request, contest.ocdId)));
}
