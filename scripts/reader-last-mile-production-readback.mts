/**
 * Finite post-merge acceptance explicitly authorized by the reader-last-mile brief.
 * This is not walk:all: four named pilot locations, no reactions or acquisition,
 * synthetic request markers, and an exact deployed commit required before UI work.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Page, Locator } from "playwright";
import { launchGuarded } from "./browser.mts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { campaignMoneyApiAnswer, campaignMoneyForTarget } from "../lib/funding/campaign-money.ts";
import { stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";

const expectedCommit = process.env.READER_DEPLOYED_COMMIT ?? "";
assert.match(expectedCommit, /^[a-f0-9]{40}$/, "Set READER_DEPLOYED_COMMIT to the provider-confirmed merged commit");
const base = (process.env.READER_READBACK_BASE ?? PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
assert.ok(base === PUBLIC_SITE_ORIGIN || ["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only the canonical public origin or a local rehearsal is allowed");
const execution = base === PUBLIC_SITE_ORIGIN ? "EXPLICITLY_AUTHORIZED_PRODUCTION_READBACK" : "LOCAL_REHEARSAL";
const out = resolve(process.cwd(), "..", "reader-production-readback", `${expectedCommit}-${Date.now()}`);
mkdirSync(out, { recursive: true });
const pilots = [
  { zip: "85701", name: "Katie Hobbs", official: "statewide:az/governor", target: "ballot-az-pima:governor:hobbs-katie", raised: "$11,109,720", spent: "$14,355,613", meetingId: "legistar:pima:1825" },
  { zip: "85641", name: "Katie Hobbs", official: "statewide:az/governor", target: "ballot-az-pima:governor:hobbs-katie", raised: "$11,109,720", spent: "$14,355,613", meetingId: "apptegy:vail:60703698" },
  { zip: "07866", name: "Tayfun Selen", official: "roster:morris#6", target: "ballot-nj-morris:county-commissioner:selen", raised: "$225,026", spent: "$229,526", meetingId: "iqm2:morriscountynj:2236" },
  { zip: "03255", name: "Kelly Ayotte", official: "statewide:nh/governor", target: "ballot-nh-merrimack:governor:ayotte-kelly", raised: "$5,995,303", spent: "$3,276,135", meetingId: "diligent:newburynh:3367" },
] as const;
const browser = await launchGuarded({ label: "reader-last-mile-production-readback" });
const rows: unknown[] = [];
const requests: { method: string; path: string; status: number }[] = [];
const images: { path: string; sha256: string }[] = [];
const negativeIdentities: unknown[] = [];
let servedBuild: unknown = null;
function persist() {
  writeFileSync(join(out, "readback.json"), JSON.stringify({ execution, expectedCommit, origin: base, runId: browser.runId, servedBuild, rows, images, requests, negativeIdentities, organicReactions: 0 }, null, 2) + "\n");
}
async function capture(page: Page, label: string, focus?: Locator) {
  if (focus) await focus.scrollIntoViewIfNeeded();
  const path = join(out, `${label}.png`);
  await page.screenshot({ path });
  images.push({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
}
async function openSection(modal: Locator, label: string) {
  const button = modal.locator("button.card-section-header").filter({ has: modal.page().getByText(label, { exact: true }) });
  await button.waitFor({ state: "visible" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button.locator("..");
}
async function money(modal: Locator, pilot: typeof pilots[number]) {
  const section = await openSection(modal, "Campaign money");
  const record = section.locator("[data-state-money-targets]");
  await record.waitFor({ state: "visible" });
  const text = await record.innerText();
  assert.ok(text.includes(pilot.raised) && text.includes(pilot.spent), `${pilot.zip}: held amounts must render`);
  const targets = (await record.getAttribute("data-state-money-targets"))!.split(" ");
  assert.ok(targets.includes(pilot.target));
  return { section, text, targets, links: await record.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))), count: Number(await record.getAttribute("data-state-money-record-count")) };
}
try {
  for (const pilot of pilots) {
    const context = await browser.context({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    context.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === base && url.pathname.startsWith("/api/")) requests.push({ method: response.request().method(), path: `${url.pathname}${url.search}`, status: response.status() });
    });
    const buildResponse = await context.request.get(`${base}/api/build`);
    assert.equal(buildResponse.status(), 200);
    servedBuild = await buildResponse.json();
    assert.equal((servedBuild as { commit: string }).commit, expectedCommit, "Refuse a different deployed build");
    const fundingResponse = await context.request.get(`${base}/api/funding/${encodeURIComponent(pilot.official)}`);
    assert.equal(fundingResponse.status(), 200);
    const funding = await fundingResponse.json();
    assert.deepEqual(funding, JSON.parse(JSON.stringify(campaignMoneyApiAnswer(pilot.official))), "Deployed official money must equal the proved canonical answer");
    if (pilot.zip === "85701") {
      for (const target of ["ballot-az-pima:governor:biggs-andy", "roster:nj-morris-boonton#1", "congress:C001133"]) {
        const negativeResponse = await context.request.get(`${base}/api/funding/${encodeURIComponent(target)}`);
        assert.equal(negativeResponse.status(), 200);
        const actual = await negativeResponse.json();
        assert.deepEqual(actual, JSON.parse(JSON.stringify(campaignMoneyApiAnswer(target))));
        assert.ok(!JSON.stringify(actual).includes(pilot.target), "Another or unresolved identity must not inherit Hobbs money");
        negativeIdentities.push({ target, actual, result: "PASS" });
      }
    }
    for (const name of ["Skip the tour", "No thanks"]) {
      await page.addLocatorHandler(page.getByRole("button", { name, exact: true }), async () => { await page.getByRole("button", { name, exact: true }).click(); });
    }
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const zipInput = page.locator(".welcome-overlay input").first();
    await zipInput.fill(pilot.zip); await zipInput.press("Enter");
    await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached" });
    const doors = page.locator('button[aria-label*="officials list" i]').first();
    await doors.waitFor({ state: "visible" }); await doors.click();
    await page.locator(".door-panel button").filter({ hasText: pilot.name }).first().click();
    let modal = page.getByRole("dialog", { name: pilot.name, exact: true });
    if (!(await modal.isVisible())) {
      const more = page.getByRole("button", { name: /More|View Battlecard/i }).first();
      if (await more.isVisible()) await more.click();
    }
    await modal.waitFor({ state: "visible" });
    const mapMoney = await money(modal, pilot);
    await capture(page, `${pilot.zip}-map-money`, mapMoney.section);
    await page.keyboard.press("Escape");
    const meetingListButton = page.locator('[data-stat="meetings"]').first();
    if (!(await meetingListButton.isVisible())) {
      const menu = page.getByRole("button", { name: "Open menu", exact: true });
      if (await menu.isVisible()) await menu.click();
    }
    await meetingListButton.click();
    await page.getByRole("combobox", { name: "Group by", exact: true }).selectOption("none");
    while (await page.locator(".al-more").count()) await page.locator(".al-more").click();
    const statedMeetings = Number((await page.locator(".al-overlay-count").innerText()).split(" ")[0]);
    const meetingIds = await page.locator(".al-row[data-meeting-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-meeting-id")));
    assert.equal(meetingIds.length, statedMeetings);
    assert.ok(meetingIds.includes(pilot.meetingId));
    await capture(page, `${pilot.zip}-meetings`, page.locator(".al-row").first());
    const agendaResponse = await context.request.get(`${base}/api/agenda?meetingId=${encodeURIComponent(pilot.meetingId)}`);
    assert.equal(agendaResponse.status(), 200);
    const agenda = await agendaResponse.json();
    assert.equal(agenda.meetingId, pilot.meetingId);
    assert.equal(agenda.documentCount, agenda.documents.length);
    if (pilot.zip === "03255") assert.equal(agenda.publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
    await page.goto(`${base}/ballot?zip=${pilot.zip}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator(".candidate-row").filter({ hasText: pilot.name }).first().locator("[data-battlecard-pill]").click();
    modal = page.getByRole("dialog", { name: pilot.name, exact: true });
    await modal.waitFor({ state: "visible" });
    const candidateSubject = await modal.locator("[data-candidate-subject]").getAttribute("data-candidate-subject");
    const ballotMoney = await money(modal, pilot);
    assert.deepEqual(ballotMoney.targets, mapMoney.targets);
    assert.equal(ballotMoney.count, mapMoney.count);
    assert.deepEqual(ballotMoney.links, mapMoney.links);
    await capture(page, `${pilot.zip}-ballot-money`, ballotMoney.section);
    await page.keyboard.press("Escape");
    await page.locator("[data-ballot-ask-pill]").click();
    const ask = page.locator("[data-ballot-ask]");
    const question = `How much campaign money has ${pilot.name} raised and spent?`;
    await ask.locator("[data-ask-input]").fill(question);
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/grounded" && response.request().method() === "POST", { timeout: 90_000 });
    await ask.locator("[data-ask-submit]").click();
    const response = await pending; assert.equal(response.status(), 200);
    const answer = await response.json();
    const financeRecords = answer.records.filter((record: { kind: string }) => record.kind === "FINANCE_SUMMARY");
    assert.ok(financeRecords.some((record: { canonicalSubjectId: string }) => record.canonicalSubjectId === pilot.target));
    const rendered = ask.locator("[data-ask-mode]");
    await rendered.waitFor({ state: "visible" });
    const disclosure = rendered.locator("[data-ask-record-count]");
    const expectedRecords = answer.records.filter((record: { kind: string }) => record.kind !== "CONTACT");
    assert.equal(Number(await disclosure.getAttribute("data-ask-record-count")), expectedRecords.length);
    assert.equal(await disclosure.locator("li[data-ask-record-id]").count(), expectedRecords.length);
    if ((await disclosure.getAttribute("open")) === null) await disclosure.locator("summary").click();
    const renderedText = await rendered.innerText();
    const links = await rendered.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    for (const record of stateMoneyRecordsForDisplay(campaignMoneyForTarget(pilot.target).state.records).filter(record => record.filingState === "FILED")) {
      for (const value of [record.totals.receipts, record.totals.expenditures]) {
        if (value === null) continue;
        const exact = `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        assert.ok(financeRecords.some((fact: { text: string }) => fact.text.includes(exact)));
        assert.ok(renderedText.includes(exact) || renderedText.includes(`$${Math.round(value).toLocaleString("en-US")}`));
      }
    }
    assert.ok(financeRecords.every((record: { sourceUrl: string | null }) => record.sourceUrl && links.includes(record.sourceUrl)));
    await capture(page, `${pilot.zip}-ask`, rendered);
    await capture(page, `${pilot.zip}-ask-tail`, disclosure.locator("li[data-ask-record-id]").last());
    rows.push({ zip: pilot.zip, result: "PASS", officialId: pilot.official, candidateSubject, canonicalCandidacyId: pilot.target, funding, mapMoney: { ...mapMoney, section: undefined }, ballotMoney: { ...ballotMoney, section: undefined }, statedMeetings, meetingIds, agenda, ask: { question, mode: answer.mode, trace: answer.trace, financeRecords, links, renderedRecordCount: expectedRecords.length, renderedText } });
    persist(); await context.close();
    console.log(JSON.stringify({ zip: pilot.zip, result: "PASS", statedMeetings, canonicalCandidacyId: pilot.target }));
  }
} finally { persist(); await browser.close(); }
assert.equal(rows.length, pilots.length);
console.log(JSON.stringify({ result: "PASS", expectedCommit, output: join(out, "readback.json"), runId: browser.runId, screenshots: images.length, recordedBrowserApiResponses: requests.length }));
