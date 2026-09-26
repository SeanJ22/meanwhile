/** The existing Ask engine, without booting the unrelated Next page server.
 * No alternative acquisition, interpretation, validation or publication path. */
import { randomUUID } from "node:crypto";
import { withResponseLifetime } from "../../lib/log/after-response.ts";

const instance = randomUUID();
let requests = 0;
const moduleStarted = performance.now();
let moduleMs = 0;
// Begin loading once per instance and retain the same engine for every request.
// These boundary timings include work the engine's answer trace cannot see.
const engine = import("../../app/api/ask/grounded/route.ts").then(module => {
  moduleMs = performance.now() - moduleStarted;
  return module;
});

const groundedAsk = async (request: Request, context: { waitUntil(work: Promise<unknown>): void; server?: { region?: string } }): Promise<Response> => {
  const started = performance.now();
  const startedAt = Date.now();
  const processAgeMs = Math.round(process.uptime() * 1000);
  const ordinal = ++requests;
  const { POST } = await engine;
  const response = await withResponseLifetime(work => context.waitUntil(work), () => POST(request));
  response.headers.set("x-wtp-ask-instance", instance);
  response.headers.set("x-wtp-ask-instance-request", String(ordinal));
  response.headers.set("x-wtp-ask-module-ms", String(Math.round(moduleMs)));
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
