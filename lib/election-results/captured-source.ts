import { runtimeGithubCredential } from "../ops/runtime-release-handoff.ts";

/** Oversight's browser captures of the Ballotpedia race pages live on this branch, so a refresh commit reaches the next check without a release. */
export const CAPTURED_BALLOTPEDIA_URL =
  "https://api.github.com/repos/SeanJ22/meanwhile/contents/data/election-results/ballotpedia-2026-captured.json?ref=stream%2Frt-02-data";

/** One read per check; the raw media type returns files over 1 MB whole. Throws on any failure so the caller records it once. */
export async function fetchCapturedBallotpediaText(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const token = runtimeGithubCredential(env);
  const response = await fetchImpl(CAPTURED_BALLOTPEDIA_URL, {
    headers: { accept: "application/vnd.github.raw", "x-github-api-version": "2022-11-28", "user-agent": "we-the-people-permanent-runtime",
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Captured Ballotpedia file: GitHub HTTP ${response.status}`);
  return response.text();
}
