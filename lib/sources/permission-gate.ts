import { fetchSource } from "./fetch-source.ts";


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
  /** Reads (once per origin) and records the robots.txt verdict for this URL. Never throws for a robots verdict. */
  readonly assertPermitted: (url: string) => Promise<PermissionReading>;
  /** Every reading this gate made, in order — for a report, never for a decision. */
  readonly readings: () => readonly { readonly url: string; readonly reading: PermissionReading }[];
}

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
  const impl = options.fetchImpl ?? fetchSource;
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
      return reading;
    },
    readings: () => [...made],
  };
}
