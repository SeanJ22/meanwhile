import { runtimeGithubCredential } from "../ops/runtime-release-handoff.ts";
import { defaultAsyncRunCommand, type AsyncRunCommand } from "../ops/runtime-release-stage.ts";

/** Oversight's browser captures of the Ballotpedia race pages live on this branch, so a refresh commit reaches the next check without a release. */
export const CAPTURED_BALLOTPEDIA_URL =
  "https://api.github.com/repos/SeanJ22/meanwhile/contents/data/election-results/ballotpedia-2026-captured.json?ref=stream%2Frt-02-data";
const BRANCH = "stream/rt-02-data", FILE = "data/election-results/ballotpedia-2026-captured.json", GIT_TIMEOUT_MS = 2 * 60_000;

/**
 * One read per check. First the GitHub contents API (raw media type, so the multi-MB file comes whole); if that answers anything but 200,
 * the checkout's own `git fetch origin` credentials read the same branch. Throws only when both fail, naming each reason.
 */
export async function fetchCapturedBallotpediaText(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env,
  run: AsyncRunCommand = defaultAsyncRunCommand, cwd: string = process.cwd()): Promise<string> {
  let apiReason: string;
  try {
    const token = runtimeGithubCredential(env);
    const response = await fetchImpl(CAPTURED_BALLOTPEDIA_URL, {
      headers: { accept: "application/vnd.github.raw", "x-github-api-version": "2022-11-28", "user-agent": "we-the-people-permanent-runtime",
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) { console.log("Captured Ballotpedia file read through the GitHub contents API."); return await response.text(); }
    apiReason = `GitHub HTTP ${response.status}`;
  } catch (error) { apiReason = String(error); }
  const fetched = await run("git", ["fetch", "--quiet", "--no-tags", "origin", BRANCH], { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (fetched.status !== 0) throw new Error(`Captured Ballotpedia file unavailable: ${apiReason}; git fetch failed: ${fetched.stderr.trim().slice(0, 200) || `exit ${fetched.status}`}`);
  const shown = await run("git", ["show", `FETCH_HEAD:${FILE}`], { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (shown.status !== 0) throw new Error(`Captured Ballotpedia file unavailable: ${apiReason}; git show failed: ${shown.stderr.trim().slice(0, 200) || `exit ${shown.status}`}`);
  console.log(`Captured Ballotpedia file read through git fetch of origin ${BRANCH} (${apiReason} from the contents API).`);
  return shown.stdout;
}
