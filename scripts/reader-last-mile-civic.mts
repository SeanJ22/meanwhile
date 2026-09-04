import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import { EVERYDAY_CONTACTS, EVERYDAY_TOPIC_IDS, EVERYDAY_ZIPS, EVERYDAY_MISSES, everydayContactsFor } from "../lib/routing/everyday.ts";
import { TOPIC_ROUTES } from "../lib/routing/topics.ts";
import { matchTopic } from "../lib/routing/match.ts";
import { answerQuestion } from "../lib/routing/ask.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const expectedContacts = EVERYDAY_CONTACTS.filter(row => row.verification === "PAGE_FETCHED");
floored("verified everyday contacts", "canonical EVERYDAY_CONTACTS", expectedContacts.length, EVERYDAY_CONTACTS.length);
const questions = EVERYDAY_TOPIC_IDS.map(topicId => {
  const topic = TOPIC_ROUTES.find(row => row.id === topicId)!;
  const question = `Who can help with ${topic.examples.join(" and ")}?`;
  assert.equal(matchTopic(question)?.topicId, topicId, question);
  return { topicId, question, topic };
});
const browser = await launchGuarded({ label: "reader-last-mile-civic" });
const records: unknown[] = [];
const encountered = new Set<number>();
const screenshots: string[] = [];
mkdirSync("screenshots/reader-last-mile", { recursive: true });
try {
  for (const zip of EVERYDAY_ZIPS) {
   for (const view of [{ name: "desktop", width: 1440, height: 1000, theme: "dark", all: true }, { name: "desktop", width: 1440, height: 1000, theme: "light", all: false }, { name: "phone", width: 390, height: 844, theme: "dark", all: false }, { name: "phone", width: 390, height: 844, theme: "light", all: false }]) {
    const context = await browser.context({ viewport: { width: view.width, height: view.height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    for (const label of ["Skip the tour", "No thanks"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      await page.addLocatorHandler(button, async () => { await button.click(); });
    }
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const input = page.locator(".welcome-overlay input").first();
    await input.fill(zip); await input.press("Enter");
    await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached" });
    if (((await page.locator("html").getAttribute("data-theme")) === "light" ? "light" : "dark") !== view.theme) {
      const switcher = page.getByRole("button", { name: `Switch to ${view.theme} mode`, exact: true }).first();
      if (!(await switcher.isVisible())) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await switcher.click();
    }
    const point = resolveZip(zip); assert.ok(point.ok);
    const response = await page.request.get(`${base}/api/meetings?${new URLSearchParams({ zip, lat: String(point.centroid.lat), lng: String(point.centroid.lng) })}`);
    assert.equal(response.status(), 200);
    const coverage = (await response.json()).coverage as CoverageSummary;
    assert.ok(coverage);
    await page.locator("[data-ask-pill]").first().click();
    const panel = page.locator("[data-ask-panel]");
    const box = panel.locator("[data-ask-box]");
    for (const { topicId, question, topic } of (view.all ? questions : questions.slice(0, 1))) {
      const expected = everydayContactsFor(topicId, zip);
      const canonical = answerQuestion(question, coverage, zip);
      assert.equal(canonical.answer.kind, "ROUTED");
      assert.deepEqual(canonical.contacts, expected);
      await box.fill(question);
      const answered = page.waitForResponse(r => new URL(r.url()).pathname === "/api/ask/grounded" && r.request().method() === "POST", { timeout: 90_000 });
      await box.press("Enter");
      const actualResponse = await answered;
      assert.equal(actualResponse.status(), 200);
      await panel.getByText(topic.label, { exact: true }).waitFor({ state: "visible" });
      assert.equal(await panel.locator('[data-ask-grounded-state="NOTHING_HELD"]').count(), 0, "The held civic answer must not be contradicted by an empty engine's absence sentence.");
      const text = normalize(await panel.innerText());
      for (const contact of expected) {
        const expectedFields = [contact.body, contact.service, contact.phone, contact.email, contact.note, `This was sourced from ${contact.sourceOrg}.`].filter((field): field is string => Boolean(field));
        for (const field of expectedFields) assert.ok(text.includes(normalize(field)), `${zip}/${topicId}: ${field}`);
        for (const href of [contact.phone && `tel:${contact.phone.replace(/[^\d+]/g, "")}`, contact.email && `mailto:${contact.email}`, contact.requestUrl].filter(Boolean)) {
          assert.ok(await panel.locator(`a[href="${href}"]`).count(), `${zip}/${topicId}: ${href}`);
        }
        const index = EVERYDAY_CONTACTS.indexOf(contact); encountered.add(index);
        records.push({ surface: "civic-routing", zip, viewport: view.name, theme: view.theme, topicId, canonicalRecordIndex: index, sourceUrl: contact.sourceUrl, sourceOrg: contact.sourceOrg, collectedAt: contact.collectedAt, verification: contact.verification, expectedFields, returnedFields: expectedFields, returnedContact: contact, question, canonicalAnswerSha256: hash(JSON.stringify(canonical)), renderedTextSha256: hash(text), grounding: "Exact curated topic/ZIP selector; all factual contact fields checked against its holding, independent of model response." });
      }
      if (!expected.length) {
        const miss = EVERYDAY_MISSES.find(row => row.topicId === topicId && row.zip === zip);
        assert.ok(miss, `${zip}/${topicId}: an empty contact cell requires a canonical recorded miss`);
        records.push({ surface: "civic-routing", zip, topicId, disposition: "SOURCE/HOLDING_UNAVAILABLE", reason: miss.reason, expectedCount: 0, returnedCount: 0 });
      }
      if (topicId === EVERYDAY_TOPIC_IDS[0]) {
        const path = `screenshots/reader-last-mile/${zip}-${view.name}-${view.theme}-civic.png`;
        await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path }); screenshots.push(path);
      }
    }
    await context.close();
    console.log(JSON.stringify({ zip, viewport: view.name, theme: view.theme, contactRecordsProved: encountered.size }));
   }
  }
} finally { await browser.close(); }
assert.equal(encountered.size, expectedContacts.length);
const sourcePaths = ["lib/routing/everyday.ts", "lib/routing/topics.ts", "lib/routing/ask.ts", "components/ask/ask-box.tsx"];
writeFileSync("docs/evidence/reader-last-mile-civic.json", JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(path, "utf8"))])), expectedCount: expectedContacts.length, renderedCount: encountered.size, records, screenshots }, null, 2) + "\n");
