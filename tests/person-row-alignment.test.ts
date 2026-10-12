// `.person-row` is the shared row behind every name line, so it must read left to right. A row that puts the
// name first and a label after it (`justify-between`) is not in this class.

import test from "node:test";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = () => readFileSync("app/globals.css", "utf8");

/** The `.person-row` rule body, read out of the stylesheet rather than matched loosely. */
function personRowBlock(): string {
  const m = /\n\.person-row\s*\{([^}]*)\}/.exec(css());
  assert.ok(m, ".person-row is no longer declared in globals.css");
  return m[1];
}

test("ALIGN-1: the shared person row flows from the left", () => {
  const block = personRowBlock();
  assert.match(
    block,
    /justify-content:\s*flex-start/,
    "`.person-row` must state `justify-content: flex-start`. It was `flex-end`, which " +
      "is what put every representative's name to the right of the district they serve " +
      "on Who Governs Here and on both blocks of every small battlecard. The property " +
      "is STATED rather than deleted so the next edit cannot reintroduce this by " +
      "leaving it out and inheriting a default.",
  );
  assert.doesNotMatch(
    block,
    /justify-content:\s*(?:flex-)?end|justify-content:\s*right/,
    "`.person-row` is right-justified again — ALIGN-1 has regressed",
  );
});

test("ALIGN-1: the row is still a wrapping baseline row (NH-1 is not undone)", () => {
  // A long name still wraps rather than truncating: a truncated name is a different person's name.
  const block = personRowBlock();
  assert.match(block, /display:\s*flex/);
  assert.match(block, /flex-direction:\s*row/);
  assert.match(block, /flex-wrap:\s*wrap/);
  assert.match(block, /align-items:\s*baseline/);
});

test("ALIGN-1: both consumers of the shared row still use it", () => {
  // The fix is class-wide only while the class is shared, so the consumers are asserted by name.
  const consumers = [
    "components/map/coverage-notice.tsx",
    "components/map/popup/district-popup.tsx",
  ];
  for (const file of consumers) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /className="person-row"/,
      `${file} no longer renders \`.person-row\`. ALIGN-1's fix is one declaration ` +
        `on a SHARED row; a surface that leaves the class takes its own alignment ` +
        `with it and this guard stops covering it.`,
    );
  }

  /* The district popup uses it for both blocks. */
  const popup = readFileSync("components/map/popup/district-popup.tsx", "utf8");
  const uses = popup.match(/className="person-row"/g) ?? [];
  assert.ok(
    uses.length >= 2,
    `the small battlecard renders \`.person-row\` ${uses.length} time(s); the ` +
      `who-runs-it block and the representation list are both in ALIGN-1's scope`,
  );
});

test("ALIGN-1: no OTHER rule right-justifies a person row", () => {
  // A later `margin-left: auto` on the name or `justify-end` on the element would re-create the defect.
  const offenders: string[] = [];
  const stylesheet = css();
  for (const m of stylesheet.matchAll(/\n(\.person-row[a-z-]*)\s*\{([^}]*)\}/g)) {
    if (/margin-left:\s*auto|margin-inline-start:\s*auto|text-align:\s*right/.test(m[2])) {
      offenders.push(`${m[1]} pushes itself right`);
    }
  }

  const files = filesThatWouldBeCommitted({ cwd: process.cwd() })
    .filter((f) => /^(?:app|components)\/.*\.tsx$/.test(f));
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!/className="person-row"/.test(line)) continue;
      if (/justify-end|ml-auto|text-right/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "a person row is being pushed right by something other than the shared rule");
});

// Inside a `justify-between` row, the mark must share the name's flex item or it floats into the gap.
test("WGH-11: the could-govern mark is inside the name's own flex item", () => {
  const src = readFileSync("components/map/coverage-notice.tsx", "utf8");
  // Every assertion below is on the ORDER of the row's parts, never on indentation.
  const rowIdx = src.indexOf(`data-governing-row=""`);
  assert.ok(rowIdx >= 0, "the governing row is no longer recognisable in coverage-notice.tsx");
  const row = [src.slice(rowIdx)];

  const nameIdx = row[0].indexOf("bodyDisplayName(body)");
  const markIdx = row[0].indexOf("<CouldGovernMark");
  const labelIdx = row[0].indexOf("TYPE_LABEL_CLASS");
  assert.ok(nameIdx >= 0 && markIdx >= 0 && labelIdx >= 0, "the row lost one of its three parts");
  assert.ok(
    markIdx < labelIdx,
    "the mark must precede the type label — it annotates the NAME, not the label",
  );

  // The name and the mark share a wrapper, so the row's `justify-between` sees two items, not three.
  const wrapIdx = row[0].indexOf('<span className="inline-flex items-baseline">');
  assert.ok(
    wrapIdx >= 0,
    "the body name and its could-govern mark are no longer wrapped together. As separate " +
      "children of a `justify-between` row, the asterisk is distributed into the gap and " +
      "lands nowhere near the word it annotates — that is WGH-11.",
  );
  assert.ok(wrapIdx < nameIdx, "the wrapper must open before the name");
  assert.ok(nameIdx < markIdx, "the mark must follow the name it annotates");
});

test("WGH-11: the mark keeps the styling that only works once it is inline", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = /\.could-govern-mark\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, ".could-govern-mark is gone from globals.css");
  assert.match(rule[1], /display:\s*inline/);
  assert.match(rule[1], /margin-left:\s*3px/);
});
