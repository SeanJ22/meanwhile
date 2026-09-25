/**
 * **THE KEEP-WARM PINGER (C21, 2026-09-24; sized 2026-09-25).** Every five
 * minutes, fourteen overlapping marked calls to `/api/warm`, each holding its
 * instance for 900 ms, so at least ten server instances stay booted and ten
 * concurrent reader requests skip the 2.7-3.7 s boot. See app/api/warm/route.ts
 * for why the calls must overlap.
 *
 * Measured on production (2026-09-24 11:54 PM to 2026-09-25 12:47 AM MST): the
 * platform places overlapping calls on fewer instances than calls. Ten calls
 * reached 8-9 booted instances; fourteen reached 10-11; sixteen reached 12-13.
 * With ten, one of ten concurrent /api/meetings requests started cold at
 * 4,685 ms (12:44 AM MST, b0953c50).
 *
 * Cost, an estimate at Netlify Pro's published rates (10 credits per
 * GB-hour, 2 per 10k requests): 14 calls x 12 an hour is 120,960 requests a
 * month plus this function's own 8,640 runs, and about 34 GB-hours of compute
 * at 1 GB for the holds. That is roughly 360 of the plan's 3,000 monthly
 * credits (ten calls were about 260).
 *
 * Scheduled functions run only on the published production deploy, never on a
 * preview or branch deploy.
 */
import { PUBLIC_SITE_ORIGIN } from "../../lib/ops/origins.ts";

export const WARM_INSTANCES = 14;
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
