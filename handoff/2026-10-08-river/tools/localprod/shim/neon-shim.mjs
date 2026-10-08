// Local stand-in for Neon's serverless endpoints, backed by the local Postgres copy.
//   POST /sql            Neon HTTP SQL protocol (what neon() sends), routed by the database in Neon-Connection-String
//   WS   /v2?address=... Neon wsproxy protocol (what Pool/Client send): raw Postgres wire bytes over a WebSocket
//   GET  /stats          request counters by database (proof that callers reached the local copy)
// Env: LOCALPROD_SHIM_PORT (54330), LOCALPROD_PG_PORT (54329), LOCALPROD_SHIM_LOG (file for one line per request).
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.LOCALPROD_SHIM_PORT ?? 54330);
const PG_PORT = Number(process.env.LOCALPROD_PG_PORT ?? 54329);
const LOG = process.env.LOCALPROD_SHIM_LOG;
const stats = { startedAt: new Date().toISOString(), http: {}, ws: {}, errors: 0 };
const logLine = (o) => { if (LOG) fs.appendFile(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n", () => {}); };

// Every value comes back as the server's text, exactly like Neon-Raw-Text-Output: true.
const rawTypes = { getTypeParser: () => (v) => v };
const pools = new Map();
function poolFor(conn) {
  const u = new URL(conn);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(u.username), password = decodeURIComponent(u.password);
  const key = `${user}\u0000${password}\u0000${database}`;
  if (!pools.has(key)) {
    const pool = new pg.Pool({ host: "127.0.0.1", port: PG_PORT, user, password, database, max: 40, idleTimeoutMillis: 30_000 });
    pool.on("error", () => {});
    pools.set(key, pool);
  }
  return { pool: pools.get(key), database, user };
}

const ISOLATION = { ReadUncommitted: "READ UNCOMMITTED", ReadCommitted: "READ COMMITTED", RepeatableRead: "REPEATABLE READ", Serializable: "SERIALIZABLE" };
const ERROR_FIELDS = ["severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery", "where", "schema", "table", "column", "dataType", "constraint", "file", "line", "routine"];

function shape(res, arrayMode) {
  const fields = (res.fields ?? []).map((f) => ({ name: f.name, tableID: f.tableID, columnID: f.columnID, dataTypeID: f.dataTypeID,
    dataTypeSize: f.dataTypeSize, dataTypeModifier: f.dataTypeModifier, format: "text" }));
  const rows = arrayMode ? res.rows : res.rows.map((r) => Object.fromEntries(fields.map((f, i) => [f.name, r[i]])));
  return { command: res.command ?? "", rowCount: res.rowCount ?? null, rows, fields, rowAsArray: arrayMode };
}

async function run(client, q, arrayMode) {
  const res = await client.query({ text: q.query, values: q.params ?? [], rowMode: "array", types: rawTypes, queryMode: "extended" });
  return shape(res, arrayMode);
}

async function handleSql(req, res, body) {
  const t0 = Date.now();
  const conn = req.headers["neon-connection-string"];
  const arrayMode = req.headers["neon-array-mode"] === "true";
  let info, client, summary = "", kind = "query", rowsOut = 0;
  try {
    if (!conn) throw Object.assign(new Error("missing Neon-Connection-String header"), { status: 400 });
    info = poolFor(conn);
    const payload = JSON.parse(body);
    client = await info.pool.connect();
    let out;
    if (Array.isArray(payload.queries)) {
      kind = "batch";
      summary = payload.queries.map((q) => q.query.replace(/\s+/g, " ").slice(0, 60)).join(" | ").slice(0, 200);
      const iso = ISOLATION[req.headers["neon-batch-isolation-level"]];
      const ro = req.headers["neon-batch-read-only"] === "true";
      const def = req.headers["neon-batch-deferrable"] === "true";
      await client.query(`BEGIN${iso ? ` ISOLATION LEVEL ${iso}` : ""}${ro ? " READ ONLY" : ""}${def ? " DEFERRABLE" : ""}`);
      try {
        const results = [];
        for (const q of payload.queries) results.push(await run(client, q, arrayMode));
        await client.query("COMMIT");
        out = { results };
        rowsOut = results.reduce((a, r) => a + r.rows.length, 0);
      } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    } else {
      summary = String(payload.query).replace(/\s+/g, " ").slice(0, 200);
      out = await run(client, payload, arrayMode);
      rowsOut = out.rows.length;
    }
    const json = JSON.stringify(out);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
    res.end(json);
    const s = (stats.http[info.database] ??= { requests: 0, rows: 0, bytes: 0 });
    s.requests++; s.rows += rowsOut; s.bytes += Buffer.byteLength(json);
    logLine({ via: "http", db: info.database, user: info.user, kind, ms: Date.now() - t0, rows: rowsOut, bytes: Buffer.byteLength(json), q: summary });
  } catch (e) {
    stats.errors++;
    const status = e.status ?? (e.code || e instanceof SyntaxError ? 400 : 500);
    const err = { message: e.message };
    for (const f of ERROR_FIELDS) if (e[f] !== undefined) err[f] = e[f];
    const json = JSON.stringify(err);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(json);
    logLine({ via: "http", db: info?.database, user: info?.user, kind, ms: Date.now() - t0, error: e.message, code: e.code, q: summary });
  } finally {
    if (client) {
      // Neon's HTTP queries share no session: drop session state (SETs, advisory locks, prepared statements).
      await client.query("DISCARD ALL").catch(() => {});
      client.release();
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/stats")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(stats, null, 1));
  }
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200); return res.end("ok"); }
  if (req.method !== "POST" || !req.url.startsWith("/sql")) { res.writeHead(404); return res.end("not found"); }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => handleSql(req, res, Buffer.concat(chunks).toString("utf8")));
});

// Neon wsproxy: ws://host/v2?address=<host>:<port>. Every address goes to the local cluster.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/v2")) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const address = new URL(req.url, "http://x").searchParams.get("address") ?? "";
    const tcp = net.connect(PG_PORT, "127.0.0.1");
    tcp.setNoDelay(true);
    const id = Math.random().toString(36).slice(2, 8);
    stats.ws.connections = (stats.ws.connections ?? 0) + 1;
    logLine({ via: "ws", event: "open", id, address });
    const pending = [];
    let open = false;
    tcp.on("connect", () => { open = true; for (const p of pending) tcp.write(p); pending.length = 0; });
    ws.on("message", (data) => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); open ? tcp.write(b) : pending.push(b); });
    tcp.on("data", (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
    const close = (why) => { tcp.destroy(); if (ws.readyState === ws.OPEN) ws.close(); logLine({ via: "ws", event: "close", id, why }); };
    ws.on("close", () => close("client"));
    ws.on("error", () => close("ws-error"));
    tcp.on("close", () => close("pg"));
    tcp.on("error", () => close("pg-error"));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`neon-shim listening on 127.0.0.1:${PORT} -> postgres 127.0.0.1:${PG_PORT}`));
