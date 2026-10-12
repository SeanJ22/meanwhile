/** Staging has no release manifest, so it is reported as not read, never as a build. */
import { SYNTHETIC_RUN_HEADER } from "@/lib/db/run-marker.ts";
import { PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";
import type { EnvironmentIdentities } from "./context.ts";

const PRODUCTION_BUILD_URL = `${PUBLIC_SITE_ORIGIN}/api/build`;
const CACHE_SECONDS = 30;
const FETCH_TIMEOUT_MS = 8_000;
const SOURCE = "the build identity production reports about itself";

let memo: { at: number; value: EnvironmentIdentities } | null = null;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

async function productionBuild(): Promise<{ body: Record<string, unknown> | null; detail: string | null }> {
  try {
    const response = await fetch(PRODUCTION_BUILD_URL, {
      headers: { accept: "application/json", [SYNTHETIC_RUN_HEADER]: "admin-operator-chat" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200) return { body: null, detail: `HTTP ${response.status}` };
    const parsed: unknown = await response.json().catch(() => null);
    return parsed !== null && typeof parsed === "object"
      ? { body: parsed as Record<string, unknown>, detail: null }
      : { body: null, detail: "the answer was not a JSON object" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return { body: null, detail: name === "TimeoutError" ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s` : `${name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function readEnvironments(nowMs: number = Date.now()): Promise<EnvironmentIdentities> {
  if (memo && nowMs - memo.at < CACHE_SECONDS * 1000) return memo.value;
  const observedAt = new Date(nowMs).toISOString();
  const { body, detail } = await productionBuild();
  const sha = body ? text(body.commit) : null;
  const value: EnvironmentIdentities = {
    production: {
      name: "production",
      sha: sha !== null && /^[0-9a-f]{40}$/.test(sha) ? sha : null,
      deployId: body ? text(body.deployId) : null,
      branch: body ? text(body.branch) : null,
      context: body ? text(body.context) : null,
      observedAt,
      source: SOURCE,
      detail,
      reviewState: null,
      reviewStatus: null,
    },
    staging: {
      name: "staging",
      sha: null,
      deployId: null,
      branch: null,
      context: null,
      observedAt,
      source: "not read: staging has no release manifest any more",
      detail: "Staging is no longer reviewed through Admin, so there is no staging build to report.",
      reviewState: null,
      reviewStatus: null,
    },
  };
  memo = { at: nowMs, value };
  return value;
}
