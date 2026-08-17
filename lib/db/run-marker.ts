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
  const raw = request.headers.get(SYNTHETIC_RUN_HEADER);
  if (raw === null) return ORGANIC;
  const trimmed = raw.trim();
  if (!RUN_ID_SHAPE.test(trimmed)) {
    return { runClass: "SYNTHETIC", runId: null };
  }
  return { runClass: "SYNTHETIC", runId: trimmed };
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
