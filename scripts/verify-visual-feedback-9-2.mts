/** Bounded rendered checks for the three remaining original feedback rows. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchGuarded } from "./browser.mts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "visual verification uses the isolated local server");
const out = process.env.VISUAL_FEEDBACK_OUTPUT ?? ".scratch/visual-feedback-final";
const rows = new Set((process.env.VISUAL_FEEDBACK_ROWS ?? "BAL-43,ASK-24,LAY-12").split(","));
assert.ok(rows.size > 0 && [...rows].every(row => ["BAL-43", "ASK-24", "LAY-12"].includes(row)), "select only the frozen feedback rows");
const expectedChecks = (rows.has("BAL-43") || rows.has("ASK-24") ? 6 : 0) + (rows.has("ASK-24") ? 1 : 0) + (rows.has("LAY-12") ? 4 : 0);
await mkdir(out, { recursive: true });
const browser = await launchGuarded({ label: "visual-feedback-9-2" });
const results: object[] = [];
const captures: string[] = [];

try {
  // BAL-43: all rendered office/candidate blocks on two current ballots,
  // using both source branches. Geometry, not source text, proves layout.
  for (const zip of rows.has("BAL-43") || rows.has("ASK-24") ? ["85701", "07866"] : []) {
    const page = await browser.page({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" });
    await page.goto(`${base}/ballot?zip=${zip}`, { waitUntil: "networkidle", timeout: 90_000 });
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      const reading = await page.locator(".ballot-office-list").evaluate((list) => {
        const offices = [...list.querySelectorAll<HTMLElement>(":scope > [data-contest-id]")];
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          offices: offices.map((office) => {
            const rect = office.getBoundingClientRect();
            const cards = [...office.querySelectorAll<HTMLElement>(".ballot-candidate-grid > li")].map((card) => {
              const r = card.getBoundingClientRect();
              return { id: card.dataset.candidateTarget, x: r.x, y: r.y, width: r.width };
            });
            return { id: office.dataset.contestId, x: rect.x, y: rect.y, bottom: rect.bottom, width: rect.width, cards };
          }),
        };
      });
      assert.ok(reading.offices.length > 1, `${zip}: office denominator is nonempty`);
      assert.ok(reading.overflow <= 1, `${zip}/${width}: no horizontal overflow`);
      const first = reading.offices[0];
      for (const [i, office] of reading.offices.entries()) {
        assert.equal(office.x, first.x, "offices share one left edge");
        assert.equal(office.width, first.width, "offices are full width");
        if (i) {
          const gap = office.y - reading.offices[i - 1].bottom;
          assert.ok(gap >= 0 && gap <= 24, `${office.id}: bounded office gap ${gap}`);
        }
        if (office.cards.length > 1) {
          const lefts = new Set(office.cards.map(card => Math.round(card.x)));
          assert.equal(lefts.size, width >= 1024 ? 2 : 1, `${office.id}: candidate columns at ${width}`);
          if (width >= 1024) assert.equal(office.cards[0].y, office.cards[1].y, "candidate row starts together");
        }
      }
      results.push({ row: "BAL-43", zip, width, ...reading });
      if (width !== 900) {
        await page.locator(".ballot-office-list").scrollIntoViewIfNeeded();
        await page.locator(".ballot-office-list > section").first().evaluate(el => el.scrollIntoView({ block: "start" }));
        const name = `BAL-43-${zip}-${width}.png`;
        await page.screenshot({ path: join(out, name) }); captures.push(name);
      }
    }
    if (zip === "85701" && rows.has("ASK-24")) {
      // ASK-24: the real route supplies the record; the shared component only
      // changes its presentation. No generated model answer supplies proof.
      await page.setViewportSize({ width: 900, height: 1000 });
      await page.locator(".ballot-ask-pill").click();
      await page.locator("[data-ask-input]").fill("Explain prop 141 to me");
      const response = page.waitForResponse(r => r.url().includes("/api/ask/grounded"));
      await page.locator("[data-ask-submit]").click();
      const payload = await (await response).json();
      assert.equal(payload.answer, null, "structured evidence path, not model synthesis");
      assert.equal(payload.contacts.length, 0, "no unrelated legislators");
      assert.ok(!payload.records.some((r: { kind: string }) => r.kind === "BALLOT_ABSENCE"), "no unrelated Senate absence");
      const summary = payload.records.find((r: { kind: string }) => r.kind === "MEASURE_SUMMARY");
      assert.ok(summary, "held plain-language summary retrieved");
      const lead = page.locator("[data-ask-measure-summary]");
      await lead.waitFor();
      assert.ok((await lead.innerText()).includes(summary.text));
      assert.equal(await page.locator("[data-ask-detail-count]").getAttribute("open"), null);
      const count = Number(await page.locator("[data-ask-record-count]").getAttribute("data-ask-record-count"));
      assert.equal(await page.locator("[data-ask-record-id]").count(), count);
      await page.locator("[data-ballot-ask]").scrollIntoViewIfNeeded();
      const name = "ASK-24-held-summary.png";
      await page.screenshot({ path: join(out, name) }); captures.push(name);
      await page.locator("[data-ask-detail-count] > summary").click();
      assert.equal(await page.locator("[data-ask-detail-count] li").count(), count - 1);
      results.push({ row: "ASK-24", summaryId: summary.id, recordCount: count, sourceUrl: summary.sourceUrl, contacts: payload.contacts.length });
    }
    await page.close();
  }

  // LAY-12: municipality, school and congressional boundaries share the same
  // responsive path. The actions select actual map geometry via its picker.
  const mapCases = [["85701", "MUNICIPAL", 900, "dark"], ["85701", "SCHOOL (UNIFIED)", 390, "light"], ["85701", "CONGRESSIONAL", 900, "light"], ["07866", "MUNICIPAL", 390, "dark"]] as const;
  for (const [zip, kind, width, theme] of rows.has("LAY-12") ? mapCases : []) {
    const context = await browser.context({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(`sessionStorage.setItem('wtp.approximate_location',JSON.stringify({zip:'${zip}',savedAt:new Date().toISOString()}));localStorage.setItem('wtp.tutorial_seen','1');localStorage.setItem('wtp.show_districts','1');localStorage.setItem('wtp.theme','${theme}');`);
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator(".notice-fab").click();
    await page.waitForFunction("window.__wtpMap?.isStyleLoaded()");
    const point = await page.evaluate(zip === "85701" ? "window.__wtpMap.project([-110.94,32.20])" : "window.__wtpMap.project(window.__wtpMap.getCenter())") as {x:number;y:number};
    await page.mouse.click(point.x, point.y);
    await page.locator(".district-picker-row").filter({ has: page.locator(".district-picker-type", { hasText: new RegExp(`^${kind.replace(/[()]/g, "\\$&")}$`, "i") }) }).click();
    await page.locator(".popup-card").waitFor();
    if (kind === "MUNICIPAL" && zip === "85701") {
      assert.equal(await page.locator(".coverage-notice").count(), 1, "desktop reference stays open");
      const name = "LAY-12-desktop-reference.png";
      await page.screenshot({ path: join(out, name) }); captures.push(name);
    }
    await page.setViewportSize({ width, height: 1000 });
    const pill = page.locator("[data-boundary-details]");
    await pill.waitFor();
    const identity = await pill.getAttribute("data-boundary-details");
    assert.equal(await page.locator(".coverage-notice,.popup-card").count(), 0, "both cards collapsed");
    assert.equal(await page.locator(".boundary-info-pill").count(), 2, "both details remain reachable");
    const stack = await page.locator(".boundary-info-pill").evaluateAll(pills => pills.map(el => {
      const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }));
    assert.ok(stack[1].top >= stack[0].bottom, "compact pills occupy separate rows");
    assert.ok(stack.every(r => r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= 1000), "both pills remain inside the viewport");
    assert.equal(await pill.evaluate(el => getComputedStyle(el).animationName), "none", "reduced motion is respected");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await pill.evaluate(el => getComputedStyle(el).animationDuration), "1.5s", "requested glow period");
    const name = `LAY-12-${zip}-${kind.split(" ")[0].toLowerCase()}-${width}-${theme}.png`;
    await page.screenshot({ path: join(out, name) }); captures.push(name);
    await pill.click();
    await page.locator(".popup-card").waitFor();
    assert.equal(await page.locator(".coverage-notice").count(), 0);
    await page.getByRole("button", { name: "Minimize district details" }).click();
    assert.equal(await pill.getAttribute("data-boundary-details"), identity, "minimize preserves selected identity");
    await page.getByRole("button", { name: "Show who governs here" }).click();
    await page.locator(".coverage-notice").waitFor();
    assert.equal(await page.locator(".popup-card").count(), 0, "only one detail panel opens");
    await page.getByRole("button", { name: "Minimize — the card stays one tap away" }).click();
    assert.equal(await pill.getAttribute("data-boundary-details"), identity);
    results.push({ row: "LAY-12", zip, kind, width, theme, identity, defaultPills: 2, singlePanel: true, reducedMotion: true, glowSeconds: 1.5 });
    await context.close();
  }
  const checked = floored("visual feedback checks", "selected frozen feedback rows", expectedChecks, results.length);
  assert.equal(results.length, expectedChecks, "every selected visual check reported");
  await writeFile(join(out, "results.json"), JSON.stringify({ base, runId: browser.runId, results, captures }, null, 2) + "\n");
  console.log(floorLine(checked));
  console.log(JSON.stringify({ result: "PASS", checks: results.length, captures, out }));
} finally { await browser.close(); }
