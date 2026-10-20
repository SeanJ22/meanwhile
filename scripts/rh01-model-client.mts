import { readFileSync } from "node:fs";
import { ModelRequestNotSent, ModelTransportError, type AnthropicRateLimits, type ModelRequest, type ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";

/** Native parent transports and worker IPC use the same local broker and shared allowance. */
export function diagnosticModelClient(options: { readonly onRateLimits?: (limits: AnthropicRateLimits, request: ModelRequest) => void } = {}): ModelTransport {
  const path = process.env.WTP_RH01_MODEL_BROKER;
  if (!path) throw new ModelRequestNotSent("RH01 diagnostic broker is absent");
  const broker = JSON.parse(readFileSync(path, "utf8")) as { url: string; auth: string };
  if (new URL(broker.url).hostname !== "127.0.0.1") throw new ModelRequestNotSent("RH01 diagnostic broker must be local");
  return async request => {
    const result = await fetch(broker.url, { method: "POST", headers: { "content-type": "application/json", authorization: broker.auth },
      body: JSON.stringify({ phase: process.env.WTP_RH01_MODEL_PHASE, request }) });
    const body = await result.json();
    if (!result.ok) {
      if (body.notSent) throw new ModelRequestNotSent(body.error);
      throw new ModelTransportError(body.error, body.status, body.retryAfterMs);
    }
    if (body.limits) options.onRateLimits?.(body.limits, request);
    return body.response;
  };
}
