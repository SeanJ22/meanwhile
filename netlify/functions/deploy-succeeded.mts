/**
 * Warms a production deploy the moment it succeeds. Netlify invokes a function
 * named `deploy-succeeded` for every deploy context with `{ payload: <the
 * deploy> }`; only a production deploy with a commit is acted on
 * (`deployToWarm`).
 *
 * The work is lib/ops/post-deploy-warm.ts: wait for `/api/build` to serve the
 * commit, make the keep-warm pinger's marked calls, fill the CDN with the map
 * answer for one ZIP per published county and read them back — bounded to
 * ~55 s, inside the 60 s synchronous limit.
 *
 * A forged event can do no more than the pinger already does, only for the
 * commit production serves, and each instance acts on a commit once.
 */
import { deployToWarm, warmAfterDeploy, type PostDeployWarmResult } from "../../lib/ops/post-deploy-warm.ts";
import { pingWarm } from "./keep-warm.mts";

const warmedCommits = new Set<string>();

export async function handleDeploySucceeded(
  request: Request,
  warm: (deploy: { commit: string; deployId: string }) => Promise<PostDeployWarmResult> = (deploy) =>
    warmAfterDeploy(deploy, { warmCalls: pingWarm }),
): Promise<{ readonly acted: boolean; readonly result?: PostDeployWarmResult; readonly reason?: string }> {
  const body: unknown = await request.json().catch(() => null);
  const deploy = deployToWarm(body);
  if (!deploy) return { acted: false, reason: "not a production deploy with a commit" };
  if (warmedCommits.has(deploy.commit)) return { acted: false, reason: `already warmed ${deploy.commit}` };
  warmedCommits.add(deploy.commit);
  return { acted: true, result: await warm(deploy) };
}

export default async function deploySucceeded(request: Request): Promise<Response> {
  const handled = await handleDeploySucceeded(request);
  const result = handled.result;
  // One line, not one entry per county: how many places were asked for, filled and read back from the CDN.
  const summary = result?.outcome === "WARMED"
    ? { ...result, fills: undefined, rereads: undefined, filled: result.fills.filter((r) => r.status === 200).length,
        skipped: result.fills.filter((r) => r.status === "SKIPPED").length, cdnHits: result.rereads.filter((r) => r.cacheStatus?.includes("hit")).length }
    : result;
  console.log(`post-deploy-warm: ${JSON.stringify({ ...handled, result: summary })}`);
  return new Response(null, { status: 204 });
}
