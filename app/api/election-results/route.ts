import { getElectionResults, postElectionResults } from "../../../lib/election-results/feed-response.ts";

export const runtime = "nodejs";

export const GET = (request: Request) => getElectionResults(request);
export const POST = (request: Request) => postElectionResults(request);
