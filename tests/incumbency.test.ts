/** A sitting officeholder resolves across name-form gaps, a failed match is UNKNOWN and never Challenger, and no absence string asserts a fact about a person. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  incumbencyLabel,
  resolveContestIncumbency,
  type SeatHolderRef,
} from "../lib/ballot/incumbency.ts";
import { splitDisplayName } from "../lib/identity/name-parts.ts";
import { nhLegislativeHolders, nhSeatKeyFromTitle, refreshNhSeatHolders, sits } from "../lib/ballot/seat-holders.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { claimsInText } from "../lib/text/absence-claims.ts";

const ROOT = join(import.meta.dirname, "..");
await refreshNhSeatHolders({ store: new MemoryRoutineDataStore() });

/** The file with its comments removed, so a doc block quoting a removed expression is not read as the defect. */
function code(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const cand = (display: string) => ({ id: display, ...splitDisplayName(display) });
const holder = (given: string, family: string): SeatHolderRef => ({
  givenName: given,
  familyName: family,
  personKey: null,
  source: "the body's own roster",
});

test("a sitting officeholder resolves to INCUMBENT when the name forms differ only by a middle name", () => {
  const out = resolveContestIncumbency({
    candidates: [cand("Karen Elizabeth Ebel"), cand("Bob Brown")],
    holders: [holder("Karen E.", "Ebel")],
    officeIsElected: true,
  });
  assert.equal(out.get("Karen Elizabeth Ebel")?.standing, "INCUMBENT", out.get("Karen Elizabeth Ebel")?.basis);
  assert.equal(out.get("Bob Brown")?.standing, "CHALLENGER");
});

test("a diminutive is never inferred — Greg Sargent against Gregory M. Sargent reads UNKNOWN, and a published person key settles it", () => {
  const bare = resolveContestIncumbency({
    candidates: [cand("Karen Elizabeth Ebel"), cand("Gregory M. Sargent")],
    holders: [holder("Karen E.", "Ebel"), holder("Greg", "Sargent")],
    officeIsElected: true,
  });
  assert.deepEqual([...bare.values()].map((d) => d.standing), ["UNKNOWN", "UNKNOWN"], "the surname collision fails the whole contest closed");

  const keyed = resolveContestIncumbency({
    candidates: [cand("Karen Elizabeth Ebel"), { ...cand("Gregory M. Sargent"), personKey: "nh-general-court:2080" }],
    holders: [holder("Karen E.", "Ebel"), { ...holder("Greg", "Sargent"), personKey: "nh-general-court:2080" }],
    officeIsElected: true,
  });
  assert.equal(keyed.get("Gregory M. Sargent")?.standing, "INCUMBENT", keyed.get("Gregory M. Sargent")?.basis);
  assert.match(keyed.get("Gregory M. Sargent")?.basis ?? "", /stable identifier/);
});

test("a generational suffix never lands in the surname", () => {
  // An initials helper must not take a generational suffix as the last name.
  assert.deepEqual(splitDisplayName("Thomas J. Haynes III"), { givenName: "Thomas J.", familyName: "Haynes" });
  assert.deepEqual(splitDisplayName("Sean Jones Jr."), { givenName: "Sean", familyName: "Jones" });
});

test("no holder record resolves the WHOLE CONTEST to UNKNOWN, never to challengers", () => {
  const out = resolveContestIncumbency({
    candidates: [cand("Alice Adams"), cand("Bob Brown")],
    holders: [],
    officeIsElected: true,
  });
  for (const [id, d] of out) {
    assert.equal(d.standing, "UNKNOWN", `${id} must not be labelled from an absence`);
    assert.match(d.basis, /haven't sourced/i, "and the reason must be about US");
  }
});

test("an ambiguous match FAILS CLOSED — the contest, not one card, reads UNKNOWN", () => {
  const out = resolveContestIncumbency({
    candidates: [cand("Chris Green"), cand("Chris Green")].map((c, i) => ({ ...c, id: `c${i}` })),
    holders: [holder("Chris", "Green")],
    officeIsElected: true,
  });
  assert.deepEqual([...out.values()].map((d) => d.standing), ["UNKNOWN", "UNKNOWN"]);
});

test("a sitting member sharing a surname with a candidate we cannot match FAILS CLOSED", () => {
  // The residual risk after the loose match: "Peggy" against "Margaret". A
  // surname collision the matcher cannot resolve is far more likely to be a
  // name-form gap than a coincidence, so the contest refuses.
  const out = resolveContestIncumbency({
    candidates: [cand("Margaret Doyle"), cand("Sam Ruiz")],
    holders: [holder("Peggy", "Doyle")],
    officeIsElected: true,
  });
  assert.deepEqual([...out.values()].map((d) => d.standing), ["UNKNOWN", "UNKNOWN"]);
});

test("a sitting member who is simply not running does NOT make the contest unknown", () => {
  // The direction that matters: failing closed on every unmatched holder would
  // make every open seat read as unsourced, which is a different false claim.
  const out = resolveContestIncumbency({
    candidates: [cand("Alice Adams"), cand("Bob Brown")],
    holders: [holder("Jeanne", "Shaheen")],
    officeIsElected: true,
  });
  assert.deepEqual([...out.values()].map((d) => d.standing), ["CHALLENGER", "CHALLENGER"]);
});

test("every candidate handed in gets a decision — none may fall through", () => {
  const out = resolveContestIncumbency({
    candidates: [cand("A One"), cand("B Two"), cand("C Three")],
    holders: [holder("A", "One")],
    officeIsElected: true,
  });
  assert.equal(out.size, 3, "a candidate with no decision asks the question again somewhere else");
});

test("a non-elected office renders no Incumbent/Challenger label at all (BC-26)", () => {
  const out = resolveContestIncumbency({
    candidates: [cand("Sam Superintendent")],
    holders: [holder("Sam", "Superintendent")],
    officeIsElected: false,
  });
  const d = out.get("Sam Superintendent");
  assert.equal(d?.standing, "UNKNOWN");
  assert.match(d?.basis ?? "", /not filled by election/i);
});

test("the shape sweep catches the line it was written for", () => {
  // The instrument is shown catching the copy that shipped.
  const shipped = "People who have not held this office don't have a voting record to show.";
  assert.ok(claimsInText(shipped).length > 0, "the sweep must flag the exact string that was live");
});

test("the three not-yet-sourced labels are distinct, and the third is about us", () => {
  assert.equal(incumbencyLabel("INCUMBENT"), "Incumbent");
  assert.equal(incumbencyLabel("CHALLENGER"), "Challenger");
  assert.match(incumbencyLabel("UNKNOWN") ?? "", /^We haven't sourced/);
  assert.notEqual(incumbencyLabel("UNKNOWN"), incumbencyLabel("CHALLENGER"));
});

test("the two gaps are two DIFFERENT true sentences, and both are about us", () => {
  /*
   * The contest-level gate can refuse a contest whose sitting member we do hold, so that case has its own
   * sentence, still about our records rather than theirs.
   */
  const unsourced = incumbencyLabel("UNKNOWN", "HOLDER_NOT_SOURCED") ?? "";
  const unestablished = incumbencyLabel("UNKNOWN", "CONTEST_NOT_ESTABLISHED") ?? "";
  assert.notEqual(unsourced, unestablished);
  for (const line of [unsourced, unestablished]) {
    assert.match(line, /^We haven't/, `"${line}" must name whose gap it is`);
    assert.deepEqual(claimsInText(line), [], `"${line}" asserts something about a person`);
  }
  assert.equal(incumbencyLabel("INCUMBENT", "CONTEST_NOT_ESTABLISHED"), "Incumbent", "the gap only colours UNKNOWN");
});

test("electedStatus NEW means sitting — reading it otherwise mislabels two real people", () => {
  assert.equal(sits("INCUMBENT"), true);
  assert.equal(sits("NEW"), true, "Daniel E. Innis and Gregory M. Sargent are both 'new' and both sit");
  assert.equal(sits("FORMER"), false);
  assert.equal(sits("UNSTATED"), false, "the file does not say, and a plausible value is a fabricated one");
});

test("the NH contest title parses into the county-and-district pair the roster is keyed on", () => {
  assert.deepEqual(nhSeatKeyFromTitle("State Representative, Merrimack County District 7"), {
    chamber: "H",
    county: "Merrimack",
    district: "7",
  });
  assert.deepEqual(nhSeatKeyFromTitle("State Senator, District 7"), { chamber: "S", county: null, district: "7" });
  assert.equal(nhSeatKeyFromTitle("Governor"), null, "anything it cannot read confidently returns null");
});

test("the committed roster answers for Merrimack House District 7 and names Ebel", () => {
  const holders = nhLegislativeHolders("State Representative, Merrimack County District 7");
  assert.equal(holders.length, 2, "Merrimack 7 is a two-member district");
  assert.ok(
    holders.some((h) => h.familyName === "Ebel" && h.givenName.startsWith("Karen")),
    `saw ${holders.map((h) => `${h.givenName} ${h.familyName}`).join(", ")}`,
  );
  assert.match(holders[0].source, /New Hampshire General Court/);
});

test("the corpus was taken from the BODY and says so", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "data/states/nh/hunt/nh-gencourt-members.json"), "utf8")) as {
    source: { url: string; org: string; collectedAt: string };
    counts: { produced: number; dropped: number; logicalInput: number };
  };
  assert.match(raw.source.url, /^https:\/\/gc\.nh\.gov\/downloads\/Members\.txt$/);
  assert.equal(raw.source.org, "New Hampshire General Court");
  assert.match(raw.source.collectedAt, /^\d{4}-\d{2}-\d{2}$/, "a read stamp, from the path that read it");
  // Every logical record has exactly one disposition.
  assert.equal(raw.counts.produced + raw.counts.dropped, raw.counts.logicalInput);
});

test("the ballot card no longer turns a falsy incumbency flag into 'Challenger'", () => {
  const src = code("components/ballot/candidate-battlecard.tsx");
  assert.ok(
    !/incumbent\s*\?\s*["']Incumbent["']\s*:\s*["']Challenger["']/.test(src),
    "the ternary that produced the defect is gone",
  );
  /* The label comes from the one decision, never from a ternary. */
  assert.ok(
    src.includes("incumbencyLabel(incumbency, incumbencyGap ?? undefined)"),
    "and the label comes from the one decision",
  );
});

test("the ballot page reads incumbency from the contest resolution, not from the FEC join", () => {
  const src = code("app/ballot/page.tsx");
  assert.ok(!/incumbent=\{holder !== null\}/.test(src), "the federal-only derivation is gone");
  assert.ok(src.includes("contestIncumbency("), "the contest resolution is what feeds the chip");
  assert.ok(
    /record:\s*(?:!has\("record"\)\s*\?\s*null\s*:\s*)?!officeholdersAvailable\s*\?[\s\S]*?:\s*recordHolder\s*\?/.test(src),
    "the voting-record panel first names an unavailable canonical officeholder holding, then gates content on an exact record (Item 14)",
  );
});
