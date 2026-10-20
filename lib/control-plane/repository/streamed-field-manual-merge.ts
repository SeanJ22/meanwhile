import { createHash } from "node:crypto";
import type { FieldManualEntry } from "../field-manual.ts";
import { mergePlaceResults, placeResultsOf, type PlaceResult } from "../field-manual-places.ts";
import { withHistoryIndex } from "../workers/streamed-history.ts";
import { JsonFileCursor, jsonWatchKey, type JsonSink, type JsonScan } from "./json-file-stream.ts";

/** Merge a held method without loading its national reach, per-place observations or opaque payload. */
export async function withStreamedFieldManualMerge<T>(source: string, entry: FieldManualEntry,
  use: (write: (out: JsonSink) => Promise<void>, changed: boolean) => Promise<T>): Promise<T> {
  return withHistoryIndex(async db => {
    db.exec("CREATE TABLE members(kind TEXT NOT NULL,key TEXT NOT NULL,sort TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,key)); CREATE INDEX ordered_members ON members(kind,sort,seq); CREATE TABLE explicit(seq INTEGER PRIMARY KEY,place TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE results(place TEXT PRIMARY KEY,body TEXT NOT NULL)");
    let sequence = 0;
    const explicitPut = db.prepare("INSERT INTO explicit VALUES(?,?,?)");
    const put = db.prepare("INSERT OR IGNORE INTO members VALUES(?,?,?,?,?)"), resultAt = db.prepare("SELECT body FROM results WHERE place=?"), resultPut = db.prepare("INSERT INTO results VALUES(?,?) ON CONFLICT(place) DO UPDATE SET body=excluded.body");
    const add = (kind: string, value: unknown, lower = false) => {
      const normalized = lower ? (value as string).trim().toLowerCase() : value;
      if (lower && normalized === "") return;
      const seq = sequence++, key = normalized !== null && typeof normalized === "object" ? `object:${seq}` : `${typeof normalized}:${String(normalized)}`;
      put.run(kind, key, String(normalized), seq, JSON.stringify(normalized));
    };
    const values = function* (kind: string): Iterable<unknown> { for (const row of db.prepare("SELECT body FROM members WHERE kind=? ORDER BY sort,seq").iterate(kind)) yield JSON.parse(row.body); };
    const count = (kind: string) => Number(db.prepare("SELECT count(*) AS n FROM members WHERE kind=?").get(kind)?.n ?? 0);
    const mergeResult = (next: PlaceResult) => { const held = resultAt.get(next.place); resultPut.run(next.place, JSON.stringify(held ? mergePlaceResults([JSON.parse(held.body) as PlaceResult], [next])[0] : next)); };
    const meta: Record<string, unknown> = {};
    let hasResults = false;
    const scalarPaths = ["kind", "observedAt", "outcome", "url", "portable", "foundBy", "placeResultsPartial"].map(key => ["value", key]);
    scalarPaths.push(["value", "reach", "everywhere"], ["value", "reach", "method"]);
    const watch = new Map(scalarPaths.map(path => [jsonWatchKey(path), (value: unknown) => { meta[path.slice(1).join(".")] = value; }]));
    const arrays: NonNullable<JsonScan["arrays"]> = async (path, cursor, out) => {
      if (path[0] !== "value") return false;
      const top = path.length === 2 && ["states", "recordClasses", "platforms", "ocdIds", "bodyIds"].includes(path[1]) ? path[1] : null;
      const reach = path.length === 3 && path[1] === "reach" && ["places", "states", "platforms"].includes(path[2]) ? path[2] : null;
      const payload = path.length === 3 && path[1] === "payload" && ["places", "doorEntryIds", "fieldNames"].includes(path[2]) ? path[2] : null;
      const results = path.length === 2 && path[1] === "placeResults";
      if (!top && !reach && !payload && !results) return false;
      if (results) hasResults = true;
      await cursor.array(async () => {
        const parts: string[] = [];
        await cursor.value(async part => { parts.push(part); await out?.(part); });
        const value: unknown = JSON.parse(parts.join(""));
        if (top) { add(`old:${top}`, value); add(top, value, top !== "bodyIds"); }
        if (reach) add(`reach:${reach}`, value, reach !== "places");
        if (payload) add(`payload:${payload}`, value);
        if (results) { const row = value as PlaceResult; explicitPut.run(sequence++, row.place, JSON.stringify(row)); }
      }, out);
      return true;
    };
    const originalHash = createHash("sha256"), cursor = new JsonFileCursor(source);
    try {
      await cursor.value(undefined, undefined, [], { objects: async (path, input) => {
        if (path.length !== 1 || path[0] !== "value") return false;
        await input.value(part => { originalHash.update(part); }, undefined, ["value"], { arrays, watch }); return true;
      } });
      await cursor.finish();
    } finally { await cursor.close(); }
    const priorHash = originalHash.digest("hex"), newerWins = (entry.observedAt ?? "") >= (typeof meta.observedAt === "string" ? meta.observedAt : "");
    const priorAnyClass = count("old:recordClasses") === 0;
    for (const field of ["states", "recordClasses", "platforms", "ocdIds", "bodyIds"] as const) for (const value of entry[field] ?? []) add(field, value, field !== "bodyIds");
    const specific = count("old:ocdIds") + count("old:bodyIds") > 0;
    const implicit = function* (): Iterable<PlaceResult> {
      const result = (place: string): PlaceResult => ({ place, outcome: meta.outcome as PlaceResult["outcome"], observedAt: meta.observedAt as string | null });
      if (specific) { for (const place of values("old:ocdIds")) yield result(String(place)); for (const body of values("old:bodyIds")) yield result(`body:${String(body)}`); }
      else if (count("old:states")) for (const state of values("old:states")) yield result(`state:${String(state)}`);
      else yield result("any");
    };
    if (!hasResults || meta.placeResultsPartial === true) for (const result of implicit()) resultPut.run(result.place, JSON.stringify(result));
    for (const row of db.prepare("SELECT body FROM explicit ORDER BY seq").iterate()) {
      const result = JSON.parse(row.body) as PlaceResult;
      if (meta.placeResultsPartial === true) mergeResult(result); else resultPut.run(result.place, row.body);
    }
    for (const next of placeResultsOf(entry)) mergeResult(next);
    if (specific) {
      for (const value of values("old:ocdIds")) add("reach:places", value);
      for (const value of values("old:bodyIds")) add("reach:places", `body:${String(value)}`);
      if (meta.url === null) for (const value of values("old:platforms")) add("reach:platforms", value, true);
    } else {
      const field = count("old:platforms") ? "platforms" : "states";
      for (const value of values(`old:${field}`)) add(`reach:${field}`, value, true);
    }
    for (const field of ["places", "states", "platforms"] as const) for (const value of entry.reach?.[field] ?? []) add(`reach:${field}`, value, field !== "places");
    const payloadFields = meta.kind === "METHOD" && entry.kind === "METHOD" ? ["places", "doorEntryIds"] : meta.kind === "PARSE_FIELDS" && entry.kind === "PARSE_FIELDS" ? ["fieldNames"] : [];
    const incomingPayload = entry.payload !== null && typeof entry.payload === "object" ? entry.payload as Record<string, unknown> : {};
    for (const field of payloadFields) for (const value of Array.isArray(incomingPayload[field]) ? incomingPayload[field] : []) add(`payload:${field}`, value);
    const writeArray = async (kind: string, out: JsonSink) => { await out("["); let n = 0; for (const value of values(kind)) { if (n++) await out(","); await out(JSON.stringify(value)); } await out("]"); };
    const writeResults = async (out: JsonSink) => { await out("["); let n = 0; for (const row of db.prepare("SELECT body FROM results ORDER BY place").iterate()) { if (n++) await out(","); await out(row.body); } await out("]"); };
    const writeReach = async (out: JsonSink) => {
      await out('{"places":'); await writeArray("reach:places", out); await out(',"states":'); await writeArray("reach:states", out); await out(',"platforms":'); await writeArray("reach:platforms", out);
      await out(`,"everywhere":${meta["reach.everywhere"] === true || meta.portable === true || entry.reach?.everywhere === true}`);
      if (meta["reach.method"] === true || entry.reach?.method === true) await out(',"method":true'); await out("}");
    };
    const writePayload = async (out: JsonSink, held?: JsonFileCursor) => {
      if (!payloadFields.length) { if (held) await held.value(out); else await out(JSON.stringify(entry.payload)); return; }
      let n = 0;
      await out("{");
      const key = async (name: string) => { if (n++) await out(","); await out(JSON.stringify(name) + ":"); };
      if (held) {
        const kind = await held.peek();
        if (kind === "{") await held.object(async name => { if (payloadFields.includes(name)) await held.value(); else { await key(name); await held.value(out); } });
        else if (kind === "[") await held.array(async index => { await key(String(index)); await held.value(out); });
        else if (kind === '"') {
          // Object spread on a string retains its UTF-16 indexed characters; decode one escape at a time.
          let first = true, escaped = false, unicode = "", remaining = 0, index = 0;
          const character = async (value: string) => { await key(String(index++)); await out(JSON.stringify(value)); };
          await held.value(async part => {
            for (let n = 0; n < part.length; n++) {
              const char = part[n];
              if (first) { first = false; continue; }
              if (remaining) { unicode += char; if (--remaining === 0) await character(String.fromCharCode(parseInt(unicode, 16))); continue; }
              if (escaped) { escaped = false; if (char === "u") { unicode = ""; remaining = 4; } else await character(JSON.parse('"\\' + char + '"') as string); continue; }
              if (char === "\\") { escaped = true; continue; }
              if (char !== '"') await character(char);
            }
          });
        } else await held.value();
      } else if (typeof entry.payload === "string") {
        for (let n = 0; n < entry.payload.length; n++) { await key(String(n)); await out(JSON.stringify(entry.payload[n])); }
      } else for (const [name, value] of Object.entries(incomingPayload)) if (!payloadFields.includes(name)) { await key(name); await out(JSON.stringify(value)); }
      for (const field of payloadFields) { await key(field); await writeArray(`payload:${field}`, out); }
      await out("}");
    };
    const override = async (name: string, out: JsonSink, held?: JsonFileCursor): Promise<boolean> => {
      if (["states", "recordClasses", "platforms"].includes(name) || name === "ocdIds" && count("ocdIds") > 0 || name === "bodyIds" && count("bodyIds") > 0) {
        if (held) await held.value();
        if (name === "recordClasses" && (priorAnyClass || entry.recordClasses.length === 0)) await out("[]"); else await writeArray(name, out); return true;
      }
      if (name === "reach") { if (held) await held.value(); await writeReach(out); return true; }
      if (name === "placeResults") { if (held) await held.value(); await writeResults(out); return true; }
      if (name === "payload") { await writePayload(out, held); return true; }
      if (name === "portable" && (meta.portable === true || entry.portable === true)) { if (held) await held.value(); await out("true"); return true; }
      if (name === "foundBy") { if (held) await held.value(); const value = meta.foundBy ?? entry.foundBy; if (value !== undefined) await out(JSON.stringify(value)); return true; }
      return false;
    };
    const overrideKeys = ["states", "recordClasses", "platforms", "ocdIds", "bodyIds", "portable", "reach", "placeResults", "foundBy", "payload"];
    const write = async (out: JsonSink) => {
      const seen = new Set<string>(); let n = 0;
      await out("{");
      const key = async (name: string) => { if (overrideKeys.includes(name)) seen.add(name); if (n++) await out(","); await out(JSON.stringify(name) + ":"); };
      if (newerWins) {
        for (const [name, value] of Object.entries(entry)) {
          if (value === undefined) continue;
          if (name === "foundBy" && (meta.foundBy ?? entry.foundBy) === undefined) continue;
          await key(name); if (!await override(name, out)) await out(JSON.stringify(value));
        }
      } else {
        const previous = new JsonFileCursor(source);
        try {
          await previous.value(undefined, undefined, [], { objects: async (path, input) => {
            if (path.length !== 1 || path[0] !== "value") return false;
            await input.object(async name => {
              if (name === "foundBy" && (meta.foundBy ?? entry.foundBy) === undefined) { await input.value(); return; }
              await key(name); if (!await override(name, out, input)) await input.value(out);
            }); return true;
          } }); await previous.finish();
        } finally { await previous.close(); }
      }
      for (const name of overrideKeys) {
        if (seen.has(name) || name === "ocdIds" && !count("ocdIds") || name === "bodyIds" && !count("bodyIds") || name === "portable" && meta.portable !== true && entry.portable !== true || name === "foundBy" && (meta.foundBy ?? entry.foundBy) === undefined) continue;
        await key(name); await override(name, out);
      }
      await out("}");
    };
    const hash = createHash("sha256"); await write(part => { hash.update(part); });
    return use(write, hash.digest("hex") !== priorHash);
  });
}
