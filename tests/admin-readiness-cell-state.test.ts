import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { Page } from "playwright";

import { launchGuarded, type GuardedBrowser } from "../scripts/browser.mts";

/**
 * **A STATE SWATCH KEEPS ITS BOX; EVERY CONTROL SHOWS ITS FOCUS.** (Admin Pass
 * A, ADM-A1..A4, 2026-09-06; re-pointed for the Admin redesign, 2026-09-23.)
 *
 * ## What broke
 *
 * The State Readiness grid rendered one `button.rq-cell` per capability × gate,
 * carrying one of six state classes. The #281 restyle (Lumen Edge) added a
 * generic button recipe for the whole console and, to keep the cell out of it,
 * a reset that also cleared the cell's background and shadow. That selector
 * outranked the state class on specificity, so the grid rendered every state as
 * an empty box while the legend swatches — not buttons — kept theirs.
 *
 * ## The fix, and why it is a cascade fix rather than six overrides
 *
 * Every generic control recipe in the console (buttons, selects, inputs, cards,
 * element-level text rules) lives in `@layer ce-recipe`. Cascade layers are
 * ordered BEFORE specificity: an unlayered rule beats a layered one whatever its
 * selector. The state classes and the swatch geometry stay unlayered, so no
 * future recipe — however specific — can outrank them without moving them into
 * the layer, which the structural guard below refuses.
 *
 * ## Admin redesign, 2026-09-23
 *
 * The per-state readiness panel — its capability grid of button cells, its
 * legend, its violation ring and its own stylesheet — was removed; the
 * redesigned readiness page draws its readings with the shell's primitives.
 * The rendered checks on those cells are retired with it. What still holds:
 *
 *   1  every generic control reset in the console stylesheet (which the pages
 *      that kept their content still wear) is inside the recipe layer, and the
 *      swatch classes still drawn — a health grade beside its word — are not;
 *      a POSITIVE CONTROL re-appends the #281 reset and the check must fail
 *   2  class-wide: every focusable console control shows a keyboard focus
 *      indicator — on the kept pages, AND in the redesigned shell every Fleet
 *      and Readiness screen renders in
 *   3  class-wide: the runner card's grade band survives hover and
 *      focus-within (the health cards that shared the rule were removed)
 *
 * The harness is each stylesheet exactly as the page gets it (the console's
 * template literal; the shell's CSS module text, whose class names the harness
 * uses unhashed), around the markup shapes the pages render. It carries no
 * `globals.css`: the user-agent styles a control gets without preflight are
 * the harder case, not the easier one.
 */

const ROOT = process.cwd();
const LAYOUT = "app/(admin)/layout.tsx";
const SHELL_CSS = "app/(admin)/_mw/admin-v6/v6.module.css";
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

/** Element-level control rules outside the recipe layer that declare a property a state class owns. */
function escapedRecipes(css: string): string[] {
  const escaped: string[] = [];
  for (const rule of parseRules(css)) {
    if (rule.layer === RECIPE_LAYER) continue;
    const touchesAControl = rule.selector.split(",").some((s) => CONTROL_ELEMENT.test(s.trim()));
    if (touchesAControl && OWNED_BY_A_STATE.test(rule.body)) escaped.push(rule.selector);
  }
  return escaped;
}

/* ------------------------------------------------------------- 1 */

test("every generic control reset lives in the recipe layer; the state classes never do", () => {
  const css = styleLiteral(LAYOUT, "STYLES");
  const layout = parseRules(css);
  const recipe = layout.find((r) => /^\.admin button, \.console-nav button$/.test(r.selector));
  assert.ok(recipe, "the console button recipe is gone");
  assert.equal(recipe.layer, RECIPE_LAYER, `the button recipe must live in @layer ${RECIPE_LAYER}`);

  assert.deepEqual(
    escapedRecipes(css),
    [],
    `an element-level control rule outside @layer ${RECIPE_LAYER} declares a background or box-shadow — the property a state class owns. Move it into the layer.`,
  );
});

test("POSITIVE CONTROL: re-appending the #281 reset makes the structural check fail", () => {
  const withReset = `${styleLiteral(LAYOUT, "STYLES")}\n${THE_281_RESET}\n`;
  assert.deepEqual(escapedRecipes(withReset), [".admin button.rq-cell"], "the checker passed with the #281 reset back in place, so it is not measuring the defect");
});

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

/* ------------------------------------------------------------- 2 */

/** The controls the kept pages draw under the console stylesheet (research, sources, release review, the chat, feedback, the fleet map). */
function keptPagesHarness(layoutCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${layoutCss}</style></head><body>
<main class="admin console-page">
<section class="card runner-card l-RED" data-band="RED"><div class="status-block"><p class="status-what">Runner</p><details class="status-detail"><summary data-ctl="summary">Technical details</summary><p class="note">x</p></details></div></section>
<div class="controls-row"><span><button type="button" class="primary" data-ctl="primary">Pause research</button></span></div>
<p class="note">gap <button type="submit" class="queue-add compact" data-ctl="queue-add">Add this to the queue</button></p>
<form><label>Reason<input type="text" data-ctl="text"></label><label>Words<textarea data-ctl="textarea"></textarea></label><label>Page<select data-ctl="select"><option>1</option></select></label></form>
<a href="#x" data-ctl="link">Instrument detail</a>
<button type="button" data-ctl="plain">Plain</button>
</main></body></html>`;
}

/** The controls the redesigned shell draws: the header frame the kept pages carry, and a screen with every control shape the Fleet and Readiness areas use. */
function shellHarness(shellCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${shellCss}</style></head><body>
<div class="legacyFrame"><header class="legacyHeader"><a class="legacyBrand" href="/admin" data-ctl="frame-brand">Meanwhile</a><nav class="legacyAreaToggle"><a class="legacyAreaBtn" href="/admin" data-ctl="frame-area">Fleet</a></nav><div class="legacyHeaderRight"><button type="button" class="legacyOtherBtn" data-ctl="frame-other">Other pages</button></div></header></div>
<main class="legacyRoot">
<header class="legacyHeader"><nav class="legacyAreaToggle"><a class="legacyAreaBtn legacyAreaBtnOn" href="/admin" data-ctl="area">Fleet</a></nav><div class="legacyHeaderRight"><select class="legacySelect" data-ctl="scope"><option>Everywhere</option></select><button type="button" class="legacyOtherBtn" data-ctl="other">Other pages</button></div></header>
<nav class="legacyTabs"><a class="legacyTab legacyTabOn" href="/admin" data-ctl="tab">Now</a></nav>
<div class="legacyContainer"><div class="legacyCard">
<div class="legacyActions"><button type="button" class="legacyBtnPrimary" data-ctl="btn-primary">Do it</button><button type="button" class="legacyBtnSecondary" data-ctl="btn-secondary">Do not</button><button type="button" class="legacyBtnToggle" data-ctl="btn-toggle">Something else</button><button type="button" class="legacyBtnLink" data-ctl="btn-link">Open</button></div>
<textarea class="legacyTextarea" data-ctl="textarea"></textarea>
<button type="button" class="legacyChip" data-ctl="chip">Neither of these</button>
<button type="button" class="legacyRowChoice" data-ctl="row-choice">When my budget is reached</button>
<input class="legacyInput" data-ctl="input" value="0"><input class="legacyInputText" data-ctl="input-text">
<a class="legacyBtnPrimary" href="/admin/work" data-ctl="link-primary">Deploy fleet here</a>
<a class="legacyChip" href="/readiness/az?by=county" data-ctl="link-chip">County</a>
<a class="legacyLinkStrong" href="/readiness/az" data-ctl="link-strong">Arizona</a>
</div></div></main></body></html>`;
}

const READ_FOCUS = `(el) => { const cs = getComputedStyle(el); return { ctl: el.dataset.ctl, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow, bg: cs.backgroundColor }; }`;

/** Tab through every control and return the ones that show nothing when focused from the keyboard. */
async function focusBlindControls(page: Page): Promise<{ unreached: string[]; blind: string[] }> {
  const rest = (await page.evaluate(`[...document.querySelectorAll("[data-ctl]")].map(${READ_FOCUS})`)) as { ctl: string; outlineStyle: string; outlineWidth: string; shadow: string }[];
  const expected = rest.map((r) => r.ctl);
  const seen = new Map<string, { outlineStyle: string; outlineWidth: string; shadow: string }>();
  for (let i = 0; i < 60 && seen.size < expected.length; i += 1) {
    await page.keyboard.press("Tab");
    const f = (await page.evaluate(`(() => { const el = document.activeElement; return el && el.dataset && el.dataset.ctl ? (${READ_FOCUS})(el) : null; })()`)) as { ctl: string; outlineStyle: string; outlineWidth: string; shadow: string } | null;
    if (f && !seen.has(f.ctl)) seen.set(f.ctl, f);
  }
  const unreached = expected.filter((c) => !seen.has(c));
  const blind: string[] = [];
  for (const r of rest) {
    const f = seen.get(r.ctl);
    if (!f) continue;
    const byOutline = f.outlineStyle !== "none" && f.outlineWidth !== "0px";
    const byShadow = f.shadow !== r.shadow;
    if (!byOutline && !byShadow) blind.push(`${r.ctl} (outline ${f.outlineStyle} ${f.outlineWidth}; shadow unchanged: ${f.shadow})`);
  }
  return { unreached, blind };
}

test("class-wide: every focusable console control shows a keyboard focus indicator", async () => {
  // Admin redesign, 2026-09-23: the old header's View / State selects and theme switch, the health cards, the decision queue's option forms, the deploy control and the readiness panel's selects, cells, sort and drawer were removed; the harness draws the controls that remain, and the redesigned shell's.
  for (const [name, html] of [
    ["the pages that kept their content", keptPagesHarness(styleLiteral(LAYOUT, "STYLES"))],
    ["the redesigned shell", shellHarness(read(SHELL_CSS))],
  ] as const) {
    const page = await openHarness(html);
    try {
      const { unreached, blind } = await focusBlindControls(page);
      assert.deepEqual(unreached, [], `${name}: Tab never reached these controls`);
      assert.deepEqual(blind, [], `${name}: these controls show nothing when focused from the keyboard`);
    } finally {
      await page.close();
    }
  }
});

test("POSITIVE CONTROL: a shell control whose focus indicator is taken away is caught", async () => {
  const unfocused = `${read(SHELL_CSS)}\n.legacyRoot button:focus-visible, .legacyRoot select:focus-visible { outline: none; }\n`;
  const page = await openHarness(shellHarness(unfocused));
  try {
    const { blind } = await focusBlindControls(page);
    assert.ok(blind.some((b) => b.startsWith("btn-primary")) && blind.some((b) => b.startsWith("scope")), `the checker did not see the removed focus ring: ${blind.join("; ")}`);
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------- 3 */

test("class-wide: the runner card's grade band keeps its colour on hover and while focus is inside it", async () => {
  // Admin redesign, 2026-09-23: the Pilot health cards that shared this rule were removed; the research page's runner card still carries a grade band.
  const page = await openHarness(keptPagesHarness(styleLiteral(LAYOUT, "STYLES")));
  try {
    const band = (sel: string) => page.evaluate(`getComputedStyle(document.querySelector('${sel}'), "::after").backgroundImage`) as Promise<string>;
    const RED = /rgb\(204, 75, 75\)/;
    assert.match(await band(".runner-card.l-RED"), RED, "at rest, the RED band is not red");
    await page.hover(".runner-card.l-RED");
    assert.match(await band(".runner-card.l-RED"), RED, "hovering the runner card recoloured its grade band");
    await page.focus('[data-ctl="summary"]');
    assert.match(await band(".runner-card.l-RED"), RED, "focus inside the runner card recoloured its grade band");
  } finally {
    await page.close();
  }
});

// Admin redesign, 2026-09-23: the readiness grid's button cells, their six state boxes against the legend (dark and light), the violation ring and the cells' keyboard operation were removed with the per-state panel; the redesigned readiness page has no clickable state cell.
