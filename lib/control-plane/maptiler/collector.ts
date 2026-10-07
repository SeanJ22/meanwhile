/** Both classifiers must produce one complete billing window; a partial answer is a failed attempt and the publisher keeps the last good reading. */

import {
  fetchTimeline,
  scrubToken,
  serviceTokenFromEnv,
  type Fetcher,
} from "./client.ts";
import {
  MAPTILER_ALLOWANCE_VAR,
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerActorCounts,
  type MapTilerClassifier,
  type MapTilerFetchProvenance,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "./types.ts";
import { allowanceFrom, normalizeTimeline } from "./usage.ts";
import { RUN_CLASS_CENSUS_WINDOW_SQL } from "../../signal/search-log-reads.ts";

export type MapTilerActorCounter = (
  since: string,
  until: string,
) => Promise<MapTilerActorCounts | null>;

export interface CollectMapTilerUsageInput {
  readonly nowIso?: string;
  readonly token?: string | null;
  readonly allowanceRaw?: string;
  readonly fetcher?: Fetcher;
  readonly actorCounter?: MapTilerActorCounter;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function realIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function finiteCount(value: unknown, actor: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`MAPTILER_ACTOR_COUNT_INVALID:${actor}`);
  }
  return count;
}

async function productionActorCounts(
  since: string,
  until: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<MapTilerActorCounts | null> {
  const url = env.WTP_PRODUCTION_DATABASE_URL_READONLY?.trim();
  if (!url) return null;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const rows = (await sql.query(RUN_CLASS_CENSUS_WINDOW_SQL, [
    `${since}T00:00:00Z`,
    `${until}T23:59:59Z`,
  ])) as { run_class: string; n: unknown }[];
  const of = (name: string): number => finiteCount(rows.find((row) => row.run_class === name)?.n ?? 0, name);
  return {
    since,
    until,
    declaredSynthetic: of("SYNTHETIC"),
    undeclaredPublic: of("ORGANIC"),
    unattributed: of("UNKNOWN"),
    author: of("AUTHOR"),
  };
}

function failedSnapshot(input: {
  readonly nowIso: string;
  readonly allowance: number;
  readonly assumed: boolean;
  readonly connection: "NOT_CONNECTED" | "COULD_NOT_ASK";
  readonly detail: string;
  readonly provenance: readonly MapTilerFetchProvenance[];
}): MapTilerUsageSnapshot {
  return {
    formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
    collectedAt: input.nowIso,
    publisher: "standing-runtime/maptiler-observer",
    connection: input.connection,
    detail: input.detail,
    period: "current_billing_period",
    since: null,
    until: null,
    allowance: input.allowance,
    allowanceIsAssumed: input.assumed,
    days: [],
    provenance: input.provenance,
    latestAttempt: {
      attemptedAt: input.nowIso,
      connection: input.connection,
      detail: input.detail,
      provenance: input.provenance,
    },
    actors: null,
    actorsDetail: "The provider reading is unknown, so the Reader-event comparison is also unknown.",
  };
}

export async function collectMapTilerUsage(
  input: CollectMapTilerUsageInput = {},
): Promise<MapTilerUsageSnapshot> {
  const env = input.env ?? process.env;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const rawToken = input.token === undefined ? serviceTokenFromEnv(env) : input.token?.trim() || null;
  const { allowance, assumed } = allowanceFrom(
    input.allowanceRaw === undefined ? env[MAPTILER_ALLOWANCE_VAR] : input.allowanceRaw,
  );

  if (rawToken === null) {
    return failedSnapshot({
      nowIso,
      allowance,
      assumed,
      connection: "NOT_CONNECTED",
      detail:
        "NOT CONNECTED — the read-only MapTiler service credential is not installed in the standing runtime, " +
        "so nobody has asked MapTiler what this account spent. This is not a reading of zero.",
      provenance: [],
    });
  }

  const provenance: MapTilerFetchProvenance[] = [];
  const days: MapTilerUsageDay[] = [];
  const windows: { since: string; until: string }[] = [];
  const failures: string[] = [];

  for (const classifier of ["api_keys", "services"] as const satisfies readonly MapTilerClassifier[]) {
    const result = await fetchTimeline({
      period: "current_billing_period",
      classifier,
      group: "request",
      token: rawToken,
      nowIso,
      fetcher: input.fetcher,
    });
    if (!result.ok || result.timeline === null) {
      provenance.push(result.provenance);
      failures.push(result.provenance.error ?? `${classifier} did not return a timeline`);
      continue;
    }
    if (!realIsoDate(result.timeline.since) || !realIsoDate(result.timeline.until) || result.timeline.since > result.timeline.until) {
      const detail = `${classifier} did not return one valid billing window`;
      provenance.push({ ...result.provenance, error: detail });
      failures.push(detail);
      continue;
    }
    try {
      const normalized = normalizeTimeline({ timeline: result.timeline, classifier, group: "request" });
      if (!normalized.some((row) => !row.estimated)) {
        throw new Error(`${classifier} returned no measured day row`);
      }
      provenance.push(result.provenance);
      days.push(...normalized);
      windows.push({ since: result.timeline.since, until: result.timeline.until });
    } catch (error) {
      const detail = scrubToken(
        `The ${classifier} timeline was refused: ${(error as Error)?.message ?? "invalid timeline"}.`,
        rawToken,
      );
      provenance.push({ ...result.provenance, error: detail });
      failures.push(detail);
    }
  }

  const oneWindow = windows.length === 2 && windows[0].since === windows[1].since &&
    windows[0].until === windows[1].until;
  if (failures.length > 0 || !oneWindow) {
    if (failures.length === 0) {
      failures.push("The key and service classifiers returned different billing windows");
    }
    return failedSnapshot({
      nowIso,
      allowance,
      assumed,
      connection: "COULD_NOT_ASK",
      detail:
        `COULD NOT ASK — MapTiler did not return both complete classifiers for one billing window. ` +
        `${scrubToken(failures.join(" "), rawToken)} This partial result was refused and is not zero.`,
      provenance,
    });
  }

  const since = windows[0].since;
  const until = windows[0].until;
  let actors: MapTilerActorCounts | null = null;
  let actorsDetail: string | null = null;
  try {
    actors = input.actorCounter
      ? await input.actorCounter(since, until)
      : await productionActorCounts(since, until, env);
    if (actors === null) {
      actorsDetail =
        "The standing collector could not read the production Reader-event aggregate for this " +
        "billing window. The comparison is unknown, not zero.";
    } else {
      for (const [name, value] of Object.entries(actors)) {
        if (name === "since" || name === "until") continue;
        finiteCount(value, name);
      }
      if (actors.since !== since || actors.until !== until) {
        throw new Error("MAPTILER_ACTOR_WINDOW_MISMATCH");
      }
    }
  } catch (error) {
    actors = null;
    actorsDetail =
      `The standing collector could not measure the production Reader-event comparison ` +
      `(${(error as Error)?.name ?? "error"}). The comparison is unknown, not zero.`;
  }

  return {
    formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
    collectedAt: nowIso,
    publisher: "standing-runtime/maptiler-observer",
    connection: "CONNECTED",
    detail: null,
    period: "current_billing_period",
    since,
    until,
    allowance,
    allowanceIsAssumed: assumed,
    days,
    provenance,
    latestAttempt: {
      attemptedAt: nowIso,
      connection: "CONNECTED",
      detail: null,
      provenance,
    },
    actors,
    actorsDetail,
  };
}
