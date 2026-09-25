/**
 * **THE KEEP-WARM PINGER (C21, 2026-09-24).** Every five minutes, ten
 * overlapping marked calls to `/api/warm`, each holding its instance for
 * 900 ms, so about ten server instances stay booted and a reader's request
 * skips the 2.7-3.7 s boot. See app/api/warm/route.ts for why the calls must
 * overlap.
 *
 * Cost, stated for the owner's decision: 10 calls x 12 an hour is 86,400
 * requests a month plus this function's own 8,640 runs, and about 24 GB-hours
 * of compute at 1 GB for the holds. At Netlify Pro's published rates (10
 * credits per GB-hour, 2 per 10k requests) that is roughly 260 of the plan's
 * 3,000 monthly credits.
 *
 * Scheduled functions run only on the published production deploy, never on a
 * preview or branch deploy.
 */
import { PUBLIC_SITE_ORIGIN } from "../../lib/ops/origins.ts";

export const WARM_INSTANCES = 10;
export const HOLD_MS = 900;
const MARKER = "keep-warm";

export async function pingWarm(fetchImpl: typeof fetch = fetch): Promise<{ answered: number; ms: number }> {
  const started = Date.now();
  const calls = Array.from({ length: WARM_INSTANCES }, () =>
    fetchImpl(`${PUBLIC_SITE_ORIGIN}/api/warm?hold=${HOLD_MS}`, {
      headers: { "x-wtp-synthetic-run": MARKER },
    }).then((response) => response.status === 200),
  );
  const settled = await Promise.allSettled(calls);
  const answered = settled.filter((result) => result.status === "fulfilled" && result.value).length;
  return { answered, ms: Date.now() - started };
}

export default async (): Promise<Response> => {
  const { answered, ms } = await pingWarm();
  console.log(`keep-warm: ${answered} of ${WARM_INSTANCES} instances answered in ${ms} ms`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/5 * * * *" };
