/**
 * **A SLOW CALL IS ASKED AGAIN, AND THE FIRST ANSWER WINS.** (2026-09-29, S3.)
 *
 * Measured on staging that day, the fast model's reading of a question took
 * 1.0-1.7 s in 21 of 25 calls and 5.1-5.8 s in four — stalls, not larger
 * questions: the same prompt asked again a moment later answered in 1.1 s. Sean's
 * bar is three seconds from the question, and one stalled reading spends it.
 *
 * So the request is sent, and if it has not answered by `hedgeAfterMs` the same
 * request is sent once more; the first response to arrive is the one used and the
 * other is stopped. A reading is small (about 3,500 input tokens, 60 output), so
 * the second call costs a fraction of a cent and only on the slow one in six. A
 * request that FAILS before the hedge time is retried at once, the same way.
 *
 * Nothing about the request changes between the two sends, so the answer the
 * winner returns is the answer either would have.
 */

/** The hedge delay in ms, from `WTP_ASK_HEDGE_MS`; `off` (or 0) means never. */
export function askHedgeMs(env: Readonly<Record<string, string | undefined>> = process.env): number | null {
  const raw = (env.WTP_ASK_HEDGE_MS ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0") return null;
  const parsed = Number(raw);
  return raw !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : 1_800;
}

export async function hedgedFetch(
  impl: typeof fetch,
  url: string,
  init: RequestInit,
  options: { hedgeAfterMs: number | null; timeoutMs: number },
): Promise<Response> {
  if (options.hedgeAfterMs === null) return impl(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
  const overall = AbortSignal.timeout(options.timeoutMs);
  const controllers: AbortController[] = [];
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let failed = 0;
    const timer = setTimeout(() => start(), options.hedgeAfterMs!);
    const start = () => {
      if (settled || controllers.length >= 2) return;
      const index = controllers.length;
      const controller = new AbortController();
      controllers.push(controller);
      impl(url, { ...init, signal: AbortSignal.any([controller.signal, overall]) }).then(
        (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // Only the loser is stopped: aborting the winner would cut its body off mid-read.
          controllers.forEach((other, at) => { if (at !== index) other.abort(); });
          resolve(response);
        },
        (error) => {
          failed += 1;
          if (settled) return;
          if (controllers.length < 2) start();
          else if (failed >= controllers.length) { settled = true; clearTimeout(timer); reject(error); }
        },
      );
    };
    start();
  });
}
