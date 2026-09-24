import { isSourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";

/**
 * **WHOSE STOPWATCH RAN OUT — decided from the thrown value, not assumed.**
 * (2026-09-24, the Pima/Mesa venue freeze.)
 *
 * The composite used to label EVERY rejected child fetch a `WALL`. From
 * 2026-09-14 to 2026-09-24 the Pima County Board's two Legistar partitions and
 * Mesa's InSite partition threw our own `VENUE_RESOLUTIONS_MISSING` before a
 * single publisher request was made, ~240 times a day each, and every one was
 * recorded as the publisher walling us. Nothing alarmed, because a wall is
 * friction the ladder expects, while a broken job is ours to fix.
 *
 * RULING 250: *"Anything that is our code is a JOB failure … Check whose
 * stopwatch ran out before naming a wall."* RULING 283: *"An unclassified
 * failure escalates — the direction an unknown must point when the harm is
 * silence."* So a rejection is a `WALL` only on evidence that the publisher's
 * side stopped it — the source-acquisition brand, the shared HTTP client's
 * error (it carries the status and the ladder rung), a deadline or abort, or a
 * transport signature in the message. Everything else, including an unknown,
 * is a `JOB`. Either way the affected partition keeps its last-known-good
 * pointer; the kind decides diagnosis and alarm, never what readers see.
 */
export type FetchFailureKind = "WALL" | "JOB";

const WALL_ERROR_NAMES = new Set([
  "SourceHttpError",
  "SourceAcquisitionFailure",
  "SourceAcquisitionDeadlineError",
  "LegistarError",
  "ApptegyPaginationError",
  "AbortError",
  "TimeoutError",
]);

/** Messages only a publisher, a network or a transport layer produces. */
const TRANSPORT_SIGNATURES: readonly RegExp[] = [
  /\bfetch failed\b/i,
  /\bHTTP\s*\d{3}\b/,
  /\btimed?\s*out\b|\btimeout\b|\bdeadline\b/i,
  /\bE(?:CONNRESET|CONNREFUSED|CONNABORTED|NOTFOUND|AI_AGAIN|TIMEDOUT|PIPE|HOSTUNREACH|NETUNREACH|PROTO)\b/,
  /\bUND_ERR_[A-Z_]+\b/,
  /\b(?:socket|TLS|SSL|certificate)\b/i,
  /\babort(?:ed)?\b/i,
  /\b(?:challenge page|captcha|access denied|forbidden|too many requests|rate.?limit)\b/i,
  /\brobots\.txt\b|\bdisallow/i,
  /\bpublisher\b/i,
  /\bnetwork\b/i,
  // A publisher answering HTML where JSON was promised is the publisher's
  // response, not our program: an interstitial or a format change.
  /\bJSON\b|Unexpected token|Unexpected end of/i,
];

export function fetchFailureKind(reason: unknown): FetchFailureKind {
  if (isSourceAcquisitionFailure(reason)) return "WALL";
  if (reason && typeof reason === "object") {
    const shaped = reason as { name?: unknown; rung?: unknown; status?: unknown; message?: unknown };
    if (typeof shaped.name === "string" && WALL_ERROR_NAMES.has(shaped.name)) return "WALL";
    // The shared HTTP client's errors carry the ladder rung or an HTTP status.
    if (typeof shaped.rung === "number") return "WALL";
    if (typeof shaped.status === "number" && shaped.status >= 400) return "WALL";
  }
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  // Our own coded failures (`VENUE_RESOLUTIONS_MISSING:…`, `…_WIRING_INVALID:…`)
  // are decided before any transport signature can match inside their detail.
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?::|$)/.test(message)) return "JOB";
  if (TRANSPORT_SIGNATURES.some((pattern) => pattern.test(message))) return "WALL";
  return "JOB";
}

/** The failure detail a JOB carries, so no surface can read it as a publisher's refusal. */
export function jobFailureDetail(error: string): string {
  return error.startsWith("JOB_FAILURE:")
    ? error
    : `JOB_FAILURE: our own code or configuration failed before the publisher could answer; this is not a publisher wall. ${error}`;
}
