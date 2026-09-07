/**
 * **THE READ-ONLY WINDOW INTO THE PROVIDER'S OWN NUMBERS** (MAPQ-5, 2026-09-07).
 *
 * MapTiler's Service API answers "what did this account spend, by key and by
 * service?", and nothing else in this repository can answer it: the requests
 * are made by browsers to a third party and none of them crosses a host we own.
 *
 *   GET https://service.maptiler.com/v1/analytics/api_usage/timeline
 *       ?period=<period>&classifier=<api_keys|services>&group=<request|session>
 *   Authorization: Token <service token>
 *
 * ## Two classifiers, on purpose
 *
 * `api_keys` is what attribution needs — it is the whole point of MAPQ-3's key
 * matrix that a number can be traced to the environment that spent it.
 * `services` is fetched as well and kept, because a bill of 101,863 requests
 * that cannot say whether it was `Tiles` or `Rendered maps` is a bill nobody
 * can act on, and those two are billed differently. Collapsing them into one
 * unexplained bucket is exactly the failure the brief names.
 *
 * ## The credential
 *
 * A SERVICE token, held server-side, read from the environment by name and
 * never returned, logged, echoed into an error message, written into a
 * snapshot, or rendered. The public browser key cannot read an account and is
 * never sent here — and `lib/ops/provider-access.ts` additionally blocks a
 * browser from reaching `service.maptiler.com` at all, so a page can never be
 * the thing that holds one.
 *
 * ## GET only
 *
 * There is no write path in this module and there must never be one. This
 * reads a bill; it does not administer an account. Key creation, origin
 * restriction and plan choice are owner actions and are recorded as such in
 * `docs/maptiler-keys.md`.
 */

import { createHash } from "node:crypto";

import {
  MAPTILER_SERVICE_TOKEN_VAR,
  type MapTilerClassifier,
  type MapTilerFetchProvenance,
  type MapTilerGroup,
  type MapTilerPeriod,
} from "./types.ts";

export const MAPTILER_ANALYTICS_BASE = "https://service.maptiler.com/v1/analytics/api_usage";

/** The provider's timeline response, as much of it as we depend on. */
export interface MapTilerTimeline {
  readonly since?: string;
  readonly until?: string;
  readonly datasets?: readonly {
    readonly group_id?: string;
    readonly item_id?: string;
    readonly data?: readonly { readonly date?: string; readonly value?: number }[];
    readonly estimated_data?:
      | { readonly date?: string; readonly value?: number }
      | readonly { readonly date?: string; readonly value?: number }[];
  }[];
  readonly legend?: readonly {
    readonly item_id?: string;
    readonly label?: string;
    readonly description?: string | null;
  }[];
}

export interface TimelineFetch {
  readonly ok: boolean;
  readonly timeline: MapTilerTimeline | null;
  readonly provenance: MapTilerFetchProvenance;
}

/** The URL, as a URL, so nothing is string-concatenated near a credential. */
export function timelineUrl(input: {
  readonly period: MapTilerPeriod;
  readonly classifier: MapTilerClassifier;
  readonly group: MapTilerGroup;
}): string {
  const url = new URL(`${MAPTILER_ANALYTICS_BASE}/timeline`);
  url.searchParams.set("period", input.period);
  url.searchParams.set("classifier", input.classifier);
  url.searchParams.set("group", input.group);
  url.searchParams.set("format", "json");
  return url.toString();
}

/**
 * The token, or null.
 *
 * Null is a legitimate state and the caller must render it as NOT CONNECTED.
 * The variable is named in every message; the value is in none of them.
 */
export function serviceTokenFromEnv(
  env: { readonly [MAPTILER_SERVICE_TOKEN_VAR]?: string | undefined } = process.env as {
    [MAPTILER_SERVICE_TOKEN_VAR]?: string;
  },
): string | null {
  const token = env[MAPTILER_SERVICE_TOKEN_VAR]?.trim();
  return token ? token : null;
}

/**
 * Scrub anything that could carry a credential out of a message.
 *
 * A driver or a `fetch` implementation is entitled to put the request headers
 * in an error, and an error string is the one place a secret gets written to a
 * log without anybody deciding to write it there.
 */
export function scrubToken(text: string, token: string | null): string {
  if (!token) return text;
  return text.split(token).join("<redacted>");
}

export type Fetcher = (
  url: string,
  init: { readonly headers: Record<string, string> },
) => Promise<{ readonly status: number; text: () => Promise<string> }>;

/**
 * One timeline read, with its provenance.
 *
 * A non-200 is a FAILED read and says so — never an empty timeline. RULING 269:
 * an operation that can return nothing is asked what it returned, and a
 * zero-row extraction is a failed extraction, not a zero.
 */
export async function fetchTimeline(input: {
  readonly period: MapTilerPeriod;
  readonly classifier: MapTilerClassifier;
  readonly group: MapTilerGroup;
  readonly token: string;
  readonly nowIso: string;
  readonly fetcher?: Fetcher;
}): Promise<TimelineFetch> {
  const url = timelineUrl(input);
  const fetcher: Fetcher =
    input.fetcher ??
    (async (u, init) => {
      const response = await fetch(u, { headers: init.headers, method: "GET" });
      return { status: response.status, text: () => response.text() };
    });

  const base = {
    endpoint: url,
    classifier: input.classifier,
    group: input.group,
    requestedAt: input.nowIso,
  } as const;

  let status = 0;
  let body = "";
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Token ${input.token}`, accept: "application/json" },
    });
    status = response.status;
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      timeline: null,
      provenance: {
        ...base,
        status: 0,
        responseBytes: 0,
        responseSha256: "",
        datasets: 0,
        points: 0,
        error: scrubToken(
          `The request to MapTiler failed before an answer (${(error as Error)?.name ?? "error"}).`,
          input.token,
        ),
      },
    };
  }

  const responseBytes = Buffer.byteLength(body, "utf8");
  const responseSha256 = createHash("sha256").update(body, "utf8").digest("hex");

  if (status !== 200) {
    return {
      ok: false,
      timeline: null,
      provenance: {
        ...base,
        status,
        responseBytes,
        responseSha256,
        datasets: 0,
        points: 0,
        error: scrubToken(
          `MapTiler answered ${status} for classifier=${input.classifier} group=${input.group}. ` +
            (status === 401 || status === 403
              ? `The credential named by ${MAPTILER_SERVICE_TOKEN_VAR} was refused.`
              : "We could not ask, so we are not saying what the usage is."),
          input.token,
        ),
      },
    };
  }

  let timeline: MapTilerTimeline;
  try {
    timeline = JSON.parse(body) as MapTilerTimeline;
  } catch {
    return {
      ok: false,
      timeline: null,
      provenance: {
        ...base,
        status,
        responseBytes,
        responseSha256,
        datasets: 0,
        points: 0,
        error:
          "MapTiler answered 200 with something that is not JSON. A body we cannot parse is a " +
          "failed read, never an empty one.",
      },
    };
  }

  const datasets = timeline.datasets?.length ?? 0;
  const points = (timeline.datasets ?? []).reduce((n, d) => n + (d.data?.length ?? 0), 0);
  return {
    ok: true,
    timeline,
    provenance: { ...base, status, responseBytes, responseSha256, datasets, points, error: null },
  };
}
