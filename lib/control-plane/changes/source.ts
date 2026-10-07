/**
 * Reads the changes from GitHub, server side and cached.
 *
 * @freshness-reads-here — `observedAt` is the instant of this module's own read of GitHub,
 * stamped when that read is made, never a date carried from earlier work.
 *
 * The repository is private: without `WTP_GITHUB_READ_TOKEN` (Pull requests,
 * Contents and Metadata read) the page says so and lists nothing.
 *
 * ```
 *   one GraphQL call     the most recently updated pull requests, with check state
 *   per merged PR        is its merge commit inside the live site's commit
 *                        (`compare/<merge>...<live>`), and if not, does it touch
 *                        anything the site serves (`pulls/<n>/files` against
 *                        `isNonShippingPath`)
 * ```
 *
 * The live commit comes from this build's own `/api/build` stamp, else the
 * public endpoint.
 */
import { isNonShippingPath } from "../../ops/deploy-paths.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";
import {
  changeRowOf,
  type ChangePr,
  type ChangeRow,
  type ChecksState,
  type LiveReading,
} from "./model.ts";

export const CHANGES_TOKEN_VAR = "WTP_GITHUB_READ_TOKEN";
export const CHANGES_REPO = "SeanJ22/meanwhile";
export const CHANGES_CACHE_SECONDS = 60;
export const CHANGES_FETCH_TIMEOUT_MS = 10_000;
/** How many recently updated pull requests one read lists. */
export const CHANGES_PR_COUNT = 60;
/** Merged work older than this stops being listed; it is history, not news. */
export const CHANGES_MERGED_DAYS = 14;
const LIVE_SITE_BUILD_URL = `${PUBLIC_SITE_ORIGIN}/api/build`;

export type ChangesReading =
  | {
      readonly kind: "OBSERVED";
      readonly rows: readonly ChangeRow[];
      readonly observedAt: string;
      readonly liveSha: string | null;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly observedAt: string;
      readonly reason: string;
      /** The one step that fixes it, when there is one. */
      readonly fix: string | null;
    };

export interface ChangesOptions {
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nowMs?: () => number;
  readonly force?: boolean;
}

let memo: { at: number; reading: ChangesReading } | null = null;

export function forgetChanges(): void {
  memo = null;
}

const QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequests(first:$n,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url state isDraft updatedAt mergedAt headRefName baseRefName mergeCommit{oid} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`;

interface GraphNode {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly isDraft: boolean;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly mergeCommit: { readonly oid: string } | null;
  readonly commits: { readonly nodes: readonly { readonly commit: { readonly statusCheckRollup: { readonly state: string } | null } }[] };
}

const CHECKS: ReadonlySet<string> = new Set(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]);

function isNode(v: unknown): v is GraphNode {
  if (v === null || typeof v !== "object") return false;
  const n = v as Record<string, unknown>;
  return typeof n.number === "number" && typeof n.title === "string" && typeof n.url === "string" &&
    (n.state === "OPEN" || n.state === "MERGED" || n.state === "CLOSED") && typeof n.updatedAt === "string";
}

function toPr(node: GraphNode): ChangePr {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    isDraft: node.isDraft === true,
    updatedAt: node.updatedAt,
    mergedAt: node.mergedAt ?? null,
    headRefName: node.headRefName ?? "",
    baseRefName: node.baseRefName ?? "",
    checks: rollup !== null && CHECKS.has(rollup) ? (rollup as ChecksState) : null,
  };
}

async function json(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(CHANGES_FETCH_TIMEOUT_MS) });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** The live site's commit: this build's own stamp, else the public endpoint. */
async function liveSha(env: Readonly<Record<string, string | undefined>>, fetchImpl: typeof fetch): Promise<string | null> {
  const stamped = (env.WTP_BUILD_COMMIT ?? "").trim();
  if (/^[0-9a-f]{40}$/.test(stamped)) return stamped;
  try {
    const { status, body } = await json(LIVE_SITE_BUILD_URL, { headers: { accept: "application/json" } }, fetchImpl);
    const commit = status === 200 && body !== null && typeof body === "object" ? (body as { commit?: unknown }).commit : null;
    return typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

async function liveReadingOf(
  pr: ChangePr,
  mergeSha: string | null,
  live: string | null,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<LiveReading> {
  if (mergeSha === null || live === null) return "unknown";
  try {
    const compare = await json(`https://api.github.com/repos/${CHANGES_REPO}/compare/${mergeSha}...${live}`, { headers }, fetchImpl);
    const status = compare.status === 200 && compare.body !== null && typeof compare.body === "object"
      ? (compare.body as { status?: unknown }).status
      : null;
    if (status === "ahead" || status === "identical") return "in-live-site";
    if (status === null) return "unknown";
    const files = await json(`https://api.github.com/repos/${CHANGES_REPO}/pulls/${pr.number}/files?per_page=100`, { headers }, fetchImpl);
    if (files.status !== 200 || !Array.isArray(files.body)) return "not-yet";
    const paths = (files.body as readonly { filename?: unknown }[]).map((f) => (typeof f.filename === "string" ? f.filename : ""));
    // 100 files is one page; a bigger change is assumed to ship.
    return paths.length > 0 && paths.length < 100 && paths.every(isNonShippingPath) ? "no-site-change" : "not-yet";
  } catch {
    return "unknown";
  }
}

export async function readChanges(options: ChangesOptions = {}): Promise<ChangesReading> {
  const nowMs = options.nowMs ?? (() => Date.now());
  if (!options.force && memo && nowMs() - memo.at < CHANGES_CACHE_SECONDS * 1000) return memo.reading;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const observedAt = new Date(nowMs()).toISOString();
  const token = (env[CHANGES_TOKEN_VAR] ?? env.GH_TOKEN ?? "").trim();
  const remember = (reading: ChangesReading): ChangesReading => {
    memo = { at: nowMs(), reading };
    return reading;
  };
  if (token === "") {
    return remember({
      kind: "UNAVAILABLE",
      observedAt,
      reason: "This page cannot read GitHub yet, because the repository is private and no read-only token is set.",
      fix: `Create a fine-grained GitHub token with read-only access to ${CHANGES_REPO} (Pull requests, Contents, Metadata) and add it to the Netlify site settings as ${CHANGES_TOKEN_VAR}.`,
    });
  }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "meanwhile-admin-changes",
    "x-github-api-version": "2022-11-28",
  };
  let nodes: readonly GraphNode[];
  try {
    const { status, body } = await json(
      "https://api.github.com/graphql",
      { method: "POST", headers, body: JSON.stringify({ query: QUERY, variables: { owner: CHANGES_REPO.split("/")[0], name: CHANGES_REPO.split("/")[1], n: CHANGES_PR_COUNT } }) },
      fetchImpl,
    );
    const list = (body as { data?: { repository?: { pullRequests?: { nodes?: unknown } } } } | null)?.data?.repository?.pullRequests?.nodes;
    if (status !== 200 || !Array.isArray(list)) {
      return remember({
        kind: "UNAVAILABLE",
        observedAt,
        reason: status === 401 || status === 403 ? "GitHub refused the token, so no changes were read." : `GitHub answered ${status}, so no changes were read.`,
        fix: status === 401 || status === 403 ? `Replace ${CHANGES_TOKEN_VAR} with a token that can read pull requests on ${CHANGES_REPO}.` : null,
      });
    }
    nodes = list.filter(isNode);
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return remember({ kind: "UNAVAILABLE", observedAt, reason: timeout ? "GitHub did not answer in time, so no changes were read." : "GitHub could not be reached, so no changes were read.", fix: null });
  }
  const live = await liveSha(env, fetchImpl);
  const cutoff = nowMs() - CHANGES_MERGED_DAYS * 86_400_000;
  const rows = (
    await Promise.all(
      nodes.map(async (node) => {
        const pr = toPr(node);
        if (pr.state === "MERGED" && Date.parse(pr.mergedAt ?? pr.updatedAt) < cutoff) return null;
        const reading = pr.state === "MERGED" && pr.baseRefName === "main"
          ? await liveReadingOf(pr, node.mergeCommit?.oid ?? null, live, headers, fetchImpl)
          : "unknown";
        return changeRowOf(pr, reading);
      }),
    )
  ).filter((row): row is ChangeRow => row !== null);
  return remember({ kind: "OBSERVED", rows, observedAt, liveSha: live });
}
