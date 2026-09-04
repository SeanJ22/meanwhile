/** Small final visual sample for only the post-checkpoint reader delta. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Locator, Page } from "playwright";
import { launchGuarded } from "./browser.mts";
import { campaignMoneyForTarget, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { meetingListingIdentity } from "../lib/meetings/listing-identity.ts";
import { formatMeetingDate } from "../lib/map/format.ts";
import type { Meeting } from "../lib/sources/types.ts";

const root = process.cwd();
const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-final-render.json";
const witnessPath = process.env.READER_WITNESS_OUTPUT ?? "docs/evidence/reader-last-mile-final-delta-witnesses.json";
const ballotEvidencePath = process.env.READER_BALLOT_EVIDENCE ?? "docs/evidence/reader-last-mile-final-ballot.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES;
assert.ok(proofSourcesPath, "The frozen final census source fingerprint is required");
const screenshotsDir = join(root, "screenshots", "reader-last-mile", "final");
mkdirSync(screenshotsDir, { recursive: true });
const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const snapshot = JSON.parse(readFileSync("data/meetings-snapshot.json", "utf8")) as { meetings: Meeting[] };
const results: Record<string, unknown>[] = [];
const screenshots: { path: string; sha256: string }[] = [];
const hashBytes = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

async function capture(locator: Locator, name: string) {
  const absolute = join(screenshotsDir, `${name}.png`);
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: absolute });
  const row = { path: relative(root, absolute).replaceAll("\\", "/"), sha256: hashBytes(absolute) };
  screenshots.push(row);
  return row;
}

async function openSection(modal: Locator, label: string) {
  const button = modal.locator("button.card-section-header").filter({ has: modal.page().getByText(label, { exact: true }) });
  await button.waitFor({ state: "visible", timeout: 20_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button.locator("..");
}

async function mapAt(page: Page, zip: string) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const input = page.locator(".welcome-overlay input").first();
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill(zip);
  await input.press("Enter");
  await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached", timeout: 30_000 });
  const tour = page.getByRole("button", { name: "Skip the tour", exact: true });
  if (await tour.isVisible().catch(() => false)) await tour.click();
  const narrowing = page.getByRole("button", { name: /No thanks|show me everything|Skip for now/i }).first();
  if (await narrowing.isVisible().catch(() => false)) await narrowing.click();
}

async function openOfficial(page: Page, name: string) {
  const doors = page.locator('button[aria-label*="officials list" i]').first();
  await doors.waitFor({ state: "attached", timeout: 30_000 });
  if (!(await doors.isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
  }
  if (!(await page.locator(".door-panel").isVisible().catch(() => false))) await doors.click();
  const named = page.locator(".door-panel button").filter({ hasText: name }).first();
  await named.waitFor({ state: "visible", timeout: 20_000 });
  await named.click();
  const modal = page.getByRole("dialog", { name, exact: true });
  if (!(await modal.isVisible().catch(() => false))) {
    const more = page.getByRole("button", { name: /More|View Battlecard/i }).first();
    if (await more.isVisible().catch(() => false)) await more.click();
  }
  await modal.waitFor({ state: "visible", timeout: 20_000 });
  return modal;
}

async function openBallotCandidate(page: Page, name: string) {
  const row = page.locator(".candidate-row").filter({ hasText: name }).first();
  await row.locator("[data-battlecard-pill]").click();
  const modal = page.getByRole("dialog", { name, exact: true });
  await modal.waitFor({ state: "visible", timeout: 20_000 });
  return modal;
}

async function inspectStateMoney(modal: Locator, target: string) {
  const eligible = stateMoneyRecordsForDisplay(campaignMoneyForTarget(target).state.records);
  assert.ok(eligible.length, `${target}: expected eligible state money`);
  const section = await openSection(modal, "Campaign money");
  const record = section.locator("[data-state-money-targets]");
  await record.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(Number(await record.getAttribute("data-state-money-record-count")), eligible.length);
  const text = normalize(await record.innerText());
  for (const row of eligible) {
    assert.ok((await record.getAttribute("data-state-money-targets"))?.split(" ").some((key) => row.targetKeys.includes(key)));
    for (const value of [row.totals.receipts, row.totals.expenditures]) if (value !== null && row.filingState === "FILED") {
      assert.ok(text.includes(`$${Math.round(value).toLocaleString("en-US")}`), `${target}: missing ${value}`);
    }
    assert.equal(await record.locator(`a[href="${row.provenance.sourceUrl}"]`).count(), 1, `${target}: provenance`);
  }
  return { section, text, records: eligible };
}

async function contextPage() {
  const context = await browser.context({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const tour = page.getByRole("button", { name: "Skip the tour", exact: true });
  await page.addLocatorHandler(tour, async () => { await tour.click(); });
  const address = page.getByRole("button", { name: "No thanks", exact: true });
  await page.addLocatorHandler(address, async () => { await address.click(); });
  return { context, page };
}

async function inspectMeeting(page: Page, meetingId: string) {
  const meeting = snapshot.meetings.find((row) => row.id === meetingId); assert.ok(meeting);
  const stat = page.locator('[data-stat="meetings"]').first();
  if (!(await stat.isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
  }
  await stat.click();
  await page.getByRole("combobox", { name: "Group by", exact: true }).selectOption("none");
  while (await page.locator(".al-more").count()) await page.locator(".al-more").click();
  const row = page.locator(`.al-row[data-meeting-id="${meetingId}"]`);
  assert.equal(await row.count(), 1, meetingId);
  await row.click();
  if (meeting.location) {
    const article = page.locator(`aside:visible article[data-meeting-id="${meetingId}"]`);
    await article.waitFor({ state: "visible" });
    assert.ok(normalize(await article.innerText()).includes(normalize(formatMeetingDate(meeting))));
    await article.locator("h3 button").click();
  }
  const expand = page.getByRole("button", { name: `More about ${meeting.title} — agenda and how to be heard`, exact: true });
  await expand.waitFor({ state: "visible" });
  const pending = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/agenda" && url.searchParams.get("meetingId") === meetingId;
  });
  await expand.click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const payload = await response.json();
  assert.equal(payload.meetingId, meetingId);
  assert.equal(payload.documentCount, payload.documents.length);
  const modal = page.locator('.account-modal-overlay[role="dialog"]');
  await modal.waitFor({ state: "visible" });
  const recordRoot = modal.locator(`[data-meeting-records="${meetingId}"]`);
  if (payload.records.status === "HELD") {
    await recordRoot.waitFor({ state: "visible" });
    assert.equal(await recordRoot.locator("[data-agenda-record]").count(), payload.records.counts.agenda);
    assert.equal(await recordRoot.locator("[data-action-record]").count(), payload.records.counts.actions);
    assert.equal(await recordRoot.locator("[data-roll-call-record]").count(), payload.records.counts.rollCalls);
    assert.equal(await recordRoot.locator("[data-recorded-vote]").count(), payload.records.counts.votes);
  }
  if (payload.documents.length) for (const document of payload.documents) assert.ok(await modal.locator(`a[href="${document.documentUrl}"]`).count());
  const access = modal.locator(".how-to-be-heard");
  if (await access.count()) {
    const summary = access.locator("summary");
    if ((await access.getAttribute("open")) === null) await summary.click();
    assert.ok(await access.locator("li").count());
  }
  await page.keyboard.press("Escape");
  return { meetingId, bodyId: meeting.bodyId, payloadCounts: payload.records.counts, documentCount: payload.documentCount, meetingPanel: Boolean(meeting.location), meetingPopup: true, agendaSection: true, meetingRecords: payload.records.status === "HELD" };
}

const browser = await launchGuarded({ label: "reader-last-mile-final-render" });
try {
  {
    const { context, page } = await contextPage();
    try {
      await mapAt(page, "85701");
      const served = await (await context.request.get(`${base}/api/build`)).json();
      assert.equal(served.commit, exactHead);
      const officialId = "statewide:az/governor";
      const candidacyId = "ballot-az-pima:governor:hobbs-katie";
      assert.equal(resolvedCandidacyForOfficial(officialId)?.candidacyId, candidacyId);
      const official = await openOfficial(page, "Katie Hobbs");
      const mapMoney = await inspectStateMoney(official, officialId);
      const mapShot = await capture(mapMoney.section, "85701-hobbs-map-money");
      await page.keyboard.press("Escape");
      const meetingIds = ["legistar:pima:1825", "legistar:pima:1822", "legistar:pima:1827", "diligent:tusd1:493"];
      const meetings = [];
      for (const meetingId of meetingIds) meetings.push(await inspectMeeting(page, meetingId));
      await page.goto(`${base}/ballot?zip=85701`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.locator("[data-battlecard-pill]").first().waitFor({ state: "visible", timeout: 30_000 });
      const candidate = await openBallotCandidate(page, "Katie Hobbs");
      assert.equal(await candidate.locator("[data-candidate-subject]").getAttribute("data-candidate-subject"), candidacyId);
      const ballotMoney = await inspectStateMoney(candidate, candidacyId);
      assert.equal(ballotMoney.text, mapMoney.text);
      const ballotShot = await capture(ballotMoney.section, "85701-hobbs-ballot-money");
      results.push({ id: "hobbs-parity-and-pima-activity", result: "PASS", officialId, candidacyId, mapMoney: mapMoney.records, ballotMoney: ballotMoney.records, mapText: mapMoney.text, ballotText: ballotMoney.text, meetings, screenshots: [mapShot, ballotShot] });
    } finally { await context.close(); }
  }
  {
    const { context, page } = await contextPage();
    try {
      await mapAt(page, "85641");
      const api = await (await context.request.get(`${base}/api/funding/${encodeURIComponent("congress:C001133")}`)).json();
      assert.equal(api.kind, "funding");
      const official = await openOfficial(page, "Juan Ciscomani");
      const map = await openSection(official, "Campaign money");
      await map.getByText(api.data.sentences[0], { exact: true }).waitFor({ state: "visible" });
      const mapText = normalize(await map.innerText());
      await page.keyboard.press("Escape");
      await page.goto(`${base}/ballot?zip=85641`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      const candidate = await openBallotCandidate(page, "Juan Ciscomani");
      const ballot = await openSection(candidate, "Campaign money");
      await ballot.getByText(api.data.sentences[0], { exact: true }).waitFor({ state: "visible" });
      const ballotText = normalize(await ballot.innerText());
      assert.ok(mapText.includes(api.data.sentences[0]) && ballotText.includes(api.data.sentences[0]));
      results.push({ id: "federal-finance-parity", result: "PASS", officialId: "congress:C001133", candidateId: await candidate.locator("[data-candidate-subject]").getAttribute("data-candidate-subject"), api, mapText, ballotText });
    } finally { await context.close(); }
  }
  {
    const { context, page } = await contextPage();
    try {
      await page.goto(`${base}/ballot?zip=07866`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      const candidate = await openBallotCandidate(page, "Analilia Mejia");
      const sources = await openSection(candidate, "Sources");
      const filing = sources.locator("[data-filed-contact]");
      await filing.waitFor({ state: "visible" });
      const candidacyId = await filing.getAttribute("data-filed-contact");
      assert.ok(candidacyId?.includes("mejia"));
      assert.match(await filing.innerText(), /Published filing contact/);
      assert.ok(await filing.locator('a[href^="mailto:"]').count());
      const screenshot = await capture(sources, "07866-filed-contact");
      results.push({ id: "nj-filed-contact", result: "PASS", candidacyId, screenshot });
    } finally { await context.close(); }
  }
  {
    const { context, page } = await contextPage();
    try {
      await mapAt(page, "03255");
      const identity = meetingListingIdentity(snapshot.meetings, canonicalBodyIdentity);
      const groups = identity.groups.filter((group) => group.sourceIds.some((id) => {
        const meeting = snapshot.meetings.find((row) => row.id === id);
        return meeting?.ocdId?.includes("place:newbury") || /Newbury/i.test(meeting?.bodyName ?? "");
      }));
      assert.equal(groups.length, 3);
      assert.equal(groups.reduce((sum, group) => sum + group.sourceListingCount, 0), 6);
      assert.ok(groups.every((group) => group.uniqueMeetingCount === null && group.sourceIds.length === 2));
      const stat = page.locator('[data-stat="meetings"]').first();
      if (!(await stat.isVisible())) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await stat.getByText("Calendar listings", { exact: true }).waitFor({ state: "visible" });
      assert.ok((await stat.innerText()).includes("Distinct meeting count unresolved."));
      await stat.click();
      await page.getByRole("combobox", { name: "Group by", exact: true }).selectOption("none");
      while (await page.locator(".al-more").count()) await page.locator(".al-more").click();
      const notice = page.locator('.al-panel [data-meeting-listing-identity="UNRESOLVED_MULTIPLICITY"]');
      await notice.waitFor({ state: "visible" });
      for (const group of groups) for (const source of group.sources) {
        assert.equal(await page.locator(`.al-row[data-meeting-id="${source.id}"]`).count(), 1);
        assert.equal(await notice.locator(`a[data-calendar-listing-source="${source.id}"][href="${source.sourceUrl}"]`).count(), 1);
      }
      const pageText = await page.locator("body").innerText();
      assert.match(pageText, /couldn.t reach their calendar source at the last check|previous check/i);
      const screenshot = await capture(notice, "03255-newbury-unresolved-listings");
      results.push({ id: "newbury-unresolved-listings", result: "PASS", groups, renderedListingRows: await page.locator(".al-row").count(), failedRefreshDisclosure: true, screenshot });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

assert.equal(screenshots.length, 4, "The bounded visual sample is exactly four screenshots");
const report = {
  formatVersion: 1,
  exactHead,
  buildId,
  base,
  runId: browser.runId,
  sourceHashes: JSON.parse(readFileSync(proofSourcesPath, "utf8")),
  scope: "Four screenshots and DOM/API assertions only for Katie Hobbs parity, NJ filed contact, federal finance parity, and the changed Newbury/meeting seam.",
  results,
  screenshots,
  screenshotsReadAsImages: screenshots.map((row) => row.path),
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const reportSha256 = hashBytes(outputPath);
const ballotSha256 = hashBytes(ballotEvidencePath);
const witness = (surface: string, component: string, evidencePath = outputPath, evidenceSha256 = reportSha256, included = screenshots) => ({ surface, component, exactHead, evidencePath, evidenceSha256, screenshots: included });
const witnesses = [
  witness("map", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 1)),
  witness("ballot", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(1, 2)),
  witness("state-money", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 2)),
  witness("map", "components/funding/funding-section.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/funding/funding-section.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/ballot/candidate-card.tsx", ballotEvidencePath, ballotSha256, []),
  witness("ballot", "components/ballot/candidate-contact.tsx", outputPath, reportSha256, screenshots.slice(2, 3)),
  witness("map", "components/map/popup/meeting-popup.tsx", outputPath, reportSha256, screenshots.slice(3, 4)),
  witness("map", "components/map/popup/agenda-section.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/meeting-panel.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/popup/meeting-records.tsx", outputPath, reportSha256, []),
];
writeFileSync(witnessPath, `${JSON.stringify(witnesses, null, 2)}\n`);
console.log(JSON.stringify({ exactHead, buildId, results: results.length, screenshots: screenshots.length, witnesses: witnesses.length }, null, 2));
