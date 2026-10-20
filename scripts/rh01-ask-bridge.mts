/** Native Ask handlers over real scoped civic reads, with local bookkeeping and no provider credential. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installMeasurementNetworkBoundary, withProductionReadOwner } from "./rh01-network.mjs";
import type { ReaderSettingsSnapshot } from "../lib/civic-data/reader-settings-publication.ts";

export interface AskBridgeInput { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: string | null }
export interface AskBridgeReply { readonly status: number; readonly headers: Record<string, string>; readonly body: string }
export interface NativeAskProcess {
  answer(input: AskBridgeInput, ownerHeaders: Readonly<Record<string, string>>): Promise<AskBridgeReply>;
  close(): Promise<void>;
}
const paths = new Set(["/api/ask/grounded", "/api/ask/classify"]);
const code = (file: string) => import(pathToFileURL(join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), file)).href);

/** The child has no production CP connection or paid credential; failed interception can only reach loopback. */
export function startNativeAskBridge(factsUrl: string): NativeAskProcess {
  if (new URL(factsUrl).hostname !== "127.0.0.1") throw Error("RH01 Ask infrastructure requires a loopback coordinator");
  const harness = process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd(), env = { ...process.env };
  const productionControlHost = env.WTP_CONTROL_PLANE_DATABASE_URL ? new URL(env.WTP_CONTROL_PLANE_DATABASE_URL).hostname : null;
  for (const name of Object.keys(env)) if ((productionControlHost && env[name]?.includes(productionControlHost)) ||
      (name !== "SOCRATA_APP_TOKEN" && /TOKEN|WRITE|SECRET|BLOBS|ANTHROPIC|OPENAI|EXA|BRAVE/.test(name))) delete env[name];
  env.WTP_CONTROL_PLANE_DATABASE_URL = "postgresql://wtp_cp_release_readonly:local-only@127.0.0.1:1/rh01";
  env.WTP_RH01_FACTS_URL = factsUrl;
  env.NODE_OPTIONS = `--import=${join(harness, "scripts/rh01-loader.mjs")}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--import", join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), "scripts/register-test-loader.mjs"),
    join(harness, "scripts/rh01-ask-bridge.mts")], { cwd: process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), env, stdio: ["ignore", "pipe", "inherit"] });
  const ready = new Promise<string>((accept, reject) => {
    let buffered = "";
    child.stdout.on("data", chunk => {
      buffered += chunk; const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
      for (const line of lines) if (line.startsWith("RH01_ASK_READY ")) accept(JSON.parse(line.slice(15)).url);
      else process.stderr.write(line + "\n");
    });
    child.once("error", reject); child.once("exit", status => reject(Error(`RH01 native Ask infrastructure exited ${status}`)));
  });
  ready.catch(() => undefined);
  return {
    async answer(input, ownerHeaders) {
      const response = await fetch(await ready, { method: "POST", headers: { "content-type": "application/json", ...ownerHeaders }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "RH01 native Ask request failed");
      return body;
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, "close"); child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2500); force.unref();
      try { await ended; } finally { clearTimeout(force); }
    },
  };
}

/** No input or output is synthesized here: the same native handlers return their full answer/evidence/gap contract. */
export async function answerNativeAsk(input: AskBridgeInput): Promise<AskBridgeReply> {
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) throw Error("RH01 Ask bridge must not possess a model credential");
  const [{ PUBLIC_SITE_ORIGIN }, { markerFromRequest }, { withAskSettings }, { isSameOriginSubmission }, { withResponseLifetime }] = await Promise.all([
    code("lib/ops/origins.ts"), code("lib/db/run-marker.ts"), code("lib/ask/runtime-settings.ts"),
    code("lib/signal/intake-limits.ts"), code("lib/log/after-response.ts"),
  ]);
  const url = new URL(input.url), origin = new URL(process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).origin;
  if (url.origin !== origin || input.method !== "POST" || !paths.has(url.pathname)) throw Error("RH01_ASK_REQUEST_SCOPE_REFUSED");
  const headers = new Headers();
  for (const name of ["content-type", "origin", "host", "x-forwarded-host", "x-forwarded-for", "x-wtp-synthetic-run"])
    if (input.headers[name]) headers.set(name, input.headers[name]);
  const request = new Request(input.url, { method: "POST", headers, body: input.body });
  if (!isSameOriginSubmission(request) || markerFromRequest(request).runClass !== "SYNTHETIC") throw Error("RH01_ASK_REQUEST_ORIGIN_OR_MARKER_REFUSED");
  const response = await fetch(`${origin}/api/reader/settings`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const snapshot = await response.json() as ReaderSettingsSnapshot & { available?: unknown };
  if (!response.ok || snapshot.available !== true || snapshot.formatVersion !== 1 || !Number.isSafeInteger(snapshot.revision) ||
      typeof snapshot.updatedAt !== "string" || !snapshot.values || typeof snapshot.values !== "object") throw Error("RH01_ASK_PUBLISHED_SETTINGS_UNAVAILABLE");
  const { POST } = await code(`app${url.pathname}/route.ts`);
  const pending: Promise<unknown>[] = [];
  try {
    const answered = await withAskSettings(snapshot, () => withResponseLifetime((work: Promise<unknown>) => { pending.push(work); }, () => POST(request))) as Response;
    return { status: answered.status, headers: Object.fromEntries(answered.headers), body: await answered.text() };
  } finally { await Promise.allSettled(pending); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installMeasurementNetworkBoundary();
  const server = createServer((request, response) => withProductionReadOwner({
    ownerPid: Number(request.headers["x-rh01-owner-pid"]) || process.pid,
    jobId: String(request.headers["x-rh01-owner-job"] ?? ""), taskId: String(request.headers["x-rh01-owner-task"] ?? ""),
  }, async () => {
    if (request.method !== "POST" || request.url !== "/ask") { response.writeHead(404).end(); return; }
    try {
      let body = ""; for await (const chunk of request) body += chunk;
      const result = await answerNativeAsk(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "RH01 native Ask failed" }));
    }
  }));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address(); if (!address || typeof address === "string") throw Error("RH01 native Ask address missing");
    console.log("RH01_ASK_READY " + JSON.stringify({ url: `http://127.0.0.1:${address.port}/ask` }));
  });
  process.once("SIGTERM", () => { server.close(() => process.exit(0)); });
}
