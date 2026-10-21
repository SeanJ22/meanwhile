import type { VotingSitesAnswer } from "./voting-sites.ts";

/** The same POST supports JSON callers and a progressively delivered panel answer. */
export function votingSitesResponse(answer: Promise<VotingSitesAnswer>, streaming: boolean): Promise<Response> | Response {
  const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
  if (!streaming) return answer.then(value => Response.json(value, { headers }));
  const encoder = new TextEncoder();
  let cancelled = false;
  return new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('{"pending":true}\n'));
      try {
        const value = await answer;
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify({ answer: value })}\n`));
      } finally { if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; },
  }), { headers: { ...headers, "content-type": "application/x-ndjson", "x-accel-buffering": "no" } });
}
