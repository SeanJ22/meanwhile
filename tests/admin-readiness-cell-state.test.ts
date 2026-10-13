import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import type { Page } from "playwright";
import { launchGuarded, type GuardedBrowser } from "../scripts/browser.mts";

const css = readFileSync("app/(admin)/_mw/admin-v6/v6.module.css", "utf8");
let browser: GuardedBrowser;
before(async () => { browser = await launchGuarded({ label: "Admin Settings focus and status colors" }); });
after(async () => { await browser?.close(); });

/** Current Settings controls use this stylesheet and inherit the command center's theme tokens. */
function settingsHarness(styles = css): string {
  return `<!doctype html><html lang="en"><head><style>
:root { --ring: #55d4cf; --bg: #10151c; --text: #edf3fa; --surface: #18212c; --text-dim: #abc; --font-sans: system-ui; }
${styles}</style></head><body><main class="root"><section class="card">
<details open><summary data-ctl="worker">Scout instructions</summary>
<label>Instructions<textarea class="textarea" data-ctl="instructions">Read the saved pages.</textarea></label>
<label>Note<input class="input" data-ctl="note"></label>
<button class="btn" data-ctl="save">Save</button><button class="btn" data-ctl="undo">Undo</button>
<details><summary data-ctl="history">Earlier instructions</summary><p>Previous text</p></details></details>
<details><summary data-ctl="safety">Required safety rules (read only)</summary><p>Use provided tools.</p></details>
<div class="stack"><strong>Ask reader model</strong><span class="pill toneWarn">Waiting to reach readers</span>
<label><input type="radio" name="model" checked data-ctl="model">Claude Haiku 5.5</label>
<button class="btn" data-ctl="model-save">Save</button><a href="/admin?view=settings" data-ctl="readback">Read back</a></div>
</section></main></body></html>`;
}
async function openHarness(styles = css): Promise<Page> {
  const page = await browser.page({ viewport: { width: 900, height: 700 } });
  await page.setContent(settingsHarness(styles), { waitUntil: "load" });
  return page;
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

test("every current Settings control shows a keyboard focus indicator", async () => {
  const page = await openHarness();
  try {
    const { unreached, blind } = await focusBlindControls(page);
    assert.deepEqual(unreached, [], "Tab must reach the instructions, log, undo, and model controls");
    assert.deepEqual(blind, [], "Each reached control must show its keyboard focus");
  } finally { await page.close(); }
});

test("removing Settings focus indicators is caught by the browser check", async () => {
  const page = await openHarness(`${css}\n.root :where(button, input, textarea):focus-visible { outline: none; }`);
  try {
    const { blind } = await focusBlindControls(page);
    assert.ok(blind.some(item => item.startsWith("save")), blind.join("; "));
    assert.ok(blind.some(item => item.startsWith("instructions")), blind.join("; "));
  } finally { await page.close(); }
});

test("Settings publication status keeps its colors while a card is hovered or a control is focused", async () => {
  const page = await openHarness();
  try {
    const colors = () => page.locator(".toneWarn").evaluate(el => {
      const style = getComputedStyle(el); return [style.color, style.backgroundColor, style.borderColor];
    });
    const before = await colors();
    assert.notEqual(before[1], "rgba(0, 0, 0, 0)");
    await page.hover(".card");
    assert.deepEqual(await colors(), before);
    await page.getByRole("button", { name: "Save", exact: true }).first().focus();
    assert.deepEqual(await colors(), before);
  } finally { await page.close(); }
});
