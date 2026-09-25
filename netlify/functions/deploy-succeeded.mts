/**
 * **WARM A PRODUCTION DEPLOY THE MOMENT IT SUCCEEDS (C21, 2026-09-25).**
 *
 * Netlify invokes a function named `deploy-succeeded` when a deploy finishes
 * (its event-triggered functions, docs.netlify.com/build/functions/trigger-on-events,
 * read 2026-09-25: the file-name form is still supported; the body is
 * `{ payload: <the deploy> }`). It fires for every deploy context, so only a
 * production deploy with a commit is acted on (`deployToWarm`).
 *
 * The work is lib/ops/post-deploy-warm.ts: wait for `/api/build` to serve the
 * commit, make the keep-warm pinger's fourteen marked calls, fill the CDN with
 * the pilot ZIPs' map answers and read them back. Bounded to ~55 s by its own
 * deadlines, inside the 60 s synchronous limit; the result is one log line.
 *
 * Like every function it is reachable by URL. A forged event can make it do no
 * more than the pinger already does every five minutes, and only for the commit
 * production actually serves; each instance acts on a commit once.
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
  console.log(`post-deploy-warm: ${JSON.stringify(handled)}`);
  return new Response(null, { status: 204 });
}
