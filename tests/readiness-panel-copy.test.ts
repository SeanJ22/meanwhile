import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { plainCode } from "../lib/control-plane/plain-words.ts";

/**
 * **WHAT THE STATE READINESS PAGE SAYS** (ADM-39 / ADM-40 / ADM-41, 9.6.26).
 *
 * A `.tsx` module cannot be imported under `node --test` — types are erased, not
 * compiled — so the panel's copy is asserted as source text. That is a weaker
 * instrument than rendering it, and it is the right one for exactly these
 * claims: each is a REQUIRED SENTENCE from the brief, and the failure mode is
 * that somebody deletes it or rewrites it into machine speech. The rendering
 * itself is covered by `tests/admin-readiness-cell-state.test.ts`, which drives
 * Chromium, and the derivation by `tests/readiness-reader-delivery.test.ts`,
 * which runs the real publisher.
 */

const ROOT = process.cwd();
const PANEL = "app/(admin)/readiness/[state]/readiness-panel.tsx";
const PAGE = "app/(admin)/readiness/[state]/page.tsx";
const STYLES = "app/(admin)/readiness/[state]/styles.ts";

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/* ------------------------------------------------------------------ ADM-40 */

test("§9A.9: the page renders the required wording for something live whose proof is stale", () => {
  const panel = src(PANEL);
  assert.match(
    panel,
    /Shown on the Reader · verification proof needs a fresh check/,
    "the required §9A.9 sentence is not on the face of the page",
  );
  assert.match(panel, /never\s*\n?\s*&ldquo;no data&rdquo; and never an empty cell for something that is live/);
  // Every cell carries words, from the derivation's own sentence.
  assert.match(panel, /className="rq-cellword"/, "the grid cells lost their words");
  assert.match(panel, /function cellWord\(cell: GateCell\): string/);
  assert.match(panel, /What the Reader is being served/, "the reader-delivery block is gone");
});

test("§9A.1: every cell state reaches the face through plainCode, raw state on the hover", () => {
  const panel = src(PANEL);
  // The cell's words come from the derivation's own sentence, which defaults to
  // plainCode(state) — so NOT_WALKED reads "Not checked yet" and no second,
  // drifting dictionary of state words lives in this file.
  assert.match(panel, /plainCode\(cell\.state\)/);
  assert.doesNotMatch(panel, /const CELL_WORDS/, "a second dictionary of cell-state words is back");
  assert.doesNotMatch(panel, /STATE_HUMAN/, "the panel is reaching into Pilot Health's vocabulary again");
  // The raw state survives where it belongs: the hover.
  assert.match(panel, /title=\{`\$\{GATE_LABEL\[cell\.gate\]\}[\s\S]*?\$\{cell\.says\}[\s\S]*?\[\$\{cell\.state\}\]`\}/);
  // plainCode's own dictionary is what makes that true; pin the two entries the
  // brief names so a rewording of the dictionary is a deliberate act.
  assert.equal(plainCode("NOT_WALKED"), "Not checked yet");
  assert.equal(plainCode("ARGUED_ABSENT"), "Looked for, does not exist");
});

test("§9A.1: no machine constant leads on the readiness page", () => {
  const panel = src(PANEL);
  // The literal `NOT_WALKED` used to be printed in the unpublished banner, and
  // the wrong CLI command with it. Neither may return, and no CLI command of any
  // kind belongs on the face (§9A.7).
  assert.doesNotMatch(panel, /<code>NOT_WALKED<\/code>/);
  assert.doesNotMatch(panel, /<code>pnpm [a-z:]+<\/code>/, "a command line is on the face of the panel");
  assert.doesNotMatch(panel, /readiness-refresh\.mts/);
  // The level tag beside a capability is words, not the raw enum.
  assert.match(panel, /LEVEL_WORDS\[row\.level\]/);
  assert.doesNotMatch(panel, /\{row\.level\}<\/span>/);
  // "worst-of" is an internal derivation name and was printed on every ZIP row.
  assert.doesNotMatch(panel, /`worst-of:/);
  // "Level 0" is the exact phrase the ZIP row's own gap sentence forbids.
  assert.doesNotMatch(panel, /"Level 0"/);
});

test("POS-18 and the lines the owner asked to keep are still there", () => {
  const panel = src(PANEL);
  assert.match(panel, /Deploy fleet here/, "POS-18: the Deploy-fleet button left the readiness rows");
  assert.match(panel, /Nobody has looked yet:/, "the 'Nobody has looked yet' line is gone");
  // §9A.16: the same DISPATCH intent, now through the typed gateway and behind
  // a preview that says what it will and will not do before it acts.
  assert.match(panel, /<DeployFleet /, "the row's control is the shared one that explains itself");
  assert.match(src("app/(admin)/admin/deploy-fleet.tsx"), /type: "fleet\.deployHere"/);
  assert.match(panel, /Needs you: No/, "no card on the page answers 'does this need me?'");
});

/* ------------------------------------------------------------------ ADM-39 */

test("ADM-39: no summary tile renders a bare dash as though it were a metric", () => {
  const panel = src(PANEL);
  // The two tiles that could never hold a value are gone by name…
  assert.doesNotMatch(panel, /Reader-visible jurisdictions/);
  assert.doesNotMatch(panel, /Since the last full pass/);
  // …replaced by figures an instrument fills, and an honest label when it cannot.
  assert.match(panel, /capabilitiesServedToReaders/);
  assert.match(panel, /oldestEvidence/);
  assert.match(panel, /"Not checked yet"/, "an unfilled tile must say what it is, never a dash");
  // A tile figure is never the literal em dash the old ones rendered.
  assert.doesNotMatch(panel, /figure=\{?"—"/);
});

/* ------------------------------------------------------------------ ADM-41 */

test("§9A.10 / §9A.19: the population names its source, its vintage and its geography on the face", () => {
  const panel = src(PANEL);
  assert.match(panel, /ACS_SOURCE_LABEL/);
  assert.match(panel, /ACS_VINTAGE_LABEL/);
  assert.match(panel, /ACS_ZCTA_GEOGRAPHY_LABEL/);
  assert.match(panel, /not a city or town estimate, not a county figure, and not a\n?\s*Population Estimates Program value/);
  // The owner's objection: a bare "0 people" and a bare "32 people".
  assert.match(panel, /No residents are recorded in this ZIP's Census tabulation area/);
  assert.doesNotMatch(panel, /toLocaleString\(\)\} people/, "a bare population count is back on the ZIP row");
  assert.match(panel, /not distinguishable from zero/);
  assert.match(panel, /function populationSentence\(z: ZipRow\): string/);
});

test("ADM-41: the per-ZIP population is inside the page's own number audit", () => {
  const page = src(PAGE);
  assert.match(page, /zip population \$\{z\.zip\}/, "a wrong ZIP population would pass the R-D audit untouched");
  assert.match(page, /capabilities served to readers/);
});

/* ------------------------------------------------------------------ styles */

test("the panel's own stylesheet carries the classes its markup uses", () => {
  const styles = src(STYLES);
  for (const cls of ["rq-cellword", "rq-covsays", "rq-delivery", "rq-delivery-where", "rq-delivery-src"]) {
    assert.match(styles, new RegExp(`\\.${cls}[\\s{,:]`), `${cls} is rendered with no rule to style it`);
  }
  // The state classes and the swatch geometry live unlayered in the console
  // layout; nothing here may declare a background or a shadow for a cell, which
  // is the #281 regression this file's sibling test seeds against.
  assert.doesNotMatch(styles, /\.rq-cell\s*\{[^}]*background/);
});
