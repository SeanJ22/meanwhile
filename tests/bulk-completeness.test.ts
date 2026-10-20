import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shortTransfer } from "../lib/sources/bulk-completeness.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { ACS_STATES, acsContractId, acsPopulationScope } from "../lib/sources/census-acs-population/publication.ts";
import { acquireAcsStateCandidate } from "../scripts/acs-population-promote.mts";

/**
 * The bulk-file pullers hand-roll their own `fetch` and so cannot lean on the
 * shared client's checks. These are the two completeness questions they ask of
 * a 200 that parsed: did the whole declared body arrive, and is the table long
 * enough to be the whole geography. A truncated CSV/JSON parses into a shorter
 * document — the silent-wrong-data "correct first" forbids. State ACS checks
 * its exact requested identities, including the final bounded ZCTA batch.
 */

test("shortTransfer names an identity transfer cut short of its declared length", () => {
  const body = "abcdefghij"; // ten bytes
  assert.match(
    shortTransfer(new Headers({ "content-length": "25" }), body) ?? "",
    /short read: the server declared Content-Length 25 but 10 byte\(s\) arrived/,
  );
});

test("shortTransfer passes a transfer that reconciles, and one with no declared length", () => {
  const body = "abcdefghij";
  assert.equal(shortTransfer(new Headers({ "content-length": "10" }), body), null);
  // A body longer than the declared length is not a SHORT read — never flagged.
  assert.equal(shortTransfer(new Headers({ "content-length": "3" }), body), null);
  // Chunked / unknown length: nothing to reconcile against.
  assert.equal(shortTransfer(new Headers({ "content-type": "text/csv" }), body), null);
  assert.equal(shortTransfer(new Headers({ "content-length": "not-a-number" }), body), null);
});

test("shortTransfer never fires on a compressed body — Content-Length is the WIRE size there", () => {
  // A gzip body arrives under a smaller content-length, so a decoded body's completeness is a record-count job.
  assert.equal(
    shortTransfer(new Headers({ "content-length": "3", "content-encoding": "gzip" }), "abcdefghij"),
    null,
  );
  assert.equal(
    shortTransfer(new Headers({ "content-length": "3", "content-encoding": "br" }), "abcdefghij"),
    null,
  );
  // `identity` is the explicit "no compression" token and IS checked.
  assert.match(
    shortTransfer(new Headers({ "content-length": "999", "content-encoding": "identity" }), "abcdefghij") ?? "",
    /short read/,
  );
});

function acsFixture(tables: Readonly<Record<string, unknown>> = {}): typeof globalThis.fetch {
  return async input => {
    const url = new URL(String(input));
    if (url.pathname === "/data.json") return Response.json({ dataset: [{ c_dataset: ["acs", "acs5"], c_vintage: 2024 }] });
    if (url.pathname.endsWith("release-schedule.html")) return new Response('<table><tr><td>January 29, 2026</td><td>5-Year Data Release</td></tr></table>');
    const request = url.searchParams.get("for") ?? "";
    assert.doesNotMatch(request, /^(?:state|zip code tabulation area):\*$/, "the complete denominator is acquired by state and explicit ZCTA batch");
    if (request in tables) return Response.json(tables[request]);
    if (request === "zip code tabulation area:85633,85654") return Response.json([
      ["NAME", "B01003_001E", "zip code tabulation area"], ["Fixture ZIP 1", "3", "85633"], ["Fixture ZIP 2", "4", "85654"],
    ]);
    if (request === "state:04") return Response.json([["NAME", "B01003_001E", "state"], ["Arizona", "7", "04"]]);
    if (request === "us:*") return Response.json([["NAME", "B01003_001E", "us"], ["United States", "7", "1"]]);
    return new Response(null, { status: 204 });
  };
}
const acsOptions = (tables?: Readonly<Record<string, unknown>>) => ({ key: "fixture-key", fetcher: acsFixture(tables),
  targets: async () => ["85633", "85654"].map(geoid => ({ geography: "zcta" as const, geoid, divisionId: `zcta:${geoid}` })) });

test("registered ACS state promotion requires every requested native code before building a candidate", async () => {
  for (const state of ACS_STATES) {
    const contract = requiredRoutineContract(acsContractId(state));
    assert.equal(contract.scope, acsPopulationScope(state));
    assert.deepEqual(contract.acquisitionAdapter?.command, ["scripts/acs-population-promote.mts", `--state=${state}`]);
  }
  const candidate = await acquireAcsStateCandidate("AZ", acsOptions());
  assert.equal(candidate.scope, acsPopulationScope("AZ"));
  assert.equal(candidate.normalization.outputRecords, 4, "both requested ZCTAs, the exact state and nation survive acquisition");
  for (const [request, rows, message] of [
    ["zip code tabulation area:85633,85654", [["NAME", "B01003_001E", "zip code tabulation area"], ["Fixture ZIP 1", "3", "85633"]], /expected exactly the 2 requested/],
    ["zip code tabulation area:85633,85654", [["NAME", "B01003_001E", "zip code tabulation area"], ["Fixture ZIP 1", "3", "85633"], ["Unrequested ZIP", "4", "85701"]], /expected exactly the 2 requested/],
    ["state:04", [["NAME", "B01003_001E", "state"]], /expected exactly the 1 requested/],
    ["state:04", [["NAME", "B01003_001E", "state"], ["New Hampshire", "7", "33"]], /expected exactly the 1 requested/],
    ["us:*", [["NAME", "B01003_001E", "us"]], /expected exactly the 1 requested/],
    ["zip code tabulation area:85633,85654", [["NAME", "B01003_001E", "zip code tabulation area"], ["Fixture ZIP 1", "3"]], /incomplete columns/],
  ] as const) {
    await assert.rejects(acquireAcsStateCandidate("AZ", acsOptions({ [request]: rows })), error => {
      assert.equal((error as { code: string }).code, "PUBLISHER_DOCUMENT_INVALID");
      assert.match(String(error), message); return true;
    });
  }
});

test("the registered promotion calls bounded completeness acquisition outside the reader-bound adapter", () => {
  const promote = readFileSync("scripts/acs-population-promote.mts", "utf8");
  assert.match(promote, /signal => acquireAcsStateCandidate\(state, \{ signal \}\)/);
  const adapter = readFileSync("lib/sources/census-acs-population/index.ts", "utf8");
  assert.doesNotMatch(adapter, /acsTableTooShort|bulk-completeness/, "the reader-bound adapter must stay byte-clean of the floor");
});

test("ACS checks the complete requested denominator across bounded ZCTA batches", async () => {
  const codes = Array.from({ length: 101 }, (_, index) => String(85000 + index));
  let truncateLast = false;
  const batches: string[][] = [], rest = acsFixture();
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const request = new URL(String(input)).searchParams.get("for") ?? "";
    if (!request.startsWith("zip code tabulation area:")) return rest(input, init);
    const selected = request.split(":")[1].split(","); batches.push(selected);
    return Response.json([["NAME", "B01003_001E", "zip code tabulation area"],
      ...(truncateLast && selected.length === 1 ? [] : selected.map(code => [`Fixture ${code}`, "1", code]))]);
  };
  const options = { ...acsOptions(), fetcher, targets: async () => codes.map(geoid => ({ geography: "zcta" as const, geoid, divisionId: `zcta:${geoid}` })) };
  const candidate = await acquireAcsStateCandidate("AZ", options);
  assert.equal(candidate.normalization.outputRecords, 103);
  assert.deepEqual(batches, [codes.slice(0, 100), codes.slice(100)]);
  batches.length = 0; truncateLast = true;
  await assert.rejects(acquireAcsStateCandidate("AZ", options), /returned 0 row\(s\), expected exactly the 1 requested/);
  assert.deepEqual(batches, [codes.slice(0, 100), codes.slice(100)], "a complete first batch cannot hide a truncated final batch");
});
