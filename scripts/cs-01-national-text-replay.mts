/** Read-only nationwide CS-01 replay of real held reader payloads, one state in memory at a time.
 * This complements the twenty full browser journeys; it does not call this projection preview a page test.
 * NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/cs-01-national-text-replay.mts
 * --base=http://127.0.0.1:3001 uses a branch server connected to the verified production readonly role.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readerText, READER_CAPITAL_WORDS, type ReaderTextMode } from "../lib/text/reader-names.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { runIdFor } from "./browser.mts";
import { syntheticRunHeaders } from "../lib/db/run-marker.ts";

const ZIPS: Readonly<Record<string, string>> = {
  AL:"36104",AK:"99801",AZ:"85701",AR:"72201",CA:"94118",CO:"80203",CT:"06103",DE:"19901",FL:"32301",GA:"30303",
  HI:"96813",ID:"83702",IL:"62701",IN:"46204",IA:"50309",KS:"66603",KY:"40601",LA:"70802",ME:"04330",MD:"21401",
  MA:"02108",MI:"48933",MN:"55102",MS:"39201",MO:"65101",MT:"59601",NE:"68508",NV:"89701",NH:"03301",NJ:"08608",
  NM:"87501",NY:"12207",NC:"27601",ND:"58501",OH:"43215",OK:"73102",OR:"97301",PA:"19107",RI:"02903",SC:"29201",
  SD:"57501",TN:"37219",TX:"77005",UT:"84111",VT:"05602",VA:"23219",WA:"98501",WV:"25301",WI:"53202",WY:"82001",
};
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = (arg("base") ?? PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
const output = resolve(arg("out") ?? ".scratch/cs-01/national-text-replay");
const selected = arg("states")?.toUpperCase().split(",");
const replayDirectory = arg("replay-captures") ? resolve(arg("replay-captures")!) : null;
const prior = replayDirectory ? JSON.parse(await readFile(`${replayDirectory}/summary.json`, "utf8")) as { results: { state: string; inputs: { family: string; status: number; sha256: string }[] }[] } : null;
const states = Object.entries(ZIPS).filter(([state]) => !selected || selected.includes(state));
const runId = runIdFor("cs-01-national-replay");
const headers = syntheticRunHeaders({ WTP_RUN_ID: runId });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

type Kind = "person" | "body" | "title" | "address" | "sentence" | "source-quote" | "source-label";
type Field = { path: string; kind: Kind; mode: ReaderTextMode; raw: string; display?: string; capitals?: string[] };
const KINDS: readonly Kind[] = ["person", "body", "title", "address", "sentence", "source-quote", "source-label"];

function displayKind(key: string, path: string): { kind: Kind; mode: ReaderTextMode } | null {
  if (/^(?:quote|sourceQuote)$/.test(key)) return { kind: "source-quote", mode: "sentence" };
  if (/^(?:sourceOrg|what|publisher)$/.test(key)) return { kind: "source-label", mode: "title" };
  if (/^(?:address|mailingAddress|officeAddress|streetAddress)$/.test(key) || /\.address(?:\.|\[)/.test(path) && /^(?:line\d|city|street|state)$/.test(key)) return { kind: "address", mode: "address" };
  if (/^(?:bodyName|divisionLabel|governmentName|agency|office)$/.test(key)) return { kind: "body", mode: "title" };
  if (/^(?:name|givenName|familyName|filedName|committeeName|donorName|recipient|committee)$/.test(key)) return { kind: /bodies|governments|jurisdiction|offices|venues/i.test(path) && !/representatives|members|roster|person/i.test(path) ? "body" : "person", mode: "name" };
  if (/^(?:title|officeTitle|contactTitle|label|scopeNote|election|amountLabel|governmentClass)$/.test(key)) return { kind: "title", mode: "title" };
  if (/^(?:text|wording|summary|description|notes|action|tallyText|dispositionConflict|room|hours|modelSentence|sentence|result|wall|extractionNote)$/.test(key)) return { kind: "sentence", mode: "sentence" };
  return null;
}

function fieldsOf(value: unknown, path = "", fields: Field[] = []): Field[] {
  if (Array.isArray(value)) value.forEach((child, index) => fieldsOf(child, `${path}[${index}]`, fields));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    const current = path ? `${path}.${key}` : key;
    if (typeof child === "string" && child.trim()) {
      const use = displayKind(key, current);
      if (use && !/^https?:\/\//i.test(child) && !/^[\w.+-]+@[\w.-]+\.[a-z]+$/i.test(child)) fields.push({ path: current, ...use, raw: child });
    } else fieldsOf(child, current, fields);
  }
  return fields;
}

function capitals(text: string): string[] {
  return (text.match(/(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}]+(?![\p{L}\p{M}\p{N}])/gu) ?? []).filter(word => word.length >= 3 && word === word.toUpperCase() && word !== word.toLowerCase() && !READER_CAPITAL_WORDS.has(word));
}

const results: unknown[] = [];
await mkdir(output, { recursive: true });
assert.equal(Object.keys(ZIPS).length, 50);
for (const [state, zip] of states) {
  const errors: string[] = [], inputs: { family: string; path: string; status: number; sha256: string; bytes: number; capture: string; records?: number; statusLabel?: string }[] = [];
  const folder = `${output}/${state}`;
  await mkdir(folder, { recursive: true });
  const fields: Field[] = [];
  for (const [family, path] of [
    ["place", `/api/meetings?zip=${zip}&include=state`],
    ["government-listings-first-page", `/api/public-records?kind=governments&state=${state}&offset=0`],
    ["campaign-money-first-page", `/api/campaign-finance?division=${encodeURIComponent(`ocd-division/country:us/state:${state.toLowerCase()}`)}`],
  ]) {
    try {
      const response = replayDirectory ? null : await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(45_000) });
      const original = prior?.results.find(row => row.state === state)?.inputs.find(input => input.family === family);
      const raw = replayDirectory ? await readFile(`${replayDirectory}/${state}/${family}.json`, "utf8") : await response!.text();
      if (replayDirectory) assert.equal(hash(raw), original?.sha256, "Replay must consume the exact captured production bytes");
      const status = response?.status ?? original!.status;
      const capture = `${folder}/${family}.json`;
      await writeFile(capture, raw);
      const payload = JSON.parse(raw) as Record<string, unknown>;
      inputs.push({ family, path, status, sha256: hash(raw), bytes: Buffer.byteLength(raw), capture,
        ...(Array.isArray(payload.records) ? { records: payload.records.length } : {}),
        ...(typeof payload.status === "string" ? { statusLabel: payload.status } : {}) });
      if (status < 200 || status >= 300) errors.push(`${family}: HTTP ${status}${typeof payload.error === "string" ? `, ${payload.error}` : ""}`);
      else {
        const original = JSON.stringify(payload);
        fieldsOf(payload, family, fields);
        assert.equal(JSON.stringify(payload), original, "Extracting reader fields must leave stored source values unchanged");
        if (family === "place" && !(payload.coverage || payload.stateResponse)) errors.push("place: successful response contains no held representation");
      }
    } catch (error) { errors.push(`${family}: ${String(error)}`); }
  }
  const knownNames = [...new Set(fields.filter(field => field.kind === "body" || field.kind === "person" || field.kind === "source-label").map(field => field.raw))];
  const inputHash = hash(JSON.stringify(fields.map(field => [field.path, field.raw])));
  for (const field of fields) {
    field.display = readerText(field.raw, field.mode, field.mode === "sentence" ? knownNames : []);
    field.capitals = capitals(field.display);
  }
  assert.equal(hash(JSON.stringify(fields.map(field => [field.path, field.raw]))), inputHash, "Formatting must preserve every captured fact and quote");
  const byKind = Object.fromEntries(KINDS.map(kind => {
    const rows = fields.filter(field => field.kind === kind);
    return [kind, { fields: rows.length, changed: rows.filter(field => field.raw !== field.display).length,
      remainingCapitals: rows.reduce((sum, field) => sum + field.capitals!.length, 0),
      ...(rows.length ? {} : { missingReason: `No ${kind} field is held in this state's selected place or first-page inventory/money responses` }) }];
  }));
  if (!fields.length) errors.push("No real reader text was available; this state is unproven");
  const offenders = fields.filter(field => field.capitals!.length).map(field => ({ path: field.path, raw: field.raw, display: field.display, capitals: field.capitals }));
  const html = "<!doctype html>" + renderToStaticMarkup(createElement("html", null, createElement("body", null,
    createElement("h1", null, `${state} reader projection preview`),
    ...fields.map(field => createElement("p", { key: field.path, "data-kind": field.kind, "data-path": field.path }, field.display)))));
  await writeFile(`${folder}/projection.html`, html);
  await writeFile(`${folder}/fields.json`, JSON.stringify(fields, null, 2) + "\n");
  const result = { state, zip, inputs, fields: fields.length, changed: fields.filter(field => field.raw !== field.display).length,
    byKind, sourceValuesUnchanged: true, inputFieldHash: inputHash, renderedProjectionHash: hash(html), offenders, errors };
  results.push(result);
  await writeFile(`${output}/summary.json`, JSON.stringify({ checkedAt: new Date().toISOString(), base, runId, states: states.length, replayedFrom: replayDirectory,
    nationwide: !selected, evidenceKind: "Real production reader payloads through branch formatter to a server-rendered text projection; full reader pages are proven separately by cs-01-reader-scan.mts",
    pageJourneysProven: false, upstreamScheduleProven: false, permittedCapitalWords: [...READER_CAPITAL_WORDS], results }, null, 2) + "\n");
  console.log(`${state} ${zip}: ${fields.length} held text fields, ${result.changed} cased, ${offenders.length} offending fields; ${errors.join("; ") || "read-only replay completed"}`);
  if (errors.length || offenders.length) process.exitCode = 1;
}
