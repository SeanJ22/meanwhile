/** Read-only network boundary for measurement processes, inherited by their Node children. */
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import http from "node:http";
import https from "node:https";
import subprocess from "node:child_process";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { promisify } from "node:util";
import { sqlStatementCode } from "./rh01-sql.mts";

const productionReadOwner = new AsyncLocalStorage();
export const withProductionReadOwner = (owner, work) => productionReadOwner.run(owner, work);
export const currentProductionReadOwner = () => productionReadOwner.getStore();

const blockedHosts = /(?:^|\.)(?:anthropic\.com|openai\.com|exa\.ai|brave\.com|openrouter\.ai|generativelanguage\.googleapis\.com)$/i;
const sourcePosts = new Set();
const sourceRoot = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
const inventory = JSON.parse(readFileSync(join(sourceRoot, "data/campaign-finance/sources.json"), "utf8"));
function collect(value) {
  if (!value || typeof value !== "object") return;
  if (value.url && (value.method === "POST" || value.postback || value.selectParameter)) {
    const url = new URL(value.url); sourcePosts.add(url.origin + url.pathname);
  }
  for (const child of Object.values(value)) if (typeof child === "object") collect(child);
}
collect(inventory);
const databaseHosts = new Set([process.env.WTP_PRODUCTION_DATABASE_URL_READONLY, process.env.WTP_CONTROL_PLANE_DATABASE_URL].filter(Boolean).flatMap(value => {
  const url = new URL(value), role = decodeURIComponent(url.username);
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return [];
  return role === "readonly" || role === "wtp_cp_release_readonly" ? [url.hostname, url.hostname.replace(/^[^.]+\./, "api.")] : [];
}));
const readerHost = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY
  ? new URL(process.env.WTP_PRODUCTION_DATABASE_URL_READONLY).hostname : null;
const controlHost = process.env.WTP_CONTROL_PLANE_DATABASE_URL
  ? new URL(process.env.WTP_CONTROL_PLANE_DATABASE_URL).hostname : null;
const localHost = hostname => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);

/** Refuse raw whole-table/cursor-only hydration; needed exact rows and narrow scalar/page projections remain available. */
export function assertNeededProductionRead(text) {
  const structure = sqlStatementCode(text)
    .replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "");
  if (!/^\s*(?:SELECT|WITH)\b/i.test(structure) || /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|CREATE|ALTER|DROP|TRUNCATE|pg_notify|nextval|setval|pg_advisory_lock|pg_try_advisory_lock|cp_admit_spend_hold)\b/i.test(structure))
    throw Error("RH01_UNSUPPORTED_PRODUCTION_READ: only read SQL may reach production");
  for (const match of text.matchAll(/\bSELECT\b([\s\S]*?)\bFROM\s+(?:public[.])?"?((?:cp_|civic_data_)[a-z_0-9]+|fact|entity|entity_host|entity_place|entity_external_id|source_copy)\b/gi)) {
    if (!/(?:^|,)\s*(?:[a-z_][a-z_0-9]*[.])?(?:\*|value|record|payload|candidate)\s*(?:AS\s+[a-z_][a-z_0-9]*)?\s*(?:,|$)/i.test(match[1])) continue;
    const suffix = text.slice(match.index + match[0].length);
    const predicate = /\bWHERE\b([\s\S]*?)(?=\bORDER\s+BY\b|\bGROUP\s+BY\b|\bLIMIT\b|\bOFFSET\b|;|$)/i.exec(suffix)?.[1];
    const scopedIdentity = predicate && /\b(?:log_key|record_id|id)\s*=\s*\$\d+/i.test(predicate);
    const cursorOnly = predicate && !scopedIdentity && /[<>]/.test(predicate) &&
      predicate.replace(/\$\d+|\b(?:AND|OR|id|log_key|record_id|position|changed_at|updated_at)\b|[\s"().,><=:]/gi, "") === "";
    if (!predicate || cursorOnly || /^\s*(?:TRUE|1\s*=\s*1)\s*$/i.test(predicate))
      throw Error(`RH01_UNSUPPORTED_PRODUCTION_READ: ${match[2]} whole rows require exact job scope; raw whole-table or cursor-only hydration is prohibited`);
  }
}

export function enableProductionReadAccounting(phase = "preparation", options = {}) {
  process.env.WTP_RH01_PRODUCTION_READ_LEDGER ??= join(process.cwd(), ".scratch/rh01/production-read-bytes.jsonl");
  process.env.WTP_RH01_PHASE = phase;
  process.env.WTP_RH01_RUN_ID ??= randomUUID();
  mkdirSync(dirname(process.env.WTP_RH01_PRODUCTION_READ_LEDGER), { recursive: true });
  installMeasurementNetworkBoundary(options);
}

/** Count the one consumed HTTP body stream; no response copy or database values are retained. */
function responseDatabase(url, headers) {
  const hostname = new URL(url).hostname;
  if (localHost(hostname)) return null;
  if (hostname === readerHost) return "reader";
  if (hostname === controlHost) return "control-plane";
  // Neon sends HTTP queries to a regional API hostname shared by both databases.
  // Its connection header supplies the exact checked read-only database identity.
  const connection = new Headers(headers).get("neon-connection-string");
  if (!connection) return null;
  let target;
  try { target = new URL(connection); } catch { return null; }
  if (hostname !== target.hostname.replace(/^[^.]+\./, "api.")) return null;
  const role = decodeURIComponent(target.username);
  if (target.hostname === readerHost && role === "readonly") return "reader";
  if (target.hostname === controlHost && role === "wtp_cp_release_readonly") return "control-plane";
  return null;
}

function recordDatabaseBytes(database, requestId, bytes, transport, status, owner) {
  const ledger = process.env.WTP_RH01_PRODUCTION_READ_LEDGER;
  if (!ledger || !database || !bytes) return;
  appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), requestId, pid: process.pid,
    phase: process.env.WTP_RH01_PHASE ?? "preparation", runId: process.env.WTP_RH01_RUN_ID ?? null, database, bytes,
    ownerPid: owner?.ownerPid ?? process.pid,
    jobId: owner?.jobId ?? (process.env.WTP_RUNTIME_AUTHORITY_CONTRACT || process.env.WTP_RH01_JOB_ID || null),
    ownerTaskId: owner?.taskId ?? process.env.WTP_RH01_WORKER_TASK_ID ?? null, transport, status }) + "\n");
}

function accountDatabaseResponse(response, url, headers) {
  const ledger = process.env.WTP_RH01_PRODUCTION_READ_LEDGER;
  const database = responseDatabase(url, headers);
  if (!ledger || !database || !response.body) return response;
  const requestId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = productionReadOwner.getStore();
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      recordDatabaseBytes(database, requestId, chunk.byteLength, "http-body", response.status, owner);
      controller.enqueue(chunk);
    },
  }));
  const measured = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  for (const key of ["url", "redirected", "type"]) Object.defineProperty(measured, key, { value: response[key] });
  return measured;
}

export function allowedMeasurementRequest(input, method = "GET") {
  let url;
  try { url = new URL(input); } catch { return false; }
  if (localHost(url.hostname)) return true;
  if (blockedHosts.test(url.hostname) || /^\/api\/(?:ask|agent|ai)(?:\/|$)/i.test(url.pathname)) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  if (method.toUpperCase() !== "POST") return false;
  // Every database connection in this process was checked for SELECT and absence of table write grants.
  if (databaseHosts.has(url.hostname)) return true;
  // Query-form POSTs are taken from the checked-in source definitions, by exact origin and path.
  return sourcePosts.has(url.origin + url.pathname) || /\/(?:MapServer|FeatureServer)\/\d+\/query\/?$/i.test(url.pathname) ||
    // The public calendar uses ASP.NET postbacks to select a date range and read the next results page.
    /(?:^|\.)legistar\.com$/i.test(url.hostname) && /^\/Calendar[.]aspx$/i.test(url.pathname);
}
const refused = (url, method) => {
  const target = new URL(url);
  return Error(`RH01_REMOTE_WRITE_BLOCKED:${method}:${target.origin}${target.pathname}`);
};

export function installMeasurementNetworkBoundary(options = {}) {
  const marker = Symbol.for("meanwhile.rh01.network");
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!allowedMeasurementRequest(url, method)) throw refused(url, method);
    let queryRead = false;
    if (databaseHosts.has(new URL(url).hostname) && typeof init?.body === "string") {
      const body = JSON.parse(init.body), queries = body.queries ?? [body];
      for (const query of queries) assertNeededProductionRead(String(query.query));
      try {
        queryRead = queries.length > 0 && queries.every(query => {
          const code = sqlStatementCode(query.query).replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "");
          return /^\s*(SELECT|WITH)\b/i.test(code) && !/\b(INSERT|UPDATE|DELETE|MERGE|CALL)\b/i.test(code);
        });
      } catch { /* Only recognized read-only SQL is retried. */ }
    }
    if (queryRead && options.retryReadSql !== false) {
      // The managed proxy occasionally returns a stale tunnel failure; discard that connection and repeat only SELECT.
      const headers = new Headers(init?.headers); headers.set("connection", "close");
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = accountDatabaseResponse(await originalFetch(input, { ...init, headers }), url, headers);
        if (attempt === 3 || response.status !== 503) return response;
        const detail = await response.clone().text();
        if (!/cloudflare_https_tunnel|upstream connect error|remote connection failure/i.test(detail)) return response;
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
    return accountDatabaseResponse(await originalFetch(input, init), url, init?.headers ?? (input instanceof Request ? input.headers : undefined));
  };
  const Socket = globalThis.WebSocket;
  if (Socket) globalThis.WebSocket = class MeasuredWebSocket extends Socket {
    constructor(url, protocols) {
      if (!allowedMeasurementRequest(String(url), "GET")) throw refused(String(url), "GET");
      super(url, protocols);
      const database = responseDatabase(url);
      if (!database) return;
      const requestId = `${process.pid}-socket-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const owner = productionReadOwner.getStore();
      this.addEventListener("message", event => {
        const data = event.data;
        const bytes = typeof data === "string" ? Buffer.byteLength(data)
          : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength : data instanceof Blob ? data.size : 0;
        recordDatabaseBytes(database, requestId, bytes, "websocket-message", null, owner);
      });
    }
  };
  for (const [native, protocol] of [[http, "http:"], [https, "https:"]]) {
    for (const methodName of ["request", "get"]) {
      const original = native[methodName];
      native[methodName] = function (...args) {
        const first = args[0], options = typeof first === "string" || first instanceof URL ? args[1] ?? {} : first;
        const url = typeof first === "string" || first instanceof URL ? String(first)
          : `${options.protocol ?? protocol}//${options.hostname ?? options.host ?? "localhost"}${options.path ?? "/"}`;
        const method = options.method ?? "GET";
        if (!allowedMeasurementRequest(url, method)) throw refused(url, method);
        return Reflect.apply(original, this, args);
      };
    }
  }
  if (options.subprocess !== false) for (const methodName of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
    const original = subprocess[methodName];
    const check = (file, args) => {
      const command = basename(String(file)).replace(/\.exe$/i, ""), words = Array.isArray(args[0]) ? args[0].map(String) : [];
      if (command === "gh" && !["view", "list", "status", "checks", "diff"].includes(words[1] ?? "") ||
          command === "git" && ["push", "send-email", "request-pull"].includes(words[0] ?? "") ||
          ["sh", "bash", "zsh", "powershell", "pwsh", "cmd", "ssh", "scp", "sftp"].includes(command) ||
          ["curl", "wget"].includes(command) && words.some((word, index) => /^(-d|--data|--post|--upload)/.test(word) ||
            /^(?:-X|--request)$/.test(word) && !["GET", "HEAD"].includes(words[index + 1]) || /^--request=(?!GET|HEAD)/.test(word))) {
        throw Error(`RH01_REMOTE_COMMAND_BLOCKED:${command}`);
      }
    };
    const guarded = function (file, ...args) {
      check(file, args);
      return Reflect.apply(original, this, [file, ...args]);
    };
    // execFile's native promisifier preserves {stdout, stderr}, error output,
    // and promise.child. Guard that entry point before its native closure runs.
    const nativePromisified = original[promisify.custom];
    if (typeof nativePromisified === "function") Object.defineProperty(guarded, promisify.custom, {
      value: function (file, ...args) {
        check(file, args);
        return Reflect.apply(nativePromisified, this, [file, ...args]);
      }, configurable: true,
    });
    subprocess[methodName] = guarded;
  }
  if (options.subprocess !== false) for (const methodName of ["exec", "execSync"]) subprocess[methodName] = () => { throw Error("RH01_REMOTE_COMMAND_BLOCKED:shell"); };
  syncBuiltinESMExports();
}
