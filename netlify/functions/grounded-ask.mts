/** The existing Ask engine, without booting the unrelated Next page server.
 * No alternative acquisition, interpretation, validation or publication path. */
import { randomUUID } from "node:crypto";
import { withResponseLifetime } from "../../lib/log/after-response.ts";
import { preloadNativeAskSources } from "../../lib/ask/native-source-preload.ts";

const instance = randomUUID();
let requests = 0;
const moduleStarted = performance.now();
let moduleMs = 0;
let sourcePreloadMs: number | null = null;
let sourcePreloadState = "PENDING";
// This function instance exists because a real request arrived. Overlap its
// cold edge I/O with engine initialization; no keep-warm request or timer.
// The ordinary route uses the same versioned in-flight cache and rechecks the
// current manifest. Never enter its AsyncLocalStorage authority here.
const sourcePreload = preloadNativeAskSources(() => import("../../lib/meetings/edge-serving.ts"))
  .then(state => { sourcePreloadState = state; })
  .finally(() => { sourcePreloadMs = performance.now() - moduleStarted; });
// Begin loading once per instance and retain the same engine for every request.
// These boundary timings include work the engine's answer trace cannot see.
const engine = Promise.all([
  import("../../app/api/ask/grounded/route.ts"),
  import("../../lib/registry/server.ts"),
]).then(([module, registry]) => {
  moduleMs = performance.now() - moduleStarted;
  return { POST: module.POST, prefetchReaderGeography: registry.prefetchReaderGeography };
});

const groundedAsk = async (request: Request, context: { waitUntil(work: Promise<unknown>): void; server?: { region?: string } }): Promise<Response> => {
  const started = performance.now();
  const startedAt = Date.now();
  const processAgeMs = Math.round(process.uptime() * 1000);
  const ordinal = ++requests;
  context.waitUntil(sourcePreload);
  const { POST, prefetchReaderGeography } = await engine;
  // Start the same file reads used by the Reader beside the first request's
  // manifest/network reads, as /api/meetings and representation already do.
  // This is work for this cold invocation, not a timer or a keep-warm request.
  prefetchReaderGeography();
  const response = await withResponseLifetime(work => context.waitUntil(work), () => POST(request));
  response.headers.set("x-wtp-ask-instance", instance);
  response.headers.set("x-wtp-ask-instance-request", String(ordinal));
  response.headers.set("x-wtp-ask-module-ms", String(Math.round(moduleMs)));
  response.headers.set("x-wtp-ask-source-preload-ms", sourcePreloadMs === null ? "pending" : String(Math.round(sourcePreloadMs)));
  response.headers.set("x-wtp-ask-source-preload-state", sourcePreloadState);
  response.headers.set("x-wtp-ask-handler-ms", String(Math.round(performance.now() - started)));
  response.headers.set("x-wtp-ask-handler-started-at", String(startedAt));
  response.headers.set("x-wtp-ask-process-age-ms", String(processAgeMs));
  if (process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) response.headers.set("x-wtp-ask-memory-mb", process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
  if (context.server?.region) response.headers.set("x-wtp-ask-region", context.server.region);
  return response;
};
export default groundedAsk;

// Cold boundary receipts on 2026-09-26 showed ~2 s of process startup before
// the handler and ~2 s reading/validating held data at the default half vCPU.
// Give this reader endpoint CPU for startup and JSON validation; no keep-warm.
// Netlify bills the configured size; report it as platform compute, not tokens.
export const config = { path: "/api/ask/grounded", method: "POST", memory: 4096 };
