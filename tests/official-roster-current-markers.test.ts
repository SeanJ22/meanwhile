import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolveOfficialRosterMarker } from "../lib/sources/official-rosters/current-markers.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";

const folder = new URL("./fixtures/official-rosters/states/", import.meta.url);
const evidence = JSON.parse(readFileSync(new URL("research-current-markers.json", folder), "utf8")) as {
  id: string; url: string; retrievedAt?: string; fixture?: string;
}[];
function sample(id: string) {
  const row = evidence.find(item => item.id === id)!;
  return { row, bytes: gunzipSync(readFileSync(new URL(row.fixture!, folder))) };
}
function resolve(state: string, id: string) {
  const { row, bytes } = sample(id);
  const original = officialLegislatureTarget(state)!;
  const target = { ...original, currentMarker: { url: row.url, parserVersion: "official-roster-current-markers/1" } };
  return { original, result: resolveOfficialRosterMarker(target, bytes, row.retrievedAt!) };
}

test("South Dakota's live CurrentSession flag selects its actual native session ID", () => {
  const { row, bytes } = sample("sd-current-marker");
  const inventory = JSON.parse(bytes.toString()) as { SessionId: number; Year: string; CurrentSession: boolean }[];
  const historical = inventory.find(item => item.Year === "2025" && item.CurrentSession === false)!;
  const oldUrl = `https://sdlegislature.gov/api/SessionMembers/Session/${historical.SessionId}`;
  const original = { ...officialLegislatureTarget("SD")!, routes: [oldUrl],
    legislatureRoutes: [{ url: oldUrl, chamber: "both" as const }], currentMarker: { url: row.url, parserVersion: "official-roster-current-markers/1" } };
  const result = resolveOfficialRosterMarker(original, bytes, row.retrievedAt!);
  assert.deepEqual(result.routes, ["https://sdlegislature.gov/api/SessionMembers/Session/71"]);
  assert.deepEqual(result.legislatureRoutes, [{ url: result.routes[0], chamber: "both" }]);
  assert.equal(result.scope, original.scope);
  assert.equal(result.sourceId, original.sourceId);
  assert.equal(result.contractId, original.contractId);
});

test("Vermont's current-session label and all-member link select the same published roster year", () => {
  const { result } = resolve("VT", "vt-current-marker");
  assert.deepEqual(result.routes, ["https://legislature.vermont.gov/people/loadAll/2026/"]);
  assert.deepEqual(result.chambers, ["lower", "upper"]);
});

test("Wisconsin's current-biennium menu selects both native chamber routes", () => {
  const { result } = resolve("WI", "wi-current-marker");
  assert.deepEqual(result.legislatureRoutes, [
    { url: "https://docs.legis.wisconsin.gov/2025/legislators/assembly/", chamber: "lower" },
    { url: "https://docs.legis.wisconsin.gov/2025/legislators/senate/", chamber: "upper" },
  ]);
});

test("North Dakota's explicitly next 2027 assembly cannot replace its explicitly current 2025 assembly", () => {
  const { original, result } = resolve("ND", "nd-current-marker");
  assert.equal(result.routes.length, original.routes.length);
  assert.equal(result.routes[0], "https://ndlegis.gov/assembly/69-2025/regular/members");
  assert.equal(result.routes.some(url => url.includes("70-2027")), false);
  assert.equal(result.routes.at(-1), "https://ndlegis.gov/assembly/69-2025/regular/members?page=9");
});

test("a check date cannot manufacture a current session or silently preserve an archive", () => {
  const { row, bytes } = sample("sd-current-marker");
  const payload = JSON.parse(bytes.toString());
  for (const item of payload) item.CurrentSession = false;
  const target = { ...officialLegislatureTarget("SD")!, currentMarker: { url: row.url, parserVersion: "official-roster-current-markers/1" } };
  assert.throws(() => resolveOfficialRosterMarker(target, Buffer.from(JSON.stringify(payload)), "2040-01-01T00:00:00Z"), /one current session/);
});

test("a public marker cannot redirect roster acquisition away from its official publisher", () => {
  const { row, bytes } = sample("wi-current-marker");
  const target = { ...officialLegislatureTarget("WI")!, currentMarker: { url: "https://example.com/", parserVersion: "official-roster-current-markers/1" } };
  assert.throws(() => resolveOfficialRosterMarker(target, bytes, row.retrievedAt!), /outside its observed publisher/);
});
