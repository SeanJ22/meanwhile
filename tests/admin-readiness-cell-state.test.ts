import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { Page } from "playwright";

import { CELL_STATES, type CellState } from "../lib/control-plane/readiness/gates.ts";
import { launchGuarded, type GuardedBrowser } from "../scripts/browser.mts";

/**
 * **A CLICKABLE READINESS CELL KEEPS ITS STATE BOX.** (Admin Pass A, ADM-A1..A4,
 * 2026-09-06.)
 *
 * ## What broke
 *
 * The State Readiness grid renders one `button.rq-cell` per capability × gate,
 * carrying one of six state classes (`rq-current` … `rq-gated`). The #281
 * restyle (Lumen Edge) added a generic button recipe for the whole console and,
 * to keep the cell out of it, a reset: `.admin button.rq-cell { background: none;
 * box-shadow: none }`. That selector is (0,2,1); the state class is (0,2,0). The
 * reset won the cascade on every cell, so the grid rendered every state as an
 * empty box while the legend swatches — `<i>`, not `<button>` — kept theirs. The
 * class name was present the whole time, which is why a test that only greps for
 * the class proves nothing: this one renders the real stylesheets in Chromium
 * and reads `getComputedStyle`.
 *
 * ## The fix, and why it is a cascade fix rather than six overrides
 *
 * Every generic control recipe in the console (buttons, selects, inputs, cards,
 * element-level text rules) now lives in `@layer ce-recipe`. Cascade layers are
 * ordered BEFORE specificity: an unlayered rule beats a layered one whatever its
 * selector. The state classes, the swatch geometry and the violation ring stay
 * unlayered, so no future recipe — however specific — can outrank them without
 * moving them into the layer, which the structural guard below refuses.
 *
 * ## What this file proves
 *
 *   1  all six states render visibly and distinctly on a BUTTON cell, and each
 *      equals its legend swatch, in dark and in light
 *   2  the monotonicity-violation ring survives on a button cell
 *   3  a cell is focusable and activatable by keyboard, and its focus ring does
 *      not erase the state box
 *   4  every generic control reset is inside the recipe layer, and the state
 *      classes are not (the structural half of the fix)
 *   5  the same class of defect elsewhere: every focusable console control
 *      shows a keyboard focus indicator, and a health card's grade band survives
 *      hover and focus-within
 *   6  a POSITIVE CONTROL: re-appending the #281 reset makes the state check
 *      fail, so the checker is shown catching the defect on every run
 *
 * The harness is the two admin stylesheets exactly as the components inject
 * them (read from their template literals; neither interpolates), around the
 * panel's own markup shape. It carries no `globals.css`: the user-agent styles
 * a `<button>` gets without preflight are the harder case, not the easier one.
 */

const ROOT = process.cwd();
const LAYOUT = "app/(admin)/layout.tsx";
const PANEL_STYLES = "app/(admin)/readiness/[state]/styles.ts";
const CONSOLE_UI = "app/(admin)/console-ui.tsx";
const PANEL = "app/(admin)/readiness/[state]/readiness-panel.tsx";
/** The layer every generic recipe lives in. Named once here and once in the stylesheet. */
const RECIPE_LAYER = "ce-recipe";
/** The #281 reset, verbatim from `git show dc2294b0:app/(admin)/layout.tsx`. */
const THE_281_RESET = ".admin button.rq-cell { padding: 0; border-radius: .25rem; background: none; box-shadow: none; }";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** The CSS a `<style>` element injects: the template literal the component renders, as text. */
function styleLiteral(rel: string, name: string): string {
  const src = read(rel);
  const match = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(src);
  assert.ok(match, `${rel}: no template literal named ${name}`);
  assert.ok(!match[1].includes("${"), `${rel}: ${name} interpolates, so its text is not what the page gets`);
  return match[1];
}

/** `STATE_CLASS` from console-ui.tsx, read as text (the module is JSX, which node cannot load). */
function stateClasses(): Record<CellState, string> {
  const src = read(CONSOLE_UI);
  const block = /STATE_CLASS: Record<CellState, string> = \{([^}]*)\}/.exec(src);
  assert.ok(block, `${CONSOLE_UI}: STATE_CLASS not found`);
  const out: Partial<Record<CellState, string>> = {};
  for (const m of block[1].matchAll(/([A-Z_]+):\s*"([a-z-]+)"/g)) out[m[1] as CellState] = m[2];
  for (const s of CELL_STATES) assert.ok(out[s], `STATE_CLASS has no class for ${s}`);
  return out as Record<CellState, string>;
}

/* ------------------------------------------------------------- CSS parse */

interface Rule {
  readonly selector: string;
  readonly body: string;
  /** The `@layer` the rule sits in, or null when unlayered. */
  readonly layer: string | null;
}

/** Top-level style rules with their layer context. The console uses no CSS nesting. */
function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const stack: (string | null)[] = [];
  let current: string | null = null;
  let buf = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = buf.trim();
      buf = "";
      if (prelude.startsWith("@")) {
        const layer = /^@layer\s+([\w-]+)/.exec(prelude);
        stack.push(current);
        current = layer ? layer[1] : current;
        i += 1;
        continue;
      }
      const end = src.indexOf("}", i);
      rules.push({ selector: prelude, body: src.slice(i + 1, end), layer: current });
      i = end + 1;
      continue;
    }
    if (ch === "}") {
      current = stack.pop() ?? null;
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  return rules;
}

const CONTROL_ELEMENT = /(^|[\s>+~(])(button|select|input|textarea)(?![\w-])/;
const OWNED_BY_A_STATE = /(^|;)\s*(background(-color|-image)?|box-shadow)\s*:/;

/* ------------------------------------------------------------- harness */

interface Swatch {
  readonly bg: string;
  readonly img: string;
  readonly shadow: string;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly transform: string;
  readonly width: number;
  readonly height: number;
}

const READ_SWATCH = `(el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { bg: cs.backgroundColor, img: cs.backgroundImage, shadow: cs.boxShadow, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, transform: cs.transform, width: r.width, height: r.height };
}`;

function gridHarness(layoutCss: string, panelCss: string, cls: Record<CellState, string>, light: boolean): string {
  const legend = CELL_STATES.map((s) => `<span><i class="rq-cell ${cls[s]}" data-legend="${s}"></i> ${s}</span>`).join("");
  const cells = CELL_STATES.map(
    (s) => `<td class="rq-gatecell"><button type="button" class="rq-cell ${cls[s]}" data-state="${s}" aria-label="${s}"></button></td>`,
  ).join("");
  const violation = `<td class="rq-gatecell"><button type="button" class="rq-cell ${cls.CURRENT} rq-violation" data-state="CURRENT" data-violation="1" aria-label="violation"></button></td>`;
  const zip = CELL_STATES.map((s) => `<span class="rq-cell ${cls[s]}" data-zip="${s}"></span>`).join(" ");
  return `<!doctype html><html lang="en"${light ? ' data-theme="light"' : ""}><head><meta charset="utf-8"><style>${layoutCss}</style></head><body>
<main class="admin readiness">
<style>${panelCss}</style>
<h2>Capabilities</h2>
<div class="rq-legend" aria-label="What the cell colours mean">${legend}</div>
<div class="rq-gridwrap"><table class="rq-grid"><thead><tr><th>Capability</th><th class="rq-gatecol">Gate</th></tr></thead><tbody>
<tr><td>Row</td>${cells}${violation}</tr></tbody></table></div>
<table class="rq-zip"><tbody><tr><td>${zip} complete</td></tr></tbody></table>
</main>
<script>window.__clicks = []; for (const b of document.querySelectorAll("button.rq-cell")) b.addEventListener("click", () => window.__clicks.push(b.dataset.state + (b.dataset.violation ? "+violation" : "")));</script>
</body></html>`;
}

async function measureGrid(page: Page): Promise<{
  legend: Record<string, Swatch>;
  buttons: Record<string, Swatch>;
  zip: Record<string, Swatch>;
  violation: Swatch;
}> {
  return page.evaluate(`(() => {
    const read = ${READ_SWATCH};
    const pick = (sel, key) => Object.fromEntries([...document.querySelectorAll(sel)].map((el) => [el.dataset[key], read(el)]));
    return {
      legend: pick("i.rq-cell[data-legend]", "legend"),
      buttons: pick("button.rq-cell[data-state]:not([data-violation])", "state"),
      zip: pick("span.rq-cell[data-zip]", "zip"),
      violation: read(document.querySelector("button.rq-cell[data-violation]")),
    };
  })()`) as Promise<{ legend: Record<string, Swatch>; buttons: Record<string, Swatch>; zip: Record<string, Swatch>; violation: Swatch }>;
}

const TRANSPARENT = /^rgba\(\d+, \d+, \d+, 0\)$|^transparent$/;

/** A swatch is visible when it paints a fill, a gradient, or (an empty box) a rim. */
function visible(s: Swatch): boolean {
  return !TRANSPARENT.test(s.bg) || s.img !== "none" || s.shadow !== "none";
}

/** The check the positive control must be able to fail: every state, on a button, visible, distinct, equal to its legend. */
function checkStates(m: Awaited<ReturnType<typeof measureGrid>>, theme: string): void {
  const seen = new Map<string, CellState>();
  for (const s of CELL_STATES) {
    const button = m.buttons[s];
    const legend = m.legend[s];
    assert.ok(button && legend, `${theme}: ${s} did not render both a button cell and a legend swatch`);
    assert.ok(visible(button), `${theme}: the ${s} button cell paints nothing (bg ${button.bg}, image ${button.img}, shadow ${button.shadow})`);
    assert.ok(button.width >= 12 && button.height >= 12, `${theme}: the ${s} button cell is ${button.width}×${button.height}px — not a box`);
    assert.equal(button.bg, legend.bg, `${theme}: ${s} button background differs from its legend swatch`);
    assert.equal(button.img, legend.img, `${theme}: ${s} button background-image differs from its legend swatch`);
    assert.equal(button.shadow, legend.shadow, `${theme}: ${s} button rim differs from its legend swatch`);
    assert.equal(m.zip[s].bg, legend.bg, `${theme}: the zip-table ${s} swatch differs from the legend`);
    const key = `${button.bg}|${button.img}`;
    const twin = seen.get(key);
    assert.equal(twin, undefined, `${theme}: ${s} and ${twin} render alike (${key})`);
    seen.set(key, s);
  }
  // NOT_WALKED is an empty box on purpose (no claim is made) — the rim is what makes it a box.
  assert.ok(TRANSPARENT.test(m.buttons.NOT_WALKED.bg) && m.buttons.NOT_WALKED.shadow !== "none", `${theme}: NOT_WALKED must be an empty box with a visible rim`);
}

/* ------------------------------------------------------------- the browser */

let browser: GuardedBrowser | null = null;
before(async () => {
  browser = await launchGuarded({ label: "admin-readiness-cell-state" });
});
after(async () => {
  await browser?.close();
});

async function openHarness(html: string): Promise<Page> {
  assert.ok(browser, "no browser");
  const page = await browser.page({ viewport: { width: 900, height: 700 } });
  await page.setContent(html, { waitUntil: "load" });
  return page;
}

/* ------------------------------------------------------------- 1 + 2 */

test("the six cell states are one class each, and the grid renders them on a <button>", () => {
  const cls = stateClasses();
  assert.equal(new Set(Object.values(cls)).size, CELL_STATES.length, "two states share a class");
  const panel = read(PANEL);
  assert.match(panel, /<button\s[^>]*className=\{`rq-cell \$\{STATE_CLASS\[cell\.state\]\}/, "the grid cell is no longer a button carrying its state class");
  assert.match(panel, /" rq-violation"/, "the monotonicity violation class left the grid cell");
});

for (const theme of ["dark", "light"] as const) {
  test(`SEEDED (#281): a clickable rq-cell renders a visible, distinct state box for all six states — ${theme}`, async () => {
    const page = await openHarness(gridHarness(styleLiteral(LAYOUT, "STYLES"), styleLiteral(PANEL_STYLES, "READINESS_STYLES"), stateClasses(), theme === "light"));
    try {
      checkStates(await measureGrid(page), theme);
    } finally {
      await page.close();
    }
  });
}

test("a monotonicity-violation ring survives on a button cell, over the state fill", async () => {
  const page = await openHarness(gridHarness(styleLiteral(LAYOUT, "STYLES"), styleLiteral(PANEL_STYLES, "READINESS_STYLES"), stateClasses(), false));
  try {
    const m = await measureGrid(page);
    assert.equal(m.violation.bg, m.legend.CURRENT.bg, "the violation cell lost its state fill");
    assert.match(m.violation.shadow, /rgb\(204, 75, 75\)/, `the violation ring is not drawn: ${m.violation.shadow}`);
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------- 3 */

test("a cell is keyboard-operable, and its focus ring does not erase the state box", async () => {
  const page = await openHarness(gridHarness(styleLiteral(LAYOUT, "STYLES"), styleLiteral(PANEL_STYLES, "READINESS_STYLES"), stateClasses(), false));
  try {
    const rest = await measureGrid(page);
    // Keyboard focus, so :focus-visible is what a keyboard user gets.
    await page.keyboard.press("Tab");
    const focused = (await page.evaluate(`(() => { const el = document.activeElement; const read = ${READ_SWATCH}; return el && el.matches("button.rq-cell") ? { state: el.dataset.state, ...read(el) } : null; })()`)) as (Swatch & { state: string }) | null;
    assert.ok(focused, "Tab did not reach a cell button — the cell is not focusable");
    assert.equal(focused.state, "CURRENT");
    const ringByOutline = focused.outlineStyle !== "none" && focused.outlineWidth !== "0px";
    const ringByShadow = focused.shadow !== rest.buttons.CURRENT.shadow;
    assert.ok(ringByOutline || ringByShadow, `no visible focus indicator on the focused cell (outline ${focused.outlineStyle} ${focused.outlineWidth}, shadow ${focused.shadow})`);
    assert.equal(focused.bg, rest.buttons.CURRENT.bg, "the focus ring erased the state box");
    assert.equal(focused.img, rest.buttons.CURRENT.img, "the focus ring erased the state pattern");

    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.click('button.rq-cell[data-state="BLOCKED"]');
    const clicks = (await page.evaluate("window.__clicks")) as string[];
    assert.deepEqual(clicks, ["CURRENT", "CURRENT", "BLOCKED"], "Enter, Space and a click must each activate the cell");

    await page.hover('button.rq-cell[data-state="BLOCKED"]');
    const hovered = (await page.evaluate(`(${READ_SWATCH})(document.querySelector('button.rq-cell[data-state="BLOCKED"]'))`)) as Swatch;
    assert.equal(hovered.bg, rest.buttons.BLOCKED.bg, "hover erased the state box");
    assert.notEqual(hovered.transform, "none", "the cell has no hover affordance");
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------- 4 */

test("every generic control reset lives in the recipe layer; the state classes never do", () => {
  const layout = parseRules(styleLiteral(LAYOUT, "STYLES"));
  const panel = parseRules(styleLiteral(PANEL_STYLES, "READINESS_STYLES"));
  const recipe = layout.find((r) => /^\.admin button, \.console-nav button$/.test(r.selector));
  assert.ok(recipe, "the console button recipe is gone");
  assert.equal(recipe.layer, RECIPE_LAYER, `the button recipe must live in @layer ${RECIPE_LAYER}`);

  const escaped: string[] = [];
  for (const rule of [...layout, ...panel]) {
    if (rule.layer === RECIPE_LAYER) continue;
    const touchesAControl = rule.selector.split(",").some((s) => CONTROL_ELEMENT.test(s.trim()));
    if (touchesAControl && OWNED_BY_A_STATE.test(rule.body)) escaped.push(rule.selector);
  }
  assert.deepEqual(
    escaped,
    [],
    `an element-level control rule outside @layer ${RECIPE_LAYER} declares a background or box-shadow — the property a state class owns. Move it into the layer.`,
  );

  const cls = stateClasses();
  for (const sel of [".admin .rq-cell", ".admin .rq-violation", ...CELL_STATES.map((s) => `.admin .${cls[s]}`)]) {
    const rule = layout.find((r) => r.selector === sel);
    assert.ok(rule, `${sel} is not declared in the console stylesheet`);
    assert.equal(rule.layer, null, `${sel} must stay unlayered so no recipe can outrank it`);
  }
});

/* ------------------------------------------------------------- 5 */

function controlsHarness(layoutCss: string, panelCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${layoutCss}</style></head><body>
<nav class="console-nav"><label>View<select data-ctl="console-select"><option>Pilot health</option></select></label><button type="button" class="icon-btn" data-ctl="theme-toggle" aria-label="Switch">t</button></nav>
<main class="admin readiness console-page">
<style>${panelCss}</style>
<div class="ph-cards"><div class="ph-card card ph-l-GREEN" data-band="GREEN"><h3>Contract <span class="ph-chip">GREEN</span></h3><details class="ph-evidence" open><summary data-ctl="summary">Instrument detail</summary><p class="note">x <button type="submit" class="queue-add compact" data-ctl="queue-add-in-card">Add this to the queue</button></p></details></div></div>
<div class="runner-card card l-RED" data-band="RED"><p>Runner</p><form><input type="text" data-ctl="text" aria-label="why"><button type="submit" class="primary" data-ctl="primary">Record</button></form></div>
<div class="deploy"><div class="actions"><button type="button" class="primary" data-ctl="deploy">Deploy fleet</button></div></div>
<section class="queue-card card"><div class="options"><form><button type="submit" class="option" data-ctl="option">Option<span class="consequence">consequence</span></button></form><form class="own-words"><label>Own words<textarea data-ctl="textarea"></textarea></label></form></div></section>
<p class="note">gap <button type="submit" class="queue-add compact" data-ctl="queue-add">Add this to the queue</button></p>
<div class="rq-controls"><label>Level<select data-ctl="rq-select"><option>All levels</option></select></label></div>
<div class="rq-gridwrap"><table class="rq-grid"><tbody><tr><td class="rq-gatecell"><button type="button" class="rq-cell rq-partial" data-ctl="rq-cell" aria-label="cell"></button></td></tr></tbody></table></div>
<table class="rq-zip"><thead><tr><th><button type="button" data-ctl="zip-sort" aria-pressed="true">Zip</button></th></tr></thead></table>
<form class="deploy-here"><button type="submit" class="primary" data-ctl="deploy-here">Deploy fleet here</button></form>
<a href="#x" data-ctl="link">Instrument detail</a>
<button type="button" data-ctl="plain">Plain</button>
<div class="rq-drawer"><button type="button" class="rq-drawer-close" data-ctl="drawer-close">Close</button></div>
</main></body></html>`;
}

const READ_FOCUS = `(el) => { const cs = getComputedStyle(el); return { ctl: el.dataset.ctl, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow, bg: cs.backgroundColor }; }`;

test("class-wide: every focusable console control shows a keyboard focus indicator", async () => {
  const page = await openHarness(controlsHarness(styleLiteral(LAYOUT, "STYLES"), styleLiteral(PANEL_STYLES, "READINESS_STYLES")));
  try {
    const rest = (await page.evaluate(`[...document.querySelectorAll("[data-ctl]")].map(${READ_FOCUS})`)) as { ctl: string; outlineStyle: string; outlineWidth: string; shadow: string }[];
    const expected = rest.map((r) => r.ctl);
    const seen = new Map<string, { outlineStyle: string; outlineWidth: string; shadow: string }>();
    for (let i = 0; i < 40 && seen.size < expected.length; i += 1) {
      await page.keyboard.press("Tab");
      const f = (await page.evaluate(`(() => { const el = document.activeElement; return el && el.dataset && el.dataset.ctl ? (${READ_FOCUS})(el) : null; })()`)) as { ctl: string; outlineStyle: string; outlineWidth: string; shadow: string } | null;
      if (f && !seen.has(f.ctl)) seen.set(f.ctl, f);
    }
    const unreached = expected.filter((c) => !seen.has(c));
    assert.deepEqual(unreached, [], "Tab never reached these controls");
    const blind: string[] = [];
    for (const r of rest) {
      const f = seen.get(r.ctl)!;
      const byOutline = f.outlineStyle !== "none" && f.outlineWidth !== "0px";
      const byShadow = f.shadow !== r.shadow;
      if (!byOutline && !byShadow) blind.push(`${r.ctl} (outline ${f.outlineStyle} ${f.outlineWidth}; shadow unchanged: ${f.shadow})`);
    }
    assert.deepEqual(blind, [], "these controls show nothing when focused from the keyboard");
  } finally {
    await page.close();
  }
});

test("class-wide: a health card's grade band keeps its colour on hover and while focus is inside it", async () => {
  const page = await openHarness(controlsHarness(styleLiteral(LAYOUT, "STYLES"), styleLiteral(PANEL_STYLES, "READINESS_STYLES")));
  try {
    const band = (sel: string) => page.evaluate(`getComputedStyle(document.querySelector('${sel}'), "::after").backgroundImage`) as Promise<string>;
    const GREEN = /rgb\(76, 154, 90\)/;
    const RED = /rgb\(204, 75, 75\)/;
    assert.match(await band(".ph-l-GREEN"), GREEN, "at rest, the GREEN band is not green");
    assert.match(await band(".runner-card.l-RED"), RED, "at rest, the RED band is not red");
    await page.hover(".ph-l-GREEN");
    assert.match(await band(".ph-l-GREEN"), GREEN, "hovering the card recoloured its grade band");
    await page.hover(".runner-card.l-RED");
    assert.match(await band(".runner-card.l-RED"), RED, "hovering the runner card recoloured its grade band");
    await page.focus('[data-ctl="summary"]');
    assert.match(await band(".ph-l-GREEN"), GREEN, "focus inside the card recoloured its grade band");
    await page.focus('[data-ctl="text"]');
    assert.match(await band(".runner-card.l-RED"), RED, "focus inside the runner card recoloured its grade band");
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------- 6 */

test("POSITIVE CONTROL: re-appending the #281 reset makes the state check fail", async () => {
  const withReset = `${styleLiteral(LAYOUT, "STYLES")}\n${THE_281_RESET}\n`;
  const page = await openHarness(gridHarness(withReset, styleLiteral(PANEL_STYLES, "READINESS_STYLES"), stateClasses(), false));
  try {
    const m = await measureGrid(page);
    let failed = false;
    try {
      checkStates(m, "control");
    } catch {
      failed = true;
    }
    assert.ok(failed, "the checker passed with the #281 reset back in place, so it is not measuring the defect");
  } finally {
    await page.close();
  }
});
