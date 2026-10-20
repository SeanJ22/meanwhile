import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Everything here is read as source: the test runner does not compile JSX. */

const ROOT = process.cwd();
const PILL = readFileSync(
  join(ROOT, "components", "ballot", "ballot-ask-pill.tsx"),
  "utf8",
);
const ASK = readFileSync(join(ROOT, "components", "ask", "ballot-ask.tsx"), "utf8");
const PAGE = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/**
 * Comments come off before every source assertion. This file quotes the exact
 * strings it asserts on, and a guard that matches its own prose passes without
 * the code being there at all.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function declared(name: string): string {
  const found = new RegExp(`export const ${name} =\\s*\\n?\\s*"([^"]+)";`).exec(PILL);
  assert.ok(found, `${name} is declared in one place`);
  return found![1]!;
}

const BALLOT_ASK_PILL_LABEL = declared("BALLOT_ASK_PILL_LABEL");
const BALLOT_ASK_PILL_ARIA = declared("BALLOT_ASK_PILL_ARIA");

test("BAL-26: Ask is reachable from the pill row under the heading, and mounted once", () => {
  const src = code(PAGE);
  assert.match(src, /<BallotAskPill/, "the pill is on the page");

  // Source definitions can precede their render position when contests stream.
  // Inspect the main's actual child order: the pill precedes the streamed body.
  const main = src.slice(src.lastIndexOf("<main"), src.lastIndexOf("</main>"));
  const inPillRow = main.indexOf("<BallotAskPill");
  const contests = main.indexOf("{contents}");
  assert.ok(
    inPillRow > 0 && inPillRow < contests,
    "the affordance must sit ABOVE the contest list, not below it",
  );
  assert.equal((main.match(/<BallotAskPill\b/g) ?? []).length,1,"the page mounts one pill");

  assert.ok(
    !/<BallotAsk\s/.test(src),
    "the page mounts the pill, never a second copy of the panel",
  );
  assert.equal(
    code(PILL).split("<BallotAsk ").length - 1,
    1,
    "exactly one <BallotAsk> exists, inside the expansion",
  );
});

/** A bare "Ask" label is not allowed anywhere; the ballot label lives beside its component. */
test("G07: the ballot's Ask pill names a concrete question and is not a bare verb", () => {
  assert.notEqual(BALLOT_ASK_PILL_LABEL.trim().toLowerCase(), "ask");
  assert.notEqual(BALLOT_ASK_PILL_LABEL.trim().toLowerCase(), "ask…");
  assert.ok(
    /office|proposition|running|ballot/i.test(BALLOT_ASK_PILL_LABEL),
    `the pill reads ${JSON.stringify(BALLOT_ASK_PILL_LABEL)} and names no example`,
  );
  assert.ok(
    BALLOT_ASK_PILL_ARIA.length >= BALLOT_ASK_PILL_LABEL.length,
    "the accessible name may be longer than the visible one, and must be",
  );
  /* Reader surfaces speak plain language: no enum, no id, no internal noun. */
  assert.ok(!/BALLOT|OCD|contestId/.test(BALLOT_ASK_PILL_LABEL));
});

test("BAL-26: the pill carries the disclosure state and Escape closes it", () => {
  const src = code(PILL);
  assert.match(src, /aria-expanded=\{open\}/, "a disclosure states whether it is open");
  assert.match(src, /aria-controls="ballot-ask-panel"/);
  assert.match(src, /id="ballot-ask-panel"/);
  assert.match(src, /event\.key !== "Escape"/, "Escape must close the panel");
  assert.match(
    src,
    /useDismissOnOutside\(shell, close, open\)/,
    "an outside press dismisses, through the generic hook rather than a copy",
  );
  assert.match(
    src,
    /requestAnimationFrame\(/,
    "focus lands in the input one frame after it mounts",
  );

  /* The ballot has no map floaters to raise above. */
  assert.ok(!/takeForeground/.test(src), "the ballot must not import map machinery");
});

test("BAL-26: the DOM contract the evidence scripts read is unchanged", () => {
  const src = code(ASK);
  assert.match(src, /data-ballot-ask>/, "the section attribute is the one the walks read");
  assert.match(src, /data-ask-input/);
  assert.match(src, /data-ask-submit/);

  const section = src.indexOf("data-ballot-ask");
  const input = src.indexOf("data-ask-input");
  const submit = src.indexOf("data-ask-submit");
  assert.ok(
    section < input && input < submit,
    "the input and the submit stay INSIDE the section, in that order",
  );
});

test("BAL-26: Escape on the input clears a half-typed question before it closes anything", () => {
  const src = code(ASK);
  assert.match(src, /e\.key === "Escape" && text\.length > 0/);
  assert.match(
    src,
    /e\.stopPropagation\(\)/,
    "the first press must not also close the panel the reader is still typing in",
  );
  assert.match(
    src,
    /inFlight\.current\?\.abort\(\)/,
    "and it aborts a request whose question the reader has abandoned",
  );
});

/** Tokens used as arbitrary values must be declared custom properties. The broken class name is not written here: Tailwind scans comments too. */
test("BAL-26: every custom property the Ask surfaces name is actually defined", () => {
  const named = new Set<string>();
  for (const src of [ASK, PILL]) {
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) named.add(m[1]);
  }
  assert.ok(named.size > 0, "the sweep must actually find some tokens to check");

  const missing = [...named].filter(
    (token) => !new RegExp(`^\\s*${token}:`, "m").test(CSS),
  );
  assert.deepEqual(
    missing,
    [],
    `these resolve to nothing and render as a fallback nobody chose: ${missing.join(", ")}`,
  );
});

test("BAL-26: the two phantom tokens are gone from every surface that used them", () => {
  for (const [name, src] of [
    ["ballot-ask.tsx", ASK],
    ["ballot-ask-pill.tsx", PILL],
    ["globals.css", CSS],
  ] as const) {
    assert.ok(!/var\(--line\)/.test(code(src)), `${name} still names --line`);
    assert.ok(!/var\(--muted\)/.test(code(src)), `${name} still names --muted`);
  }
});

test("BAL-26: the Ask surface uses the house radius grammar", () => {
  const src = code(ASK);
  assert.ok(!/\brounded-lg\b/.test(src), "the house radius is --radius: 10px");
  assert.ok(
    !/className="[^"]*\brounded\b(?!-)/.test(src),
    "a bare rounded is Tailwind's 4px, which is not a radius this product uses",
  );
  assert.ok(src.includes("rounded-[10px]"), "the panel and its controls use it");
});
