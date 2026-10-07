/**
 * The free try: plain code, no model. A method that worked somewhere is tried
 * at another place's door by replaying the request its procedure names, with
 * that door's own address where the first place's was. It works there when
 * the request answers with a page on the method's platform; it fails there
 * when the page answers "gone" or is plainly not on that platform. A method
 * whose procedure is not a plain request is checked for its platform only and
 * left for a worker. robots.txt is read once per website and recorded, never
 * obeyed as a block. A small publisher gets at most its hourly allowance of
 * requests; a website that answers 429 or 5xx is left alone for the round.
 */

import { probeUrlFor, type ProbeFetch } from "../doors/probe.ts";
import { normalizeHost, type DoorRecord } from "../doors/registry.ts";
import { assertPublicUrl } from "../hunt/egress.ts";
import { detectTenancy } from "../hunt/platform-tenancy.ts";
import { evaluatePermission, type PermissionVerdict } from "../control-plane/scheduler/robots.ts";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import type { FieldManualEntry } from "../control-plane/field-manual.ts";

export type PlainTryOutcome = "WORKS" | "FAILS" | "UNDECIDED" | "WAITING";

export interface PlainTry {
  readonly outcome: PlainTryOutcome;
  /** What was requested, when anything was. */
  readonly url: string | null;
  /** One plain sentence: what the try saw. */
  readonly note: string;
  /** What the website's robots.txt says about the request, recorded and never obeyed as a block. */
  readonly robots: PermissionVerdict | null;
}

/** The address a door's reads start from. */
export function doorStartUrl(door: DoorRecord): string | null {
  const configured = probeUrlFor(door) ?? (typeof door.config.url === "string" && /^https?:\/\//i.test(door.config.url) ? door.config.url : null);
  if (configured !== null) return configured;
  const host = door.hosts[0];
  return host ? `https://${host}/` : null;
}

/**
 * The plain request a procedure names, at this door: `{door}` is the door's own address and `{host}` its website.
 * Null when the procedure is not a plain GET of a templated address, or leaves a part only a worker could fill.
 */
export function replayUrl(procedure: string, door: DoorRecord): string | null {
  const start = doorStartUrl(door);
  if (start === null) return null;
  const host = new URL(start).host;
  const named = /\bGET\s+(\S+)/i.exec(procedure)?.[1] ?? (procedure.includes("{door}") ? "{door}" : null);
  if (named === null || !/\{door\}|\{host\}/.test(named)) return null;
  const url = named.replace(/[.,;)]+$/, "").split("{door}").join(start.replace(/\/$/, "")).split("{host}").join(host);
  if (/[{}<>]/.test(url)) return null;
  try {
    return assertPublicUrl(url).toString();
  } catch {
    return null;
  }
}

const procedureOf = (method: FieldManualEntry): string => {
  const payload = method.payload as { procedure?: unknown } | null;
  return typeof payload?.procedure === "string" ? payload.procedure : method.summary;
};

const onPlatform = (html: string, url: string, platforms: readonly string[]): string | null => {
  // The address itself counts: a vendor-hosted page often links only to its own paths.
  const hits = detectTenancy(`${url}\n${html}`, url).filter((hit) => !/VENDOR BOILERPLATE/.test(hit.evidence));
  return hits.find((hit) => platforms.includes(hit.platform.toLowerCase()))?.platform ?? null;
};

const GONE = new Set([404, 410]);
const BACK_OFF = (status: number): boolean => status === 429 || status >= 500;
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

export interface PlainTrier {
  /** Try one method at one door. Never throws. */
  tryAt(method: FieldManualEntry, door: DoorRecord, confirmedBy: "door kind" | "platform detected"): Promise<PlainTry>;
  /** Requests made to each website this round. */
  readonly requests: ReadonlyMap<string, number>;
}

/** One round's trier: the request allowance, the robots readings and the websites backing off are kept for the round. */
export function plainTrier(input: { readonly fetch: ProbeFetch; readonly sizeFor?: WebsiteSizeForUrl }): PlainTrier {
  const requests = new Map<string, number>();
  const robots = new Map<string, Promise<{ text: string | null; status: number | null; transportError: string | null }>>();
  const resting = new Map<string, string>();

  const allowed = (url: string, needed: number): boolean => {
    const host = new URL(url).host.toLowerCase();
    const cap = websiteRequestLimit(input.sizeFor?.(url));
    return cap === null || (requests.get(host) ?? 0) + needed <= cap;
  };
  const get = async (url: string): Promise<{ status: number; body: string; retryAfter: string | null } | { error: string }> => {
    const host = new URL(url).host.toLowerCase();
    requests.set(host, (requests.get(host) ?? 0) + 1);
    try {
      const response = await input.fetch(url, {});
      const body = response.status >= 200 && response.status < 300 ? decode(await response.bytes()) : "";
      return { status: response.status, body, retryAfter: response.headers.get("retry-after") };
    } catch (error) {
      return { error: (error as Error)?.name ?? "error" };
    }
  };
  const robotsFor = async (url: string): Promise<PermissionVerdict> => {
    const origin = new URL(url).origin;
    if (!robots.has(origin)) {
      robots.set(origin, get(`${origin}/robots.txt`).then((got) => "error" in got
        ? { text: null, status: null, transportError: got.error }
        : { text: got.body, status: got.status, transportError: null }));
    }
    const read = await robots.get(origin)!;
    return evaluatePermission({ robotsText: read.text, status: read.status, transportError: read.transportError }, url).verdict;
  };

  const tryAt: PlainTrier["tryAt"] = async (method, door, confirmedBy) => {
    const platforms = method.platforms.map((p) => p.toLowerCase());
    const start = doorStartUrl(door);
    if (start === null) return { outcome: "UNDECIDED", url: null, note: "this place's door has no address to try", robots: null };
    const replay = replayUrl(procedureOf(method), door);
    const url = replay ?? start;
    const host = normalizeHost(url) ?? new URL(url).host;
    if (resting.has(host)) return { outcome: "WAITING", url, note: resting.get(host)!, robots: null };
    const origin = new URL(url).origin;
    if (!allowed(url, robots.has(origin) ? 1 : 2)) {
      return { outcome: "WAITING", url, note: "this small publisher's hourly allowance is used; the try waits for the next round", robots: null };
    }
    const permission = await robotsFor(url);
    const got = await get(url);
    if ("error" in got) {
      resting.set(host, `the website did not answer (${got.error}); tried again next round`);
      return { outcome: "WAITING", url, note: resting.get(host)!, robots: permission };
    }
    if (BACK_OFF(got.status)) {
      resting.set(host, `the website answered ${got.status}${got.retryAfter ? ` and asked to wait (${got.retryAfter})` : ""}; tried again next round`);
      return { outcome: "WAITING", url, note: resting.get(host)!, robots: permission };
    }
    if (replay !== null && GONE.has(got.status)) {
      return { outcome: "FAILS", url, note: `the method's request answered ${got.status} here`, robots: permission };
    }
    if (got.status < 200 || got.status >= 300 || got.body.trim() === "") {
      return { outcome: "UNDECIDED", url, note: `this place's door answered ${got.status}${got.body.trim() === "" && got.status < 300 ? " with nothing in it" : ""}`, robots: permission };
    }
    const seen = platforms.length === 0 ? null : onPlatform(got.body, url, platforms);
    const sameSite = confirmedBy === "door kind" || seen !== null;
    if (!sameSite) {
      return { outcome: "FAILS", url, note: `the page here shows no sign of ${platforms.join(" or ")}, so the method does not fit this website`, robots: permission };
    }
    const which = seen ?? platforms[0] ?? door.kind;
    if (replay === null) {
      return { outcome: "UNDECIDED", url, note: `this website is on ${which} like where it worked; the method is not a plain request, so it waits for a worker`, robots: permission };
    }
    return { outcome: "WORKS", url, note: `a plain request answered here on ${which} (${got.status}, ${got.body.length.toLocaleString("en-US")} characters)`, robots: permission };
  };

  return {
    requests,
    tryAt: (method, door, confirmedBy) => tryAt(method, door, confirmedBy).catch((error: unknown) =>
      ({ outcome: "UNDECIDED", url: null, note: `the try could not be made: ${error instanceof Error ? error.message : String(error)}`, robots: null })),
  };
}
