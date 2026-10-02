/**
 * **THE ROUTE-AWARE EXECUTOR.** (Session C, PART D1/D2, 2026-08-31.)
 *
 * `http-executor.ts` opens one thing: a GET against a URL looked up by
 * obligation id. That is exactly right for the meetings corpus and cannot
 * express a single campaign-finance route — the two live ones are POSTs whose
 * BODIES are their schemas, one route is an FTP drop no HTTP client can open,
 * and one ends in a human act.
 *
 * So this executor takes a `RouteDescriptor` per obligation and opens what the
 * descriptor says. It reuses `http-executor.ts`'s disposition mapping verbatim
 * where it applies, because that mapping is the honesty and duplicating it
 * would let the two drift.
 *
 * ## Three things it adds, and each closes a specific way to be wrong
 *
 * **1. THE YIELD CONTRACT.** A 200 with bytes is INGESTED under the plain
 * mapping. `seethemoney.az.gov` answered HTTP 200 with a two-byte empty JSON
 * string to every guessed body for a week. Without a contract this executor
 * would write a terminal INGESTED, record two bytes as Arizona's filer index,
 * clear the debt and move the clock — a wrong answer about a government,
 * produced by arithmetic. A response that misses the declared contract is an
 * ABORTED attempt naming what was expected and what arrived.
 *
 * **2. A ZERO ROW COUNT IS A FAILED EXTRACTION.** A response that satisfies the
 * shape and carries zero rows does NOT become `WALKED_NO_YIELD`. That
 * disposition asserts the route was reached and the publisher genuinely had
 * nothing, which is a claim about a government; nothing observable here
 * justifies it for an index that returned 370 rows a day ago.
 *
 * **3. `REQUIRES_NEW_ADAPTER` IS A REAL DISPOSITION AND IS WRITTEN AS ONE.** A
 * route this process holds no client for closes its RouteTask honestly and
 * keeps the record obligation live: `REQUIRES_NEW_ADAPTER` is absent from
 * `TERMINAL_DISPOSITIONS` and from `DISCHARGING_DISPOSITIONS`, so the debt
 * accrues, the next-due stands and the digest names the missing adapter. That
 * is "a blocked route may never become a blocked fact", implemented.
 *
 * ## No secret is read, written, logged or sent
 *
 * Nothing in this module reads a credential. Route headers come from committed
 * descriptors, and the only environment variable any provider consults is read
 * by NAME for an identification header. `WTP_WORKERS_ANTHROPIC_API_KEY` is the
 * variable a bounded model worker would need; no route here uses one, and no
 * value of any variable is ever placed in a row, a log, a prompt or an artifact.
 */

import { assertPublicUrl } from "../../hunt/egress.ts";
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

/**
 * The default identification.
 *
 * Named, never disguised: the transparency mandate permits persistence and
 * forbids residential-proxy spoofing, and a User-Agent that says who we are
 * gives an administrator someone to contact. A descriptor may override it —
 * `www.sos.nh.gov` refuses this project's name and serves a bare client, so
 * that route moves the identification into `From:` and `X-Purpose:`, which is
 * still identification.
 */
export { DEFAULT_USER_AGENT };

export const realOpen: OpenOne = async ({ url, method, headers, body, timeoutMs }) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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
  readonly detail: string;
}

/**
 * Check a response body against a route's declared yield contract.
 *
 * Exported and tested directly. The interesting cases are all zero-shaped and
 * they must not collapse into one: the shape can be MISSING (we are talking to
 * something else, or to an error page), the shape can be PRESENT with zero rows
 * (a failed extraction), or the contract can be absent altogether (the caller
 * falls back to bytes, which is only safe where nothing has ever answered 200
 * with nothing).
 */
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

/**
 * **WHERE THE BYTES GO.**
 *
 * The pre-existing `httpExecutor` recorded artifact METADATA against the
 * Attempt and wrote the bytes NOWHERE, while its own disposition note said
 * "captured to the vault". That is a citation to a body no store holds, and
 * RULING 224's promotion tail cannot run over it: normalization needs the
 * bytes. This seam is what makes the note true.
 *
 * A successful HTTP response is acquired only when its readable bytes are
 * saved. A storage refusal leaves the source owed through the existing retry.
 */
export type VaultPut = (
  artifact: Artifact,
  body: string,
) => Promise<{ readonly stored: boolean; readonly where: string; readonly why: string }>;

/**
 * Build the executor.
 *
 * `routeFor` is the registry's lookup. An obligation with no descriptor is an
 * ABORTED attempt naming OUR gap, never a conclusion about the publisher.
 */
export function routeExecutor(input: {
  readonly routeFor: (obligationId: string) => RouteDescriptor | null;
  readonly openOne?: OpenOne;
  readonly timeoutMs?: number;
  /** Injected so tests do not sleep. Returns immediately when omitted. */
  readonly spaceOut?: (hostKey: string) => Promise<void>;
  readonly websiteSize?: WebsiteSizeForUrl;
  readonly root?: string;
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

    /*
     * A ROUTE WE HOLD NO CLIENT FOR CLOSES ITS TASK AND KEEPS THE RECORD OWED.
     *
     * `REQUIRES_NEW_ADAPTER` is absent from both `TERMINAL_DISPOSITIONS` and
     * `DISCHARGING_DISPOSITIONS`, so this commits a disposition, accrues debt,
     * and leaves the next-due standing. The named next move travels with it.
     */
    if (route.open.kind === "NOT_MACHINE_EXECUTABLE") {
      return {
        ranAs: RAN_AS,
        kind: "DISPOSED",
        disposition: {
          disposition: "REQUIRES_NEW_ADAPTER",
          observation: null,
          permission: "CANNOT_TELL",
          /*
           * `OTHER_NAMED_FAILURE` and NOT a guess at what the transport would
           * have done. Nothing was sent, so REACHABLE would be a claim and
           * FAILED_AT_RUNG would be a claim; the failure is that this process
           * has no client, which is named in full in the note beside it.
           */
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

    /*
     * A ROUTE A ROUTINE CONTRACT CARRIES IS NEVER OPENED HERE (2026-09-25).
     *
     * The record is read on the routine contract's own clock; a fetch from this
     * process would be a second clock on the same feed. Nothing is sent. The
     * round closes `DISCOVERED` — the route to the record is known and the
     * record itself is still owed — which is neither terminal nor discharging,
     * so the obligation stays live until the provider stops emitting it (the
     * routine read closed the gap) and its retirement names that.
     */
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

    const websiteSize = input.websiteSize ?? websiteSizeForObligation(obligation.obligation, input.root);
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
          /* RULING 182: a 403 refuses THIS CLIENT and reads no rule, so
             permission is CANNOT_TELL and fails safe rather than being written
             down as DISALLOWED. */
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

/**
 * A satisfied retrieval: classify the bytes, vault them, attribute them.
 *
 * **THE TIER IS DECIDED BY SCANNING THE BYTES**, through the shipped
 * `classifyAcquisition` inside `recordAcquisition`, and not hard-coded. The
 * previous executor wrote `tier: "RESTRICTED_RAW"` for every artifact, which is
 * both an over-classification of a public state record and — because the
 * durable vault refuses that tier without an encrypted, access-controlled
 * provider — the reason those bytes could never have been stored at all.
 */
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
    // Public portals embed credentials unrelated to their civic content. Use
    // the same derivative as Scout: retain the source hash and redactions,
    // while giving parsers the saved, readable page instead of a missing raw copy.
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
        /*
         * `rawCount` is the ROWS the response carried when the contract names
         * where to count them, and 1 (the document itself) when it does not.
         * `normalizedCount` is deliberately ZERO: normalization is the next
         * stage and claiming it here would report parsing that did not happen.
         */
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
