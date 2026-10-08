// Read-only access to the production Neon databases over HTTPS, with byte accounting.
// Never prints connection strings. Only SELECT/catalog queries are sent.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire("/home/user/meanwhile/package.json");
const { neon, neonConfig } = require("@neondatabase/serverless");

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const BYTES_LOG = path.join(HERE, "..", "notes", "neon-bytes.log");
fs.mkdirSync(path.dirname(BYTES_LOG), { recursive: true });

let sessionBytes = 0;
const realFetch = globalThis.fetch;
neonConfig.fetchFunction = async (input, init) => {
  const res = await realFetch(input, init);
  const buf = Buffer.from(await res.arrayBuffer());
  sessionBytes += buf.length;
  fs.appendFileSync(BYTES_LOG, `${buf.length}\n`);
  return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
};
export const bytesRead = () => sessionBytes;

const URLS = {
  reader: process.env.WTP_PRODUCTION_DATABASE_URL_READONLY,
  cp: process.env.WTP_CONTROL_PLANE_DATABASE_URL_READONLY,
};
const clients = {};
const READ_ONLY = /^\s*(select|with|show|explain)\b/i;

/** Run one read-only statement. Raw mode returns {fields, rows} with text values. */
export async function q(which, text, params = [], { raw = false } = {}) {
  if (!READ_ONLY.test(text)) throw new Error("refusing non-SELECT statement");
  const url = URLS[which];
  if (!url) throw new Error(`no URL for ${which}`);
  const key = which;
  clients[key] ??= neon(url);
  const sql = clients[key];
  // A read-only transaction wrapper adds a server-side guarantee on top of the role's own privileges.
  const [res] = await sql.transaction([sql.query(text, params, raw
    ? { fullResults: true, arrayMode: true, types: { getTypeParser: () => (v) => v } } : {})], { readOnly: true });
  return res;
}
