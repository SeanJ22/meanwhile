/**
 * `AddressPrompt` takes separate classes for the collapsed trigger (`triggerClassName`) and the
 * open form (`className`); a pill class must never reach the form.
 */
import test from "node:test";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PROMPT = "components/address/address-prompt.tsx";
const prompt = () => readFileSync(PROMPT, "utf8");
const css = () => readFileSync("app/globals.css", "utf8");

test("BAL-23: the trigger and the form take DIFFERENT class props", () => {
  const src = prompt();
  assert.match(
    src,
    /triggerClassName\?:\s*string/,
    `${PROMPT} must declare a separate \`triggerClassName\`. One prop serving both ` +
      `the collapsed chip and the expanded form is what let a pill class reach a ` +
      `three-block form.`,
  );
  assert.match(
    src,
    /<p className=\{triggerClassName\}>/,
    "the idle trigger wrapper must take `triggerClassName`, never `className`",
  );
});

test("BAL-23: no open-form wrapper takes the trigger's class", () => {
  const offenders: string[] = [];
  prompt()
    .split("\n")
    .forEach((line, i) => {
      if (!/className=\{`address-prompt/.test(line)) return;
      if (/triggerClassName/.test(line)) offenders.push(`${PROMPT}:${i + 1}: ${line.trim()}`);
    });
  assert.deepEqual(
    offenders,
    [],
    "an open form wrapper is taking the collapsed control's class again — that is BAL-23",
  );
});

test("BAL-23: no OTHER wrapper takes the form's class either", () => {
  const src = prompt();
  const idle = /if \(phase === "IDLE"(?: \|\| phase === "SETTLED")?\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(idle, "the IDLE branch is no longer recognisable — this guard cannot read it");
  assert.doesNotMatch(
    idle[1],
    /\bclassName=\{className\}/,
    "the collapsed trigger is taking the OPEN FORM's class",
  );
});

test("BAL-23: every consumer passes its class to the slot it belongs in", () => {
  const files = filesThatWouldBeCommitted({ cwd: process.cwd() })
    .filter((f) => /^(?:app|components)\/.*\.tsx$/.test(f) && f !== PROMPT);

  let consumers = 0;
  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!/<AddressPrompt\b/.test(src)) continue;
    consumers += 1;
    for (const call of src.matchAll(/<AddressPrompt\b([\s\S]*?)\/>/g)) {
      const props = call[1];
      const cls = /(?<!trigger)className=\{?["`]?([A-Za-z0-9 _-]*)/.exec(props);
      if (cls && /pill/.test(cls[1])) {
        offenders.push(`${file}: passes "${cls[1]}" as className — a pill belongs on triggerClassName`);
      }
    }
  }
  assert.ok(consumers >= 3, `only ${consumers} AddressPrompt consumer(s) found — the sweep read almost nothing`);
  assert.deepEqual(offenders, []);
});

test("BAL-23: the ballot page passes its pill to the TRIGGER", () => {
  const src = readFileSync("components/ballot/ballot-narrowing.tsx", "utf8");
  assert.match(
    src,
    /triggerClassName=\{className\}/,
    "the ballot's narrow-it control must place its pill on the trigger",
  );
  assert.doesNotMatch(
    src,
    /\n\s*className=\{className\}/,
    "the ballot's narrow-it control is passing its pill to the open form again",
  );
});

test("BAL-23: the open form gets its own row inside the ballot's pill strip", () => {
  // The strip is `display: flex`; without a basis the form competes with the other pills for one line.
  const rule = /\.ballot-top-pills \.address-prompt\s*\{([^}]*)\}/.exec(css());
  assert.ok(rule, "the ballot pill strip no longer gives the open address form its own row");
  assert.match(rule[1], /flex:\s*1 0 100%/);
});

test("BAL-23: the pill class is still a pill for the collapsed control", () => {
  const rule = /\.ballot-top-pill,\s*\n\.ballot-top-pill \.address-prompt-trigger\s*\{([^}]*)\}/.exec(
    css(),
  );
  assert.ok(rule, "the ballot pill no longer styles the address prompt's trigger");
  assert.match(rule[1], /border-radius:\s*var\(--radius-pill\)/);
});
