// Copy control-plane tables from production into the local copy, reading heap pages by ctid range.
// A TID range scan needs no sort and no temporary disk. Source reads are SELECT only (neonsrc.mjs).
import { createRequire } from "node:module";
import { q, bytesRead } from "./neonsrc.mjs";

const require = createRequire(new URL("../package.json", import.meta.url));
const pg = require("pg");
const local = new pg.Pool({ host: "127.0.0.1", port: 54329, user: "postgres", database: "controlplane", max: 4 });

const SKIP = new Set((process.env.EXCLUDE ?? "").split(",").filter(Boolean));
const TARGET_BYTES = 3_000_000;
const PIECE_CHARS = 2_000_000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function insertRows(table, jsonRows) {
  if (!jsonRows.length) return;
  const client = await local.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(`INSERT INTO public.${table} SELECT * FROM json_populate_recordset(null::public.${table}, $1::json)`, [`[${jsonRows.join(",")}]`]);
  } finally { client.release(); }
}

async function rowsIn(table, from, to) {
  const res = await q("cp", `SELECT row_to_json(t)::text FROM public.${table} t WHERE ctid >= $1::tid AND ctid < $2::tid`, [`(${from},0)`, `(${to},0)`], { raw: true });
  return res.rows.map((r) => r[0]);
}

/** One page whose rows are too large to read together: each row, each column in pieces. */
async function rowsOfPage(table, page, columns) {
  const tids = (await q("cp", `SELECT ctid::text FROM public.${table} WHERE ctid >= $1::tid AND ctid < $2::tid`, [`(${page},0)`, `(${page + 1},0)`], { raw: true })).rows.map((r) => r[0]);
  const out = [];
  for (const tid of tids) {
    const row = {};
    for (const col of columns) {
      const len = Number((await q("cp", `SELECT coalesce(char_length(to_json(t."${col}")::text), 0) FROM public.${table} t WHERE ctid = $1::tid`, [tid], { raw: true })).rows[0][0]);
      let text = "";
      for (let start = 1; start <= len; start += PIECE_CHARS) {
        text += (await q("cp", `SELECT substr(to_json(t."${col}")::text, $2, $3) FROM public.${table} t WHERE ctid = $1::tid`, [tid, start, PIECE_CHARS], { raw: true })).rows[0][0];
      }
      row[col] = len === 0 ? null : JSON.parse(text);
    }
    out.push(JSON.stringify(row));
  }
  return out;
}

async function copyRange(table, from, to, columns) {
  try {
    return await rowsIn(table, from, to);
  } catch (error) {
    if (to - from > 1) {
      const mid = Math.floor((from + to) / 2);
      return [...await copyRange(table, from, mid, columns), ...await copyRange(table, mid, to, columns)];
    }
    log(`  ${table} page ${from}: read in pieces (${String(error.message).slice(0, 80)})`);
    return rowsOfPage(table, from, columns);
  }
}

const tables = (await q("cp", `SELECT c.relname, (pg_relation_size(c.oid) / 8192)::int AS pages, pg_total_relation_size(c.oid)::bigint AS bytes
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY c.relname`, [], { raw: true })).rows
  .map(([name, pages, bytes]) => ({ name, pages: Number(pages), bytes: Number(bytes) })).filter((t) => !SKIP.has(t.name));

const report = [];
for (const t of tables) {
  const columns = (await q("cp", `SELECT a.attname FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [`public.${t.name}`], { raw: true })).rows.map((r) => r[0]);
  { const c = await local.connect(); try { await c.query("SET session_replication_role = replica"); await c.query(`DELETE FROM public.${t.name}`); } finally { c.release(); } }
  const step = Math.max(1, Math.floor(TARGET_BYTES / Math.max(1, t.bytes / Math.max(1, t.pages))));
  let copied = 0;
  for (let from = 0; from < t.pages; from += step) {
    const rows = await copyRange(t.name, from, Math.min(t.pages, from + step), columns);
    await insertRows(t.name, rows);
    copied += rows.length;
  }
  const source = Number((await q("cp", `SELECT count(*) FROM public.${t.name}`, [], { raw: true })).rows[0][0]);
  const localCount = Number((await local.query(`SELECT count(*) FROM public.${t.name}`)).rows[0].count);
  report.push({ table: t.name, source, local: localCount, match: source === localCount });
  log(`${t.name}: ${localCount} of ${source}${source === localCount ? "" : "  MISMATCH"} · ${(bytesRead() / 1e6).toFixed(1)} MB read so far`);
}
console.log(JSON.stringify({ tables: report.length, mismatches: report.filter((r) => !r.match), megabytesRead: +(bytesRead() / 1e6).toFixed(1) }));
await local.end();
