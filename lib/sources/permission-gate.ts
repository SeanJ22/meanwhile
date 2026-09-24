/**
 * **PERMISSION BEFORE THE FIRST BYTE, INSIDE A MEETING ADAPTER.**
 * (2026-09-23, the Pima school-agenda routes session. RULING 263, RULING 250.)
 *
 * RULING 263 says permission is asked before the first byte by the fetcher,
 * which refuses any host recorded `DISALLOWED` or `CANNOT_TELL`. The meeting
 * adapters predate that clause and read whatever their wiring row names — which
 * is how three Diligent Community tenants whose `robots.txt` reads
 * `User-agent: *` / `Disallow: /` stayed on the routine clock for weeks after
 * `docs/sources.md` recorded them `DISALLOWED — NOT WALKED`. A register row is
 * a claim about somebody else's file; it is not checked by anything that runs.
 *
 * So an adapter that opts in asks the host itself, every run, with the one
 * evaluator the control plane already uses
 * (`lib/control-plane/scheduler/robots.ts`, product token `we-the-people`,
 * falling to the `*` group), before it requests the page:
 *
 * ```
 *   ALLOWED | NO_ROBOTS   → the request proceeds
 *   DISALLOWED            → refused, named, never retried on a clock
 *   CANNOT_TELL           → refused (fail safe) — a wall in front of the
 *                           permission document is not a grant
 * ```
 *
 * A refusal is thrown as a `SourceHttpError` so the composite reports the
 * route as a WALL with its reason, the partition keeps its last-known-good
 * version, and nothing is fetched from the refused path. It is never an empty
 * calendar.
 *
 * The robots document is read ONCE per origin per gate (one fetch run), with
 * this project's own identified client, and — because the composite's
 * acquisition trace records every successful response — its exact bytes land
 * in the candidate's acquisition evidence beside the pages it licensed. That is
 * the permission reading travelling with the data it governed.
 */

import {
  evaluatePermission,
  type PermissionReading,
  type RobotsRead,
} from "../control-plane/scheduler/robots.ts";
import { SourceHttpError, politeGetText, sourceUserAgent } from "./http.ts";

export interface PermissionGateOptions {
  /** Overridden in tests; production uses the global fetch (and so the acquisition trace). */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface PermissionGate {
  /** Resolve with the reading when the URL may be requested; throw when it may not. */
  readonly assertPermitted: (url: string) => Promise<PermissionReading>;
  /** Every reading this gate made, in order — for a report, never for a decision. */
  readonly readings: () => readonly { readonly url: string; readonly reading: PermissionReading }[];
}

/**
 * One permitted GET: the gate's verdict for this exact URL first, then the
 * shared polite client. The single way an opted-in adapter reads a page, so
 * the permission check cannot be skipped by one call site and kept by another.
 */
export async function permittedText(
  gate: PermissionGate,
  url: string,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly accept?: string } = {},
): Promise<string> {
  await gate.assertPermitted(url);
  const { text } = await politeGetText(url, {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    accept: options.accept ?? "text/html",
  });
  return text;
}

/** The robots.txt URL that governs `url`. */
export function robotsUrlFor(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/robots.txt`;
}

export function makePermissionGate(options: PermissionGateOptions = {}): PermissionGate {
  const impl = options.fetchImpl ?? fetch;
  const byOrigin = new Map<string, Promise<RobotsRead>>();
  const made: { url: string; reading: PermissionReading }[] = [];

  async function readRobots(url: string): Promise<RobotsRead> {
    const robotsUrl = robotsUrlFor(url);
    try {
      const response = await impl(robotsUrl, {
        headers: { "User-Agent": sourceUserAgent(), Accept: "text/plain,*/*" },
        redirect: "follow",
        signal: options.signal,
      });
      const text = await response.text();
      return {
        robotsText: text,
        status: response.status,
        transportError: null,
        contentType: response.headers.get("content-type"),
      };
    } catch (error) {
      options.signal?.throwIfAborted();
      return {
        robotsText: null,
        status: null,
        transportError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    async assertPermitted(url: string): Promise<PermissionReading> {
      const origin = new URL(url).origin;
      let pending = byOrigin.get(origin);
      if (!pending) {
        pending = readRobots(url);
        byOrigin.set(origin, pending);
      }
      const reading = evaluatePermission(await pending, url);
      made.push({ url, reading });
      if (reading.verdict === "ALLOWED" || reading.verdict === "NO_ROBOTS") return reading;
      throw new SourceHttpError(
        `PERMISSION ${reading.verdict} for ${url} — ${reading.detail}` +
          (reading.matchedRule ? ` (rule: ${reading.matchedRule})` : "") +
          ". Nothing was requested from this path; a refusal is a fact about the route, never about the record.",
        0,
        url,
        2,
      );
    },
    readings: () => [...made],
  };
}
