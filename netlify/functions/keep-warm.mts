/**
 * The keep-warm pinger. Every five minutes, fourteen overlapping marked calls
 * to `/api/warm`, each holding its instance for 900 ms, so at least ten server
 * instances stay booted and ten concurrent reader requests skip the cold boot.
 * See app/api/warm/route.ts for why the calls must overlap and what each loads.
 * The platform places overlapping calls on fewer instances than calls, so
 * fourteen calls are needed for ten instances.
 *
 * Scheduled functions run only on the published production deploy.
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
