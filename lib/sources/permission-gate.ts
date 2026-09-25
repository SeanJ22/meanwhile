/**
 * **ROBOTS.TXT READ AND RECORDED BEFORE THE FIRST BYTE, INSIDE A MEETING
 * ADAPTER.** (2026-09-23, the Pima school-agenda routes session; made a record
 * rather than a refusal by the owner decision of 2026-09-25.)
 *
 * The gate was born to refuse: three Diligent Community tenants whose
 * `robots.txt` reads `User-agent: *` / `Disallow: /` had stayed on the routine
 * clock after `docs/sources.md` recorded them `DISALLOWED`, and from 2026-09-23
 * this gate threw on DISALLOWED and CANNOT_TELL so the partition walled.
 *
 * On 2026-09-25 Sean decided: "Robots.txt alone must not block acquisition. I
 * explicitly authorize automated reading of publicly accessible pages even
 * when robots.txt requests otherwise." So an adapter that opts in still asks
 * the host itself, every run, with the one evaluator the control plane uses
 * (`lib/control-plane/scheduler/robots.ts`, product token `we-the-people`,
 * falling to the `*` group), before it requests the page — and every verdict
 * is RECORDED and none refuses (`ROBOTS_BLOCKS_ACQUISITION` is false):
 *
 * ```
 *   ALLOWED | NO_ROBOTS   → recorded; the request proceeds
 *   DISALLOWED            → recorded with the matched rule; the request proceeds
 *   CANNOT_TELL           → recorded as unread; the request proceeds, and the
 *                           page's own answer decides
 * ```
 *
 * What still stops a read is an access control on the page itself — a 401, a
 * 403, a 429, a bot challenge — which the shared polite client reports as a
 * WALL (`SourceHttpError`) and which is never defeated with a credential, a
 * cookie or a solved challenge (`lib/hunt/access-control.ts`).
 *
 * The robots document is read ONCE per origin per gate (one fetch run), with
 * this project's own identified client, and — because the composite's
 * acquisition trace records every successful response — its exact bytes land
 * in the candidate's acquisition evidence beside the pages it was read over.
 * That is the robots reading travelling with the data, as evidence.
 */

import {
  evaluatePermission,
  type PermissionReading,
  type RobotsRead,
} from "../control-plane/scheduler/robots.ts";
import { politeGetText, sourceUserAgent } from "./http.ts";

export interface PermissionGateOptions {
  /** Overridden in tests; production uses the global fetch (and so the acquisition trace). */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface PermissionGate {
  /**
   * Read (once per origin) and record the robots.txt verdict for this URL, and resolve with it. Never throws for a
   * robots verdict: robots.txt is recorded, not blocking (owner decision 2026-09-25). The name is historical.
   */
  readonly assertPermitted: (url: string) => Promise<PermissionReading>;
  /** Every reading this gate made, in order — for a report, never for a decision. */
  readonly readings: () => readonly { readonly url: string; readonly reading: PermissionReading }[];
}

/**
 * One GET with its robots reading: the gate records the verdict for this exact
 * URL first, then the shared polite client requests it. The single way an
 * opted-in adapter reads a page, so the robots record cannot be skipped by one
 * call site and kept by another. An access control on the page is the polite
 * client's WALL, never something this function works around.
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
      /* Recorded, never a refusal: ROBOTS_BLOCKS_ACQUISITION is false (owner decision 2026-09-25). */
      made.push({ url, reading });
      return reading;
    },
    readings: () => [...made],
  };
}
