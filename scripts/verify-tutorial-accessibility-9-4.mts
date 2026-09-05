/** Local-only proof of the approved tutorial and boundary controls. No model calls. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { launchGuarded } from "./browser.mts";

const base = process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3244";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Local app only");
const output = resolve(".scratch/tester-tutorial-accessibility");
mkdirSync(output, { recursive: true });
const browser = await launchGuarded({ label: "tester-tutorial-accessibility-9-4", headless: true });
const results: Record<string, unknown>[] = [];
const expectedSteps = ["Ask", "Who Governs Here", "Local / State / Federal", "Boundary lines"];

try {
  for (const scenario of [
    { name: "desktop-dark", theme: "dark", width: 1366, height: 900, reducedMotion: "no-preference" },
    { name: "compact-light", theme: "light", width: 390, height: 844, reducedMotion: "reduce" },
  ] as const) {
    console.log(`Checking ${scenario.name}`);
    const page = await browser.page({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.reducedMotion });
    page.setDefaultTimeout(20_000);
    // Session orientation has already been entered; tutorial starts only after
    // that entry. Never pre-populate the seen flag or boundary preferences.
    await page.addInitScript(`sessionStorage.setItem("wtp.approximate_location", JSON.stringify({zip:"85701",savedAt:new Date().toISOString()})); localStorage.setItem("wtp.theme", ${JSON.stringify(scenario.theme)});`);
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const dialog = page.getByRole("dialog", { name: "Ask", exact: true });
    await dialog.waitFor({ state: "visible" });
    assert.equal(await page.locator("dialog:modal").count(), 1, "Native modal makes background inert");
    const tour = page.locator("dialog:modal");
    const insideViewport = await tour.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    });
    assert.equal(insideViewport, true, "Tour fits its layout");
    for (let tab = 0; tab < 10; tab++) {
      await page.keyboard.press(tab % 2 ? "Shift+Tab" : "Tab");
      assert.equal(await tour.evaluate((element) => element.contains(document.activeElement)), true, "Focus remains in tour");
    }
    if (scenario.reducedMotion === "reduce") {
      const animations = await tour.locator("[data-preview], [data-preview] *").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
      assert.ok(animations.every((name) => name === "none"), "Preview respects reduced motion");
    }
    // Being shown the tour is sufficient: an unfinished first visit must not
    // restart it on reload. The active walk stays open after that flag writes.
    assert.equal(await page.evaluate(() => localStorage.getItem("wtp.tutorial_seen")), "1", "First display is persisted before dismissal");
    await tour.getByRole("button", { name: "Next", exact: true }).click();
    assert.equal(await tour.locator("h2").innerText(), "Who Governs Here");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.locator(".filters-title").waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const control = document.querySelector<HTMLButtonElement>('[aria-label="Replay quick tour"]');
      return control && !control.disabled;
    });
    await page.locator('dialog[data-tour-ready="true"]').waitFor({ state: "attached" });
    const openMenu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await openMenu.isVisible()) await openMenu.click();
    const replay = page.getByRole("button", { name: "Replay quick tour", exact: true });
    await replay.waitFor({ state: "visible" });
    assert.equal(await page.locator("dialog:modal").count(), 0, "Reloading midway through the first tour does not show it again");
    assert.equal(await page.locator(".filters-title").getAttribute("aria-expanded"), "false");

    // Every step is skippable, every replay starts at Ask, and nothing here
    // operates a map preference on the reader's behalf.
    for (let skipAt = 0; skipAt < expectedSteps.length; skipAt++) {
      await replay.click();
      await page.getByRole("dialog", { name: "Ask", exact: true }).waitFor({ state: "visible" }).catch(async (error: unknown) => {
        console.error(JSON.stringify({ scenario: scenario.name, skipAt, dialog: await page.locator("dialog").evaluateAll((elements) => elements.map((element) => ({ open: (element as HTMLDialogElement).open, ready: element.getAttribute("data-tour-ready"), requested: element.getAttribute("data-tour-requested"), text: element.textContent?.slice(0, 280) }))), map: await page.evaluate(() => {
          const map = (window as unknown as { __wtpMap?: { isMoving: () => boolean; loaded: () => boolean; areTilesLoaded: () => boolean } }).__wtpMap;
          return map ? { moving: map.isMoving(), loaded: map.loaded(), tiles: map.areTilesLoaded() } : null;
        }) }));
        throw error;
      });
      for (let step = 0; step < skipAt; step++) await tour.getByRole("button", { name: "Next", exact: true }).click();
      assert.equal(await tour.locator("h2").innerText(), expectedSteps[skipAt]);
      if (skipAt === 3) await page.screenshot({ path: resolve(output, `tutorial-${scenario.name}.png`), animations: "disabled" });
      await tour.getByRole("button", { name: "Skip", exact: true }).click();
      await page.locator("dialog:modal").waitFor({ state: "hidden" });
      assert.equal(await replay.evaluate((element) => element === document.activeElement), true, "Focus returns to replay control");
    }
    await replay.click();
    await page.getByRole("dialog", { name: "Ask", exact: true }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("dialog:modal").waitFor({ state: "hidden" });
    await replay.click();
    await page.getByRole("dialog", { name: "Ask", exact: true }).waitFor({ state: "visible" });
    await tour.getByRole("button", { name: "Skip the tour", exact: true }).click();
    await replay.click();
    await page.getByRole("dialog", { name: "Ask", exact: true }).waitFor({ state: "visible" });
    for (const title of expectedSteps) {
      assert.equal(await tour.locator("h2").innerText(), title);
      await tour.getByRole("button", { name: title === "Boundary lines" ? "Done" : "Next", exact: true }).click();
    }
    await page.locator("dialog:modal").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".filters-title").getAttribute("aria-expanded"), "false", "Tour did not open filters");
    await page.locator(".filters-title").click();
    const master = page.getByRole("checkbox", { name: "Show districts", exact: true });
    assert.equal(await master.isChecked(), true, "New-reader boundaries remain ON");
    const districtGroup = page.locator(".filter-group").filter({ hasText: "District types" });
    await districtGroup.getByRole("button", { name: /District types/ }).click();
    assert.equal(await districtGroup.getByRole("checkbox").count(), 8);
    for (const checkbox of await districtGroup.getByRole("checkbox").all()) assert.equal(await checkbox.isChecked(), true);
    // The switch uses an intentionally transparent native checkbox and a
    // visible styled track. Exercise its keyboard path, not a forced click.
    await master.focus();
    await page.keyboard.press("Space");
    assert.equal(await master.isChecked(), false);
    await page.keyboard.press("Space");
    assert.equal(await master.isChecked(), true);
    const legend = page.locator("[data-boundary-legend]");
    const legendDoor = legend.locator("summary");
    await legendDoor.focus();
    await page.keyboard.press("Enter");
    assert.equal(await legend.evaluate((element) => (element as HTMLDetailsElement).open), true);
    const patterns = await legend.locator("svg line").evaluateAll((lines) => lines.map((line) => line.getAttribute("stroke-dasharray")));
    assert.equal(patterns.length, 8);
    assert.equal(new Set(patterns).size, 8, "Key is distinguishable without hue");
    if (scenario.name === "compact-light") {
      await legend.scrollIntoViewIfNeeded();
      await page.addStyleTag({ content: "[data-boundary-legend] svg { filter: grayscale(1); }" });
      await page.screenshot({ path: resolve(output, "boundary-key-compact-light-monochrome.png"), animations: "disabled" });
    }
    await legendDoor.focus();
    await page.keyboard.press("Escape");
    assert.equal(await legend.evaluate((element) => (element as HTMLDetailsElement).open), false);
    results.push({ scenario: scenario.name, firstVisit: true, seenOnFirstDisplay: true, midWalkReloadSuppressed: true, returningVisitSuppressed: true, approvedSteps: expectedSteps, skipAtEveryStep: true, replay: true, escapeAndClose: true, focusTrapAndReturn: true, fitsViewport: insideViewport, reducedMotion: scenario.reducedMotion, allEightBoundaryTypesOn: true, filtersInitiallyCollapsed: true, toggleRoundTrip: true, keyboardLegend: true, uniqueNonHuePatterns: patterns.length });
    await page.close();
  }
  // This is the intended V94-F8 population, not the number of cases that
  // happened to execute. Missing, duplicate or unexpected scenarios must fail.
  const scenarioProof = floored("tutorial/accessibility scenarios passed", "V94-F8 desktop dark and compact light", 2, results.length);
  assert.equal(scenarioProof.matched, scenarioProof.denominator, "Both required layouts must finish every assertion");
  assert.deepEqual(results.map((result) => result.scenario), ["desktop-dark", "compact-light"], "Each required layout must run exactly once");
  const receipt = { runId: browser.runId, base, scenarioProof, results, screenshots: ["tutorial-desktop-dark.png", "tutorial-compact-light.png", "boundary-key-compact-light-monochrome.png"], productionWrites: 0, modelCalls: 0 };
  writeFileSync(resolve(output, "proof.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(floorLine(scenarioProof));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
