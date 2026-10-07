/**
 * A research fetch that reads robots.txt first, records it, and never defeats
 * an access control. Robots.txt is evidence, never a block: its verdict
 * travels with the fetch (`permissions`: verdict, matched rule, the document's
 * sha256, when it was read) and the public page is requested. Every request
 * goes through `researchFetch`, which:
 *
 * 1. refuses, with no request at all, a URL that is not public http(s) and a
 *    host recorded as walling this client by an access control;
 * 2. reads the host's robots.txt before anything else on that origin, follows
 *    its redirects as RFC 9309 asks (at most five, public hops only), evaluates
 *    it with the standing runner's evaluator for the `we-the-people` token,
 *    and records the verdict; one that could not be read is CANNOT_TELL,
 *    never "no robots file";
 * 3. follows a page's redirects one hop at a time, repeating step 2 for every
 *    new origin before requesting anything from it;
 * 4. spaces requests to one host (two seconds, or the host's own Crawl-delay
 *    when longer), identifies itself, sends no credential, cookie or session,
 *    and hands every request, robots.txt included, to the caller's log;
 * 5. names an access control on the answer (`accessControl`,
 *    `lib/hunt/access-control.ts`): reported, never pushed through; a 429
 *    backs the host off for `RATE_LIMIT_BACKOFF_MS`.
 *
 * There is no flag that skips a step.
 */

import { createHash } from "node:crypto";

import { accessControlIn, RATE_LIMIT_BACKOFF_MS, type AccessControl } from "./access-control.ts";
import { RECORDED_WALLS } from "./recorded-walls.ts";
import { DEFAULT_ROBOTS_TOKEN, evaluatePermission, type PermissionVerdict } from "../control-plane/scheduler/robots.ts";
import { DEFAULT_USER_AGENT } from "../control-plane/scheduler/user-agent.ts";
import { assertPublicUrl } from "./egress.ts";

/** Hosts whose use waits on a pending owner decision. Nothing is requested from them, robots.txt included. */
export const OWNER_DECISION_HOSTS: readonly { readonly host: RegExp; readonly why: string }[] = [];

const MAX_ROBOTS_REDIRECTS = 5;
const DEFAULT_MAX_HOPS = 4;
const DEFAULT_SPACING_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const ACCEPT_ROBOTS = "text/plain,*/*;q=0.5";
const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/json,text/calendar,application/rss+xml,*/*;q=0.8";

/** One HTTP request, never following a redirect: this module asks permission of every new origin first. */
export type ResearchGet = (input: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}) => Promise<{
  readonly status: number | null;
  readonly body: Uint8Array;
  readonly contentType: string;
  /** The redirect target of a 3xx; null otherwise. */
  readonly location: string | null;
  readonly transportError: string | null;
}>;

/**
 * One origin's robots.txt as it was read, kept so a host is asked once per session. The document is kept, not a
 * verdict: every URL is evaluated against it for its own path.
 */
export interface RobotsMemo {
  readonly robotsText: string | null;
  readonly status: number | null;
  readonly transportError: string | null;
  readonly contentType: string | null;
  /** sha256 of the bytes read; null on a transport failure. Absent on older memos. */
  readonly robotsSha256?: string | null;
  /** The redirects followed to reach it. */
  readonly via: readonly string[];
  readonly readAt: string;
}

/**
 * Where readings and request times live between calls. A CLI keeps it on disk
 * so separate invocations share it; a test keeps it in memory.
 */
export interface ResearchMemory {
  robots(origin: string): RobotsMemo | undefined;
  rememberRobots(origin: string, memo: RobotsMemo): void;
  lastRequestAt(host: string): number | undefined;
  noteRequest(host: string, at: number): void;
}

export interface ResearchLogEntry {
  readonly at: string;
  readonly purpose: "robots" | "page";
  readonly url: string;
  readonly status: number | null;
  readonly transportError: string | null;
  readonly bytes: number;
}

export interface ResearchRuntime {
  readonly get: ResearchGet;
  readonly memory: ResearchMemory;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log?: (entry: ResearchLogEntry) => void;
  readonly spacingMs?: number;
  readonly timeoutMs?: number;
  readonly maxHops?: number;
}

/** One origin's robots.txt reading as it travels with the fetch: recorded evidence, never a refusal. */
export interface RobotsPermissionRecord {
  readonly origin: string;
  readonly verdict: PermissionVerdict;
  readonly detail: string;
  /** The rule that decided the verdict, as written; null when none matched or nothing was read. */
  readonly matchedRule?: string | null;
  /** When the robots.txt this reading rests on was read. */
  readonly readAt?: string;
  /** sha256 of the robots.txt bytes as read; null when nothing was read. */
  readonly robotsSha256?: string | null;
}

export type ResearchFetchResult =
  | {
      readonly outcome: "FETCHED";
      readonly url: string;
      readonly finalUrl: string;
      readonly status: number | null;
      readonly transportError: string | null;
      readonly contentType: string;
      readonly body: Uint8Array;
      readonly sha256: string | null;
      /** The access control this answer put in front of the page, or null. A technical failure, never defeated. */
      readonly accessControl: AccessControl | null;
      readonly redirects: readonly { readonly from: string; readonly status: number; readonly to: string }[];
      readonly permissions: readonly RobotsPermissionRecord[];
    }
  | {
      readonly outcome: "REFUSED";
      readonly url: string;
      /** The URL the refusal is about: the start, or a redirect target. */
      readonly refusedUrl: string;
      readonly reason: string;
      readonly redirects: readonly { readonly from: string; readonly status: number; readonly to: string }[];
      readonly permissions: readonly RobotsPermissionRecord[];
    };

function refusalFor(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const wall = RECORDED_WALLS.find((w) => w.host === host);
  if (wall) return `a recorded wall: ${wall.why}`;
  const pending = OWNER_DECISION_HOSTS.find((h) => h.host.test(host));
  if (pending) return `waits on the owner: ${pending.why}`;
  return null;
}

/**
 * Fetch one URL for research, robots-first by construction. Never throws for a
 * site: a refusal or a failure is the result.
 */
export async function researchFetch(start: string, runtime: ResearchRuntime): Promise<ResearchFetchResult> {
  const spacingMs = runtime.spacingMs ?? DEFAULT_SPACING_MS;
  const timeoutMs = runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxHops = runtime.maxHops ?? DEFAULT_MAX_HOPS;
  const redirects: { from: string; status: number; to: string }[] = [];
  const permissions: RobotsPermissionRecord[] = [];
  const iso = (): string => new Date(runtime.now()).toISOString();

  async function send(url: URL, purpose: ResearchLogEntry["purpose"], accept: string, delayMs: number) {
    const host = url.host.toLowerCase();
    const last = runtime.memory.lastRequestAt(host);
    const wait = last === undefined ? 0 : last + Math.max(spacingMs, delayMs) - runtime.now();
    if (wait > 0) await runtime.sleep(wait);
    runtime.memory.noteRequest(host, runtime.now());
    const got = await runtime.get({ url: url.toString(), headers: { "user-agent": DEFAULT_USER_AGENT, accept }, timeoutMs });
    runtime.log?.({ at: iso(), purpose, url: url.toString(), status: got.status, transportError: got.transportError, bytes: got.body.byteLength });
    /* A rate limit is honoured, never pushed through: nothing else is asked of the host until the back-off passes. */
    if (got.status === 429) runtime.memory.noteRequest(host, runtime.now() + RATE_LIMIT_BACKOFF_MS);
    return got;
  }

  /** The origin's robots.txt, read before anything else is requested there, then evaluated for this URL's path and recorded. */
  async function permission(url: URL): Promise<RobotsPermissionRecord & { readonly crawlDelayMs: number | null }> {
    const origin = url.origin;
    let memo = runtime.memory.robots(origin);
    if (memo === undefined) {
      let at = new URL(`${origin}/robots.txt`);
      let got = await send(at, "robots", ACCEPT_ROBOTS, 0);
      const via: string[] = [];
      /* RFC 9309 §2.3.1.2: at least five redirects are followed. A hop to a private or refused host ends the chain unread. */
      while (got.status !== null && got.status >= 300 && got.status < 400 && got.location !== null && via.length < MAX_ROBOTS_REDIRECTS) {
        let next: URL;
        try {
          next = assertPublicUrl(new URL(got.location, at).toString());
        } catch {
          break;
        }
        if (refusalFor(next) !== null) break;
        via.push(next.toString());
        at = next;
        got = await send(at, "robots", ACCEPT_ROBOTS, 0);
      }
      memo = {
        robotsText: got.transportError === null ? new TextDecoder().decode(got.body) : null,
        robotsSha256: got.transportError === null ? createHash("sha256").update(got.body).digest("hex") : null,
        status: got.status,
        transportError: got.transportError,
        contentType: got.contentType,
        via,
        readAt: iso(),
      };
      runtime.memory.rememberRobots(origin, memo);
    }
    /* A chain that ended on a redirect was not read: the evaluator says CANNOT_TELL, never "no robots file". Either is recorded. */
    const reading = evaluatePermission(
      { robotsText: memo.robotsText, status: memo.status, transportError: memo.transportError, contentType: memo.contentType },
      url.toString(),
      DEFAULT_ROBOTS_TOKEN,
    );
    const detail = memo.via.length === 0 ? reading.detail : `${reading.detail} (followed ${memo.via.length} redirect(s): ${memo.via.join(" → ")})`;
    return {
      origin,
      verdict: reading.verdict,
      detail,
      matchedRule: reading.matchedRule,
      readAt: memo.readAt,
      robotsSha256: memo.robotsSha256 ?? null,
      crawlDelayMs: reading.crawlDelayMs,
    };
  }

  let current = start;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    let url: URL;
    try {
      url = assertPublicUrl(current);
    } catch (error) {
      return { outcome: "REFUSED", url: start, refusedUrl: current, reason: `not a public http(s) URL: ${error instanceof Error ? error.message : String(error)}`, redirects, permissions };
    }
    const refused = refusalFor(url);
    if (refused !== null) return { outcome: "REFUSED", url: start, refusedUrl: url.toString(), reason: `not requested: ${refused}`, redirects, permissions };
    /* Recorded, never a refusal: ROBOTS_BLOCKS_ACQUISITION is false. */
    const { crawlDelayMs, ...reading } = await permission(url);
    permissions.push(reading);
    const got = await send(url, "page", ACCEPT_PAGE, crawlDelayMs ?? 0);
    if (got.status !== null && got.status >= 300 && got.status < 400 && got.location !== null) {
      const to = new URL(got.location, url).toString();
      redirects.push({ from: url.toString(), status: got.status, to });
      current = to;
      continue;
    }
    return {
      outcome: "FETCHED",
      url: start,
      finalUrl: url.toString(),
      status: got.status,
      transportError: got.transportError,
      contentType: got.contentType,
      body: got.body,
      sha256: got.transportError === null ? createHash("sha256").update(got.body).digest("hex") : null,
      accessControl:
        got.transportError === null ? accessControlIn({ status: got.status, text: new TextDecoder().decode(got.body.subarray(0, 65_536)) }) : null,
      redirects,
      permissions,
    };
  }
  return { outcome: "REFUSED", url: start, refusedUrl: current, reason: `not requested: more than ${maxHops} redirects`, redirects, permissions };
}

/** The one HTTP request this module sends from Node: never follows a redirect, never throws for a site. */
export const nodeResearchGet: ResearchGet = async ({ url, headers, timeoutMs }) => {
  try {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return {
      status: response.status,
      body: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "",
      location: response.headers.get("location"),
      transportError: null,
    };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: `${error instanceof Error ? error.message : String(error)}${cause}` };
  }
};

/** Research memory held in process: for tests, and for one CLI run. */
export function memoryInProcess(): ResearchMemory & { readonly snapshot: () => { robots: Record<string, RobotsMemo>; requests: Record<string, number> } } {
  const robots = new Map<string, RobotsMemo>();
  const requests = new Map<string, number>();
  return {
    robots: (origin) => robots.get(origin),
    rememberRobots: (origin, memo) => void robots.set(origin, memo),
    lastRequestAt: (host) => requests.get(host),
    noteRequest: (host, at) => void requests.set(host, at),
    snapshot: () => ({ robots: Object.fromEntries(robots), requests: Object.fromEntries(requests) }),
  };
}
