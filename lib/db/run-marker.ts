/**
 * Whose traffic is this? An automated run declares itself in a request header
 * (or body field) and the route passes the declaration through to the row.
 * The declaration is unauthenticated on purpose: the only thing it can do is
 * mark the sender's own rows synthetic, which moves counts down, never up.
 */

/** The header the runner declares itself in. */
export const SYNTHETIC_RUN_HEADER = "x-wtp-synthetic-run";

/**
 * The same declaration in the request body, because a beacon sent during
 * unload does not carry custom headers. Equally self-declared, equally safe.
 */
export const SYNTHETIC_RUN_BODY_KEY = "syntheticRun";

export type RunClass = "ORGANIC" | "SYNTHETIC" | "UNKNOWN";

export interface RunMarker {
  runClass: RunClass;
  runId: string | null;
}

/** A reader, which is what anyone who declares nothing is. */
export const ORGANIC: RunMarker = { runClass: "ORGANIC", runId: null };

/** An opaque runner label, capped and character-restricted so it cannot carry typed text. */
const RUN_ID_SHAPE = /^[A-Za-z0-9._:@+-]{1,120}$/;

/**
 * Read the marker off an incoming request. Absent → ORGANIC. Present but
 * malformed → SYNTHETIC with a null id, never ORGANIC.
 */
export function markerFromRequest(request: Request): RunMarker {
  return markerFrom(request.headers.get(SYNTHETIC_RUN_HEADER));
}

/**
 * Resolves a header and/or body declaration. Either marks the row; neither is
 * preferred. Malformed in either place → SYNTHETIC with a null id.
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

/** The marker for a request whose body may carry the declaration (beacon-sent routes). */
export function markerFromRequestWithBody(request: Request, body: unknown): RunMarker {
  const declared =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)[SYNTHETIC_RUN_BODY_KEY]
      : undefined;
  return markerFrom(request.headers.get(SYNTHETIC_RUN_HEADER), declared);
}

/**
 * The headers an automated run sends, from its own `WTP_RUN_ID`. A runner that
 * sets nothing sends nothing and its rows are organic.
 */
export function syntheticRunHeaders(
  env: { WTP_RUN_ID?: string | undefined } = process.env as { WTP_RUN_ID?: string },
): Record<string, string> {
  const runId = env.WTP_RUN_ID?.trim();
  if (!runId) return {};
  return { [SYNTHETIC_RUN_HEADER]: runId };
}

/** A run id shaped `<label>@<iso>`; the timestamp is passed in. */
export function makeRunId(label: string, startedAtIso: string): string {
  const safe = label.replace(/[^A-Za-z0-9._+-]/g, "-").slice(0, 40);
  return `${safe}@${startedAtIso}`;
}
