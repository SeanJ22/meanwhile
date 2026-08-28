import assert from "node:assert/strict";
import test from "node:test";

import { hostOf, sourceLinks } from "../lib/ask/host.ts";

/**
 * **ONE LINE PER PUBLISHER, NOT ONE PER DOCUMENT.**
 * (Found by reading the panel, 2026-08-28.)
 *
 * The Hobbs answer rests on six executive orders. Each is a separate signed PDF
 * from ONE office, so deduplicating by URL — correct for the URL — produced a
 * source line naming the Office of the Arizona Governor seven times.
 *
 * Nothing about it was false and all of it was unreadable. An attribution
 * nobody can read is an attribution that has stopped working, which is a real
 * cost rather than a cosmetic one on a product whose whole claim is that every
 * sentence is sourced.
 */

test("six documents from one office are ONE source line", () => {
  const records = Array.from({ length: 6 }, (_, i) => ({
    sourceUrl: `https://azgovernor.gov/sites/default/files/executive-order-2026-0${i}.pdf`,
    sourceOrg: "Office of the Arizona Governor",
  }));
  const links = sourceLinks(records);
  assert.equal(links.length, 1);
  assert.equal(links[0].label, "Office of the Arizona Governor");
  assert.equal(
    links[0].url,
    "https://azgovernor.gov/sites/default/files/executive-order-2026-00.pdf",
    "the first document from that publisher carries the link",
  );
});

test("DISTINCT publishers all survive — deduplication is not collapsing", () => {
  const links = sourceLinks([
    { sourceUrl: "https://azgovernor.gov/a", sourceOrg: "Office of the Arizona Governor" },
    { sourceUrl: "https://azsos.gov/b", sourceOrg: "Arizona Secretary of State" },
    { sourceUrl: "https://azgovernor.gov/c", sourceOrg: "Office of the Arizona Governor" },
  ]);
  assert.deepEqual(
    links.map((l) => l.label),
    ["Office of the Arizona Governor", "Arizona Secretary of State"],
    "in first-seen order, and neither publisher is lost",
  );
});

test("a record with no recorded publisher falls back to the HOST, never to a phrase", () => {
  /*
   * A link labelled "the record" reads as an attributed source and is not one.
   * The hostname is a mechanical read of a URL already on screen — a fact about
   * where the link goes, never a claim about who published what is there.
   */
  const links = sourceLinks([{ sourceUrl: "https://vailschooldistrict.org/x", sourceOrg: null }]);
  assert.equal(links[0].label, "vailschooldistrict.org");
  assert.equal(hostOf("https://vailschooldistrict.org/x"), "vailschooldistrict.org");
});

test("a record with no source contributes no line at all", () => {
  assert.deepEqual(sourceLinks([{ sourceUrl: null, sourceOrg: "Somebody" }]), []);
  assert.deepEqual(sourceLinks([]), []);
});

test("an unparseable URL yields no label rather than an empty link", () => {
  /* `hostOf` returns "" for a URL it cannot parse, and an empty label would
     render as a link with no text — a target a reader cannot see or click. */
  assert.deepEqual(sourceLinks([{ sourceUrl: "not a url", sourceOrg: null }]), []);
});
