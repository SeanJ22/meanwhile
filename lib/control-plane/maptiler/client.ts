import { createHash } from "node:crypto";

import {
  MAPTILER_SERVICE_TOKEN_VAR,
  type MapTilerClassifier,
  type MapTilerFetchProvenance,
  type MapTilerGroup,
  type MapTilerPeriod,
} from "./types.ts";

export const MAPTILER_ANALYTICS_BASE = "https://service.maptiler.com/v1/analytics/api_usage";
export const MAPTILER_ANALYTICS_TIMEOUT_MS = 30_000;

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

/** Null is legitimate and renders as NOT CONNECTED. Messages name the variable, never the value. */
export function serviceTokenFromEnv(
  env: { readonly [MAPTILER_SERVICE_TOKEN_VAR]?: string | undefined } = process.env as {
    [MAPTILER_SERVICE_TOKEN_VAR]?: string;
  },
): string | null {
  const token = env[MAPTILER_SERVICE_TOKEN_VAR]?.trim();
  return token ? token : null;
}

/** A fetch error may carry request headers, so credentials are scrubbed from every message. */
export function scrubToken(text: string, token: string | null): string {
  if (!token) return text;
  return text.split(token).join("<redacted>");
}

export type Fetcher = (
  url: string,
  init: { readonly headers: Record<string, string>; readonly signal?: AbortSignal },
) => Promise<{ readonly status: number; text: () => Promise<string> }>;

/** A non-200 is a failed read, never an empty timeline. */
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
      const response = await fetch(u, {
        headers: init.headers,
        method: "GET",
        signal: AbortSignal.timeout(MAPTILER_ANALYTICS_TIMEOUT_MS),
      });
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

  const datasetRows = Array.isArray(timeline.datasets) ? timeline.datasets : [];
  const datasets = datasetRows.length;
  const points = datasetRows.reduce((n, d) => n + (Array.isArray(d.data) ? d.data.length : 0), 0);
  if (datasets === 0 || points === 0) {
    return {
      ok: false,
      timeline: null,
      provenance: {
        ...base,
        status,
        responseBytes,
        responseSha256,
        datasets,
        points,
        error:
          "MapTiler answered 200 without a non-empty measured timeline. A zero-row extraction " +
          "is a failed extraction, never a reading of zero.",
      },
    };
  }
  return {
    ok: true,
    timeline,
    provenance: { ...base, status, responseBytes, responseSha256, datasets, points, error: null },
  };
}
