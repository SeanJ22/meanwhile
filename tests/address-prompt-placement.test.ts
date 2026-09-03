/**
 * BAL-23 — A COLLAPSED CONTROL AND AN EXPANDED FORM ARE DIFFERENT SHAPES.
 * (2026-08-25, the author's `17-44-49`. *Very ugly, convoluted, a disaster.*)
 *
 * **The verdict first, because WGH-5 asks a question this answers.**
 *
 * WGH-5 (8/22) required the address-narrowing flow to run through ONE shared
 * component, and **it does** — `AddressPrompt`, four consumers, no second
 * implementation. So the defect is not a routing failure. It is a layout
 * defect in the shared component, and the shape of it is worth keeping:
 *
 * `AddressPrompt` had a single `className` prop and applied it to the idle
 * TRIGGER wrapper and to every OPEN FORM wrapper. The ballot page passed
 * `ballot-top-pill` — correct for the trigger, which is a pill, and ruinous for
 * the form, because that class is `display: inline-flex; align-items: center;
 * min-height: 40px; padding: 0 16px; border-radius: 999px`. The form's ask,
 * fields and promise became flex items in a 40px pill: *What street do you live
 * on?* wrapped one word per line, the promise paragraph overflowed to the
 * right, and the whole thing shared a `display: flex` row with the
 * *Moving here?* pill.
 *
 * **The class denominator, measured: 4 consumers of `AddressPrompt`. One
 * passed a class that reached the open form. That one passed a pill.** The
 * other three pass nothing (`could-govern-notice`, `jurisdiction-note`) or pass
 * a form class with `startOpen`, which is the slot it belongs in
 * (`jurisdiction-pill`).
 *
 * One consumer was affected and the HOLE was in the shared component, so the
 * fix is there: two props, each reaching one slot, and neither able to reach
 * the other.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

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
  /* The mirror. A trigger that took `className` would be the same bug pointed
     the other way, and would look just as reasonable in a diff. */
  const src = prompt();
  const idle = /if \(phase === "IDLE"\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(idle, "the IDLE branch is no longer recognisable — this guard cannot read it");
  assert.doesNotMatch(
    idle[1],
    /\bclassName=\{className\}/,
    "the collapsed trigger is taking the OPEN FORM's class",
  );
});

test("BAL-23: every consumer passes its class to the slot it belongs in", () => {
  /*
   * The class sweep, and it is held OPEN rather than closed: a new consumer
   * passing a pill as `className` would reintroduce this without touching the
   * component. Any `className` whose value names a pill is refused by name.
   */
  const files = execSync("git ls-files -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
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
  /*
   * The other half of *running into everything else on the page*. The strip is
   * `display: flex`, so without a basis the form competes with the
   * "Moving here?" pill for one line.
   */
  const rule = /\.ballot-top-pills \.address-prompt\s*\{([^}]*)\}/.exec(css());
  assert.ok(rule, "the ballot pill strip no longer gives the open address form its own row");
  assert.match(rule[1], /flex:\s*1 0 100%/);
});

test("BAL-23: the pill class is still a pill for the collapsed control", () => {
  /*
   * The fix must not have cost the thing that was RIGHT. `ballot-top-pill`
   * styles the trigger through a descendant selector, so it keeps working once
   * the class moved to the trigger's own wrapper.
   */
  const rule = /\.ballot-top-pill,\s*\n\.ballot-top-pill \.address-prompt-trigger\s*\{([^}]*)\}/.exec(
    css(),
  );
  assert.ok(rule, "the ballot pill no longer styles the address prompt's trigger");
  // The pill radius is the --radius-pill token now (value-identical to the old
  // 999px), unified across the pill family by the 0903 rhythm pass.
  assert.match(rule[1], /border-radius:\s*var\(--radius-pill\)/);
});
