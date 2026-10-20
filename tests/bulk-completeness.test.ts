import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACS_ROW_FLOOR, acsTableTooShort, shortTransfer } from "../lib/sources/bulk-completeness.ts";

/**
 * The bulk-file pullers hand-roll their own `fetch` and so cannot lean on the
 * shared client's checks. These are the two completeness questions they ask of
 * a 200 that parsed: did the whole declared body arrive, and is the table long
 * enough to be the whole geography. A truncated CSV/JSON parses into a shorter
 * document — the silent-wrong-data "correct first" forbids.
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

test("acsTableTooShort refuses a table below its scope floor and passes a complete one", () => {
  // The floors sit well below the live counts and far above zero.
  assert.equal(ACS_ROW_FLOOR.state, 50);
  assert.equal(ACS_ROW_FLOOR.zcta, 30_000);

  assert.match(acsTableTooShort("state", 1) ?? "", /below the floor of 50/);
  assert.match(acsTableTooShort("zcta", 12) ?? "", /below the floor of 30000/);
  assert.equal(acsTableTooShort("state", 52), null);
  assert.equal(acsTableTooShort("zcta", 33_772), null);
});

test("the census promotion wires the floor into its acquisition, not the reader-bound adapter", () => {
  // The floor lives here, not in lib/sources/census-acs-population/index.ts,
  // because that adapter is bound by the reader closure receipt; the promotion
  // script is the one production caller of its fetch and is not reader-bound.
  const promote = readFileSync("scripts/acs-population-promote.mts", "utf8");
  assert.match(promote, /acsTableTooShort\(/, "the census promotion must enforce the row floor on what it fetched");
  const adapter = readFileSync("lib/sources/census-acs-population/index.ts", "utf8");
  assert.doesNotMatch(adapter, /acsTableTooShort|bulk-completeness/, "the reader-bound adapter must stay byte-clean of the floor");
});
