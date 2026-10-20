/** One local model gateway for the explicitly approved, isolated RH-01 exception. */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DiagnosticModelBudget, type DiagnosticPhase, type DiagnosticRole } from "./rh01-model-budget.mts";
import { anthropicTransport, ModelTransportError, type AnthropicRateLimits, type ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const nativeFetch = globalThis.fetch;
enableProductionReadAccounting("model-diagnostic-broker", { subprocess: false, retryReadSql: false });
const authorized = process.argv.includes("--authorized-model-diagnostic");
const descriptor = resolve(option("descriptor") ?? ".scratch/rh01/model-broker.json");
const budgetPath = resolve(option("budget") ?? ".scratch/rh01/model-diagnostic-budget.sqlite");
const budget = new DiagnosticModelBudget(budgetPath), auth = randomBytes(32).toString("hex");
// A key is read only in the explicit diagnostic-send mode, never for preparation.
const key = authorized ? process.env.ANTHROPIC_API_KEY?.trim() : undefined;
if (authorized && !key) throw Error("RH01 diagnostic provider credential is unavailable");
const government = "ocd-division/country:us/state:az/county:pima", board = `${government}#governing`;
function roleFor(request: ModelRequest): DiagnosticRole {
  if (request.tools.some(tool => tool.name === "record_audit")) {
    const content = request.messages[0]?.content;
    if (typeof content !== "string" || JSON.parse(content).subjectId !== board) throw Error("RH01 diagnostic audit escaped its genuine Pima capture");
    return "ADVERSARIAL_AUDITOR";
  }
  if (request.batchContext?.priority?.subjectId === government && request.tools.some(tool => tool.name === "finish")) return "SCOUT";
  throw Error("RH01 diagnostic request is outside the two prepared native roles");
}
const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  try {
    if (request.method !== "POST" || request.url !== "/model" || request.headers.authorization !== auth) throw Error("RH01 local model request refused");
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const part of request) { const chunk = Buffer.from(part); bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) throw Error("RH01 provider request protocol bound exceeded"); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { phase: DiagnosticPhase; request: ModelRequest };
    if (!["before", "after"].includes(body.phase)) throw Error("RH01 diagnostic phase is invalid");
    const role = roleFor(body.request); let limits: AnthropicRateLimits | null = null;
    const transport = budget.transport({ phase: body.phase, role, authorized,
      transport: anthropicTransport(key ?? "", async (url, init) => {
        if (String(url) !== "https://api.anthropic.com/v1/messages" || init?.method !== "POST") throw Error("RH01 provider endpoint refused");
        return nativeFetch(url, init);
      }, undefined, { onRateLimits: value => { limits = value; } }) });
    const result = await transport(body.request);
    response.end(JSON.stringify({ response: result, limits }));
  } catch (error) {
    const status = error instanceof ModelTransportError ? error.status : null;
    response.statusCode = status ?? 403;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error),
      status, retryAfterMs: error instanceof ModelTransportError ? error.retryAfterMs : null,
      notSent: error instanceof Error && error.name === "ModelRequestNotSent" }));
  }
});
await new Promise<void>(accept => server.listen(0, "127.0.0.1", accept));
const address = server.address(); if (!address || typeof address === "string") throw Error("RH01 local broker address missing");
await mkdir(dirname(descriptor), { recursive: true });
await writeFile(descriptor, JSON.stringify({ url: `http://127.0.0.1:${address.port}/model`, auth, budgetPath, authorized,
  limits: budget.snapshot().limits }, null, 2) + "\n", { mode: 0o600 });
console.log(`RH01_MODEL_BROKER ${JSON.stringify({ descriptor, budgetPath, authorized, limits: budget.snapshot().limits })}`);
const stop = () => server.close(() => { console.log(`RH01_MODEL_SPEND ${JSON.stringify(budget.snapshot())}`); budget.close(); });
process.once("SIGTERM", stop); process.once("SIGINT", stop);
