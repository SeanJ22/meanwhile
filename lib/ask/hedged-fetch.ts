/**
 * A slow call is sent once more after `hedgeAfterMs`; the first response to
 * arrive is used and the other is stopped. The request is identical, so either
 * answer is the same answer. A failure returns its failure and is not retried.
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
          if (failed >= controllers.length) { settled = true; clearTimeout(timer); reject(error); }
        },
      );
    };
    start();
  });
}
