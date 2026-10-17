/**
 * The route-aware executor: opens what each `RouteDescriptor` says (GET, POST, or nothing), reusing
 * `http-executor.ts`'s disposition mapping. A response that misses the declared yield contract is ABORTED; a
 * zero row count is a failed extraction, never WALKED_NO_YIELD, except a search query's miss; a route with no client is written
 * REQUIRES_NEW_ADAPTER, which keeps the record owed. No credential value is read or recorded.
 */

import { assertPublicUrl, publicFetch } from "../../hunt/egress.ts";
import { ZERO_COST, type AttemptCost } from "../attempt.ts";
import { deriveSanitized, recordAcquisition, type Artifact } from "../evidence/artifact.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";

import type { RunWork, WorkOutcome } from "./dispatch.ts";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  WALL_STATUSES,
  httpProviderFailure,
  type FetchOutcome,
} from "./http-executor.ts";
import type { RouteDescriptor, YieldContract } from "./registry.ts";
import { DEFAULT_USER_AGENT } from "./user-agent.ts";
import { websiteRequestLimit, websiteSizeForObligation, type WebsiteSizeForUrl } from "./host-supervision.ts";

const RAN_AS = "DETERMINISTIC" as const;

/** The seam a test replaces. Nothing else in this module touches the network. */
export type OpenOne = (input: {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}) => Promise<FetchOutcome>;

/** The default identification: named, never disguised. A descriptor may move it into `From:` and `X-Purpose:`. */
export { DEFAULT_USER_AGENT };

export const realOpen: OpenOne = async ({ url, method, headers, body, timeoutMs }) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await publicFetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    return {
      status: response.status,
      bytes: Buffer.byteLength(text, "utf8"),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body: text,
      durationMs: Date.now() - started,
      transportError: null,
      contentRange: response.headers.get("content-range"),
    };
  } catch (error) {
    return {
      status: null,
      bytes: 0,
      contentType: "",
      body: "",
      durationMs: Date.now() - started,
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

function cost(outcome: FetchOutcome): AttemptCost {
  return { ...ZERO_COST, durationMs: outcome.durationMs, bytesFetched: outcome.bytes, requestCount: outcome.requestCount ?? 1 };
}

/** Walk a dot path through parsed JSON. Returns undefined rather than throwing. */
function at(value: unknown, path: string): unknown {
  let cursor: unknown = value;
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

export interface ContractReading {
  readonly satisfied: boolean;
  /** Rows the response carried, when the contract names where to count them. */
  readonly rows: number | null;
  /** A search query answered with zero results. */
  readonly miss?: true;
  readonly detail: string;
}

/** Check a body against a route's yield contract. Missing shape, present with zero rows, and no contract are three different outcomes. */
export function checkYield(contract: YieldContract, body: string): ContractReading {
  const missing = contract.requireAll.filter((token) => !body.includes(token));
  if (missing.length > 0) {
    return {
      satisfied: false,
      rows: null,
      detail:
        `the response does not carry ${missing.map((m) => JSON.stringify(m)).join(", ")}, so it is ` +
        `not ${contract.describe}. Whatever answered, it was not this route's record — recorded ` +
        "as a FAILED extraction and never as an empty document.",
    };
  }

  if (contract.rowsAt === undefined && contract.countAt === undefined) {
    return {
      satisfied: true,
      rows: null,
      detail: `the response carries ${contract.describe}; the contract names no row count to check`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      satisfied: false,
      rows: null,
      detail:
        `the contract names a row count but the body is not JSON (${
          error instanceof Error ? error.message : String(error)
        }). A row count that cannot be read is not a row count of zero.`,
    };
  }

  let rows: number | null = null;
  if (contract.rowsAt !== undefined) {
    const found = at(parsed, contract.rowsAt);
    if (!Array.isArray(found)) {
      return {
        satisfied: false,
        rows: null,
        detail:
          `the contract names an array at \`${contract.rowsAt}\` and the response carries no array ` +
          "there. That is a failure to find the rows, which is not the same as finding none.",
      };
    }
    rows = found.length;
  }
  if (contract.countAt !== undefined) {
    const found = at(parsed, contract.countAt);
    if (typeof found !== "number" || !Number.isFinite(found)) {
      return {
        satisfied: false,
        rows,
        detail:
          `the contract names an integer at \`${contract.countAt}\` and the response carries ` +
          `${JSON.stringify(found)} there. An unreadable count is not a count of zero.`,
      };
    }
    rows = rows === null ? found : Math.max(rows, found);
  }

  if (rows === 0 && contract.zeroRowsIsMiss) {
    return { satisfied: false, rows: 0, miss: true, detail: `the response carries ${contract.describe} and no result for this query` };
  }
  if (rows !== null && rows === 0) {
    return {
      satisfied: false,
      rows: 0,
      detail:
        `the response carries ${contract.describe} and ZERO rows. A zero-row extraction is a FAILED ` +
        "extraction, never an empty document, and it may not become WALKED_NO_YIELD — that " +
        "disposition asserts the publisher genuinely had nothing, which is a claim about a " +
        "government that nothing observed here supports.",
    };
  }

  return {
    satisfied: true,
    rows,
    detail: `${contract.describe}, ${rows ?? "unknown"} row(s)`,
  };
}

/** A successful HTTP response is acquired only when its readable bytes are saved; a storage refusal leaves the source owed. */
export type VaultPut = (
  artifact: Artifact,
  body: string,
) => Promise<{ readonly stored: boolean; readonly where: string; readonly why: string }>;

/** Build the executor. An obligation with no descriptor is an ABORTED attempt naming our gap. */
export function routeExecutor(input: {
  readonly routeFor: (obligationId: string) => RouteDescriptor | null;
  readonly openOne?: OpenOne;
  readonly timeoutMs?: number;
  /** Injected so tests do not sleep. Returns immediately when omitted. */
  readonly spaceOut?: (hostKey: string) => Promise<void>;
  readonly websiteSize?: WebsiteSizeForUrl;
  /** Where retrieved bytes are persisted. A missing store leaves acquisition owed. */
  readonly vault?: VaultPut;
  readonly now?: () => string;
}): RunWork {
  const openOne = input.openOne ?? realOpen;
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const clock = input.now ?? (() => new Date().toISOString());

  return async ({ obligation, workItemId, attemptId }): Promise<WorkOutcome> => {
    const obligationId = obligation.obligation.id;
    const route = input.routeFor(obligationId);

    if (route === null) {
      return {
        ranAs: RAN_AS,
        kind: "ABORTED",
        detail:
          `no route descriptor is registered for ${obligationId}, so there is nothing to open. ` +
          "This is a gap in OUR registry, not evidence about a publisher, and it stays owed.",
      };
    }

    /* A route we hold no client for commits REQUIRES_NEW_ADAPTER: debt accrues and the next-due stands. */
    if (route.open.kind === "NOT_MACHINE_EXECUTABLE") {
      return {
        ranAs: RAN_AS,
        kind: "DISPOSED",
        disposition: {
          disposition: "REQUIRES_NEW_ADAPTER",
          observation: null,
          permission: "CANNOT_TELL",
          /* Nothing was sent, so the transport is `OTHER_NAMED_FAILURE`, not a guess. */
          transport: "OTHER_NAMED_FAILURE",
          note:
            `${route.label}: NO CLIENT IN THIS PROCESS — nothing was sent, so nothing was observed ` +
            `about the host. ${route.open.reason}` +
            (route.awaitingAdapter ? ` NEXT MOVE: ${route.awaitingAdapter}` : ""),
        },
        cost: ZERO_COST,
        detail:
          `${route.open.target} needs an adapter this process does not have. A capability gap on ` +
          "our side, named — the record is still owed and its clock still runs.",
      };
    }

    /* A route a routine contract carries is never opened here: nothing is sent and the round closes `DISCOVERED`, neither terminal nor discharging. */
    if (route.open.kind === "ROUTINE_READ") {
      const failure = route.open.cadenceFailure;
      return {
        ranAs: RAN_AS,
        kind: "DISPOSED",
        disposition: {
          disposition: "DISCOVERED",
          observation: null,
          permission: "NOT_APPLICABLE",
          transport: "OTHER_NAMED_FAILURE",
          note:
            `${failure === null ? "" : `CADENCE_BROKEN: ${failure} `}${route.label}: CARRIED BY THE ROUTINE READ of ` +
            `${route.open.contractIds.join(", ")} — nothing was sent by this process, which never opens a feed a routine ` +
            `contract reads. ${route.open.reason}`,
        },
        /* Measured, not absent: no request was sent and no byte fetched. */
        cost: { ...ZERO_COST, requestCount: 0, bytesFetched: 0 },
        detail:
          failure === null
            ? `${route.open.target} is carried by its routine read; the record is still owed and closes when that read holds it.`
            : `${route.open.target} is carried by a routine read that has not succeeded within its required cadence: ${failure}`,
      };
    }

    let url: URL;
    try {
      url = assertPublicUrl(route.open.url);
    } catch (error) {
      return {
        ranAs: RAN_AS,
        kind: "ABORTED",
        detail: `the descriptor's URL is not a public http(s) address: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const headers: Record<string, string> = {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/json,text/calendar,*/*",
      ...(route.open.kind === "HTTP_POST" ? { "content-type": route.open.contentType } : {}),
      ...(route.open.headers ?? {}),
    };

    const websiteSize = input.websiteSize ?? await websiteSizeForObligation(obligation.obligation);
    if (input.spaceOut && websiteRequestLimit(websiteSize(url.toString())) !== null) await input.spaceOut(url.host);
    const got = await openOne({
      url: url.toString(),
      method: route.open.kind === "HTTP_POST" ? "POST" : "GET",
      headers,
      ...(route.open.kind === "HTTP_POST" ? { body: route.open.body } : {}),
      timeoutMs,
    });

    const providerFailure = httpProviderFailure(url.toString(), got);
    if (providerFailure !== null && got.status !== 429) {
      return {
        ranAs: RAN_AS,
        kind: "ABORTED",
        cost: cost(got),
        detail: `Provider failure at ${url.host}: ${providerFailure}. The record remains owed; try another source.`,
      };
    }

    const status = got.status ?? 0;

    if (status >= 200 && status < 300) {
      if (route.yieldContract !== undefined) {
        const reading = checkYield(route.yieldContract, got.body);
        if (reading.miss) {
          return {
            ranAs: RAN_AS,
            kind: "DISPOSED",
            disposition: {
              disposition: "WALKED_NO_YIELD",
              observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: null, earliest: null, latest: null },
              permission: "ALLOWED",
              transport: "REACHABLE",
              note: `${route.label}: HTTP ${status} from ${url.host}, ${got.bytes} bytes; ${reading.detail}. A miss for this query, not a fact about any government.`,
            },
            artifacts: [],
            cost: cost(got),
            detail: `${route.label}: no result for this query`,
          };
        }
        if (!reading.satisfied) {
          return {
            ranAs: RAN_AS,
            kind: "ABORTED",
            cost: cost(got),
            detail:
              `HTTP ${status} from ${url.host}, ${got.bytes} bytes, and the declared yield contract ` +
              `was NOT satisfied: ${reading.detail}`,
          };
        }
        return await ingested({
          route,
          url,
          got,
          workItemId,
          attemptId,
          rows: reading.rows,
          contractDetail: reading.detail,
          ...(input.vault ? { vault: input.vault } : {}),
          at: clock(),
        });
      }

      return await ingested({
        route,
        url,
        got,
        workItemId,
        attemptId,
        rows: null,
        contractDetail: "no yield contract was declared for this route",
        ...(input.vault ? { vault: input.vault } : {}),
        at: clock(),
      });
    }

    if (WALL_STATUSES.includes(status)) {
      return {
        ranAs: RAN_AS,
        kind: "DISPOSED",
        disposition: {
          disposition: "BLOCKED_CURRENTLY",
          observation: null,
          /* A 403 refuses this client and reads no rule, so permission is CANNOT_TELL. */
          permission: "CANNOT_TELL",
          transport: "CHALLENGED",
          note:
            `${route.label}: ${url.host} answered HTTP ${status} to this client. That is a wall at ` +
            "this route, and it is not a fact about whether the record exists or about the host's " +
            "policy.",
        },
        cost: cost(got),
        detail: `HTTP ${status} — a wall, named. The record remains owed.`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        ranAs: RAN_AS,
        kind: "DISPOSED",
        disposition: {
          disposition: "BLOCKED_CURRENTLY",
          observation: null,
          permission: "CANNOT_TELL",
          transport: "FAILED_AT_RUNG",
          note:
            `${route.label}: ${url} answered HTTP ${status}. The URL did not serve the record; the ` +
            "record itself is not addressed by that, and another representation of it is owed.",
        },
        cost: cost(got),
        detail: `HTTP ${status} at this URL — a fact about the URL, not about the record.`,
      };
    }

    return {
      ranAs: RAN_AS,
      kind: "ABORTED",
      cost: cost(got),
      detail: `${url.host} answered HTTP ${status} — their side broke, and this retries.`,
    };
  };
}

/** A satisfied retrieval: classify the bytes (the tier comes from scanning them), vault them, attribute them. */
async function ingested(input: {
  readonly route: RouteDescriptor;
  readonly url: URL;
  readonly got: FetchOutcome;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly rows: number | null;
  readonly contractDetail: string;
  readonly vault?: VaultPut;
  readonly at: string;
}): Promise<WorkOutcome> {
  const { route, url, got, rows } = input;
  const { artifact: raw } = recordAcquisition(
    {
      canonicalUrl: url.toString(),
      retrievedAt: input.at,
      httpStatus: got.status ?? 0,
      contentType: got.contentType,
      sourceId: url.host,
      methodRouteId: route.routeId,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      permission: "ALLOWED",
      transport: "REACHABLE",
    },
    got.body,
  );

  let artifact = raw;
  let body = got.body;
  if (raw.tier === "RESTRICTED_RAW") {
    // Public portals embed unrelated credentials: keep the source hash and redactions, and give parsers the saved readable page.
    if (input.vault) {
      try { await input.vault(raw, body); }
      catch { /* A restricted substrate is optional; the derivative is still owed. */ }
    }
    const derived = deriveSanitized(raw, body, input.at);
    artifact = derived.artifact;
    body = derived.text;
  }

  let stored = false;
  let vaulted = "no vault was supplied to this executor";
  if (input.vault) {
    try {
      const report = await input.vault(artifact, body);
      stored = report.stored;
      vaulted = report.stored
        ? `bytes persisted at ${report.where}`
        : `bytes were NOT persisted: ${sanitizedErrorDiagnostic(report.why)}`;
    } catch (error) {
      vaulted = `the vault REFUSED these bytes: ${sanitizedErrorDiagnostic(error)}`;
    }
  }
  if (!stored) return { ranAs: RAN_AS, kind: "ABORTED", cost: cost(got),
    detail: `SOURCE_PAGE_NOT_SAVED: HTTP ${got.status} from ${url.host}; ${vaulted}. Acquisition remains owed.` };

  return {
    ranAs: RAN_AS,
    kind: "DISPOSED",
    disposition: {
      disposition: "INGESTED",
      observation: {
        /* `rawCount` is the rows the contract counts (or 1, the document); `normalizedCount` is zero because normalization is the next stage. */
        rawCount: rows ?? 1,
        normalizedCount: 0,
        routeOnlyCount: null,
        earliest: null,
        latest: null,
      },
      permission: "ALLOWED",
      transport: "REACHABLE",
      note:
        `${route.label}: HTTP ${got.status} from ${url.host}, ${got.bytes} bytes, tier ` +
        `${artifact.tier} decided by scanning — ${vaulted}. ${input.contractDetail}. ACQUISITION ` +
        "ONLY: nothing here is normalized and nothing is promoted to reader truth.",
    },
    artifacts: [
      {
        artifactId: artifact.id,
        tier: artifact.tier,
        contentHash: artifact.contentHash,
        byteLength: artifact.byteLength,
        contentType: artifact.contentType,
        canonicalUrl: artifact.canonicalUrl,
        partial: false,
        recordedAt: input.at,
      },
    ],
    cost: cost(got),
    detail: `HTTP ${got.status}, ${got.bytes} bytes, ${rows === null ? "row count unstated" : `${rows} row(s)`}`,
  };
}
