/**
 * WHOSE TRAFFIC IS THIS? (C05, 2026-08-17)
 *
 * ## The problem
 *
 * Roughly 537 rows in production's `search_log` are ours, written by local
 * and CI Playwright runs. Every `pnpm walk:all` adds about 28 more. The
 * number only grows, and nothing sold may ever contain it.
 *
 * The obvious fix — stop writing to production — is REJECTED, and the
 * rejection is recorded here so nobody re-proposes it: it would delete the
 * only end-to-end proof that the write path works, and a silently broken
 * write path is how we would discover months from now that reactions had
 * stopped recording. The walks write to production ON PURPOSE.
 *
 * ## Why the marker travels over the wire
 *
 * The row is written by the route, which runs on Netlify. The runner's
 * environment is on a laptop or a CI box. So the runner DECLARES itself in a
 * request header and the route passes the declaration through. This is the
 * brief's "set from the runner's own environment rather than inferred later"
 * — the runner reads its own env and says so, at write time. Nothing is
 * pattern-matched, and no user-agent is consulted.
 *
 * ## Why an unauthenticated header is safe here, stated rather than assumed
 *
 * The header is self-declared and there is no shared secret. The only thing a
 * stranger can do with it is mark THEIR OWN rows synthetic, which REMOVES
 * those rows from every aggregate. They cannot mark anyone else's rows, and
 * they cannot mark their own rows organic — organic is already the default
 * for anyone who says nothing.
 *
 * So the sole abuse is self-exclusion, and self-exclusion moves every count
 * DOWN. That is the safe direction: an aggregate can be undercounted and
 * still be honest about it (the organic denominator is stated in words
 * wherever it is rendered or exported), whereas an overcount is a false claim
 * about a district. A funded adversary trying to shape what the other side
 * spends money on wants counts UP, and this header cannot do that.
 */

/** The header the runner declares itself in. */
export const SYNTHETIC_RUN_HEADER = "x-wtp-synthetic-run";

/**
 * THE SAME DECLARATION, IN THE BODY, BECAUSE THE HEADER DOES NOT SURVIVE
 * UNLOAD (item 4b, g17, 2026-08-18).
 *
 * `lib/log/client.ts` prefers `navigator.sendBeacon`, and a beacon flushed
 * during an UNLOAD — a reload or a navigation — does not carry Playwright's
 * `extraHTTPHeaders`. Measured four ways on 2026-08-18: alive → declared,
 * pagehide-during-reload → undeclared, pagehide-during-navigation →
 * undeclared, page close → declared. So the header is real and the transport
 * is real and they do not meet on the one path that mattered — which is how
 * seven rows (g14) and then forty-four (g15) landed in the sold store labelled
 * as readers.
 *
 * R50's fix was to make every guarded context DELETE `sendBeacon`, forcing the
 * fetch fallback. That works and it stays, but it is a workaround with a cost
 * R50 stated itself: a guarded run never exercises the beacon transport at
 * all, so nothing proves the beacon path. This is the fix R50 recorded as the
 * alternative — teach the marker to travel in the request BODY, which the
 * client already sends and which no transport strips.
 *
 * The trust model is unchanged and is argued above: the declaration is
 * self-made either way, and the only thing it can do is move a row OUT of what
 * is sold. A body field is no more forgeable than a header, and both fail in
 * the safe direction.
 */
export const SYNTHETIC_RUN_BODY_KEY = "syntheticRun";

export type RunClass = "ORGANIC" | "SYNTHETIC" | "UNKNOWN";

export interface RunMarker {
  runClass: RunClass;
  runId: string | null;
}

/** A reader, which is what anyone who declares nothing is. */
export const ORGANIC: RunMarker = { runClass: "ORGANIC", runId: null };

/**
 * A run id is an opaque label the runner chose. It is capped and character-
 * restricted so it cannot become a smuggling channel for anything a person
 * typed — the same discipline the `detail` bag is held to.
 */
const RUN_ID_SHAPE = /^[A-Za-z0-9._:@+-]{1,120}$/;

/**
 * Read the marker off an incoming request.
 *
 * Absent header → ORGANIC. Present but malformed → SYNTHETIC with a null id,
 * NOT organic: something declared itself automated and got the label wrong,
 * and resolving that ambiguity in favour of "reader" is exactly the mistake
 * this file exists to stop. The conservative reading is the one that keeps
 * the row out of what we sell.
 */
export function markerFromRequest(request: Request): RunMarker {
  return markerFrom(request.headers.get(SYNTHETIC_RUN_HEADER));
}

/**
 * The resolver both doors go through.
 *
 * Either declaration marks the row. Neither may be preferred on the grounds of
 * being "more trustworthy" — they are equally self-declared, and the whole
 * point is that a run which declared itself SOMEWHERE is not recorded as a
 * reader because the transport it happened to use dropped one of the two.
 *
 * A malformed declaration in either place is SYNTHETIC with a null id, never
 * ORGANIC: something said it was automated and got the label wrong, and
 * resolving that ambiguity in favour of "reader" is the mistake this file
 * exists to stop.
 */
export function markerFrom(
  headerValue: string | null | undefined,
  bodyValue?: unknown,
): RunMarker {
  const declared: unknown[] = [];
  if (headerValue !== null && headerValue !== undefined) declared.push(headerValue);
  if (bodyValue !== null && bodyValue !== undefined) declared.push(bodyValue);
  if (declared.length === 0) return ORGANIC;

  for (const value of declared) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (RUN_ID_SHAPE.test(trimmed)) return { runClass: "SYNTHETIC", runId: trimmed };
  }
  return { runClass: "SYNTHETIC", runId: null };
}

/**
 * The marker for a request whose body may carry the declaration.
 *
 * `/api/log` is the only route that needs this, because it is the only one
 * reached by `navigator.sendBeacon`. Every other route is a `fetch`, where the
 * header arrives.
 */
export function markerFromRequestWithBody(request: Request, body: unknown): RunMarker {
  const declared =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)[SYNTHETIC_RUN_BODY_KEY]
      : undefined;
  return markerFrom(request.headers.get(SYNTHETIC_RUN_HEADER), declared);
}

/**
 * The headers an automated run sends, built from ITS OWN environment.
 *
 * `WTP_RUN_ID` is the declaration. A runner that sets nothing sends nothing
 * and its rows are organic — which is the correct default for a human sitting
 * at a browser, and the reason every walk script must set it explicitly.
 */
export function syntheticRunHeaders(
  env: { WTP_RUN_ID?: string | undefined } = process.env as { WTP_RUN_ID?: string },
): Record<string, string> {
  const runId = env.WTP_RUN_ID?.trim();
  if (!runId) return {};
  return { [SYNTHETIC_RUN_HEADER]: runId };
}

/**
 * A run id for a script that did not inherit one.
 *
 * Shaped `<label>@<iso>` so a back-marking pass can attribute by time window
 * and a human can read what wrote a row without opening anything. The
 * timestamp is passed in rather than read here — a caller that wants the
 * clock reads the clock, and this stays pure enough to test.
 */
export function makeRunId(label: string, startedAtIso: string): string {
  const safe = label.replace(/[^A-Za-z0-9._+-]/g, "-").slice(0, 40);
  return `${safe}@${startedAtIso}`;
}
