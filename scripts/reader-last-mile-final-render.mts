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
import type { SnapshotStatus } from "../lib/meetings/freshness.ts";
import { meetingListingIdentity } from "../lib/meetings/listing-identity.ts";
import { formatMeetingDate } from "../lib/map/format.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { freshnessDisclosureProblems } from "./lib/reader-freshness-disclosure.ts";

const root = process.cwd();
const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-final-render.json";
const witnessPath = process.env.READER_WITNESS_OUTPUT ?? "docs/evidence/reader-last-mile-final-delta-witnesses.json";
const ballotEvidencePath = process.env.READER_BALLOT_EVIDENCE ?? "docs/evidence/reader-last-mile-final-ballot.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES;
const refreshBaseline = process.argv.includes("--refresh-baseline");
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
    assert.equal(row.provenance.sourceOrg, row.agency, `${target}: displayed agency must be the canonical source organization`);
    assert.ok(text.includes(row.agency), `${target}: source organization is missing from the reader card`);
    assert.ok(row.filingsUrl);
    assert.equal(await record.locator(`a[href="${row.filingsUrl}"]`).count(), 1, `${target}: public filing link`);
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
      const ballotTarget = "ballot-az-pima:governor|Katie Hobbs";
      assert.equal(resolvedCandidacyForOfficial(officialId)?.candidacyId, candidacyId);
      const official = await openOfficial(page, "Katie Hobbs");
      const mapMoney = await inspectStateMoney(official, officialId);
      const mapShot = await capture(mapMoney.section, "85701-hobbs-map-money");
      await page.keyboard.press("Escape");
      const meetingIds = refreshBaseline ? [] : ["legistar:pima:1825"];
      const meetings = [];
      for (const meetingId of meetingIds) meetings.push(await inspectMeeting(page, meetingId));
      await page.goto(`${base}/ballot?zip=85701`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.locator("[data-battlecard-pill]").first().waitFor({ state: "visible", timeout: 30_000 });
      const candidate = await openBallotCandidate(page, "Katie Hobbs");
      assert.equal(await candidate.locator("[data-candidate-subject]").getAttribute("data-candidate-subject"), ballotTarget);
      assert.equal(campaignMoneyForTarget(ballotTarget).state.resolvedTargetKey, candidacyId);
      const ballotMoney = await inspectStateMoney(candidate, ballotTarget);
      assert.equal(ballotMoney.text, mapMoney.text);
      const ballotShot = await capture(ballotMoney.section, "85701-hobbs-ballot-money");
      results.push({ id: "hobbs-parity-and-pima-activity", result: "PASS", officialId, ballotTarget, candidacyId, mapMoney: mapMoney.records, ballotMoney: ballotMoney.records, mapText: mapMoney.text, ballotText: ballotMoney.text, meetings, screenshots: [mapShot, ballotShot] });
    } finally { await context.close(); }
  }
  if (!refreshBaseline) {
    const { context, page } = await contextPage();
    try {
      await mapAt(page, "85641");
      const api = await (await context.request.get(`${base}/api/funding/${encodeURIComponent("congress:C001133")}`)).json();
      assert.equal(api.kind, "funding");
      const official = await openOfficial(page, "Juan Ciscomani");
      assert.ok(await official.locator(".contact-pill").count(), "federal map card must render its canonical contact leaf");
      const committees = await openSection(official, "Committees");
      await committees.locator("[data-committee-seat]").first().waitFor({ state: "visible" });
      const offices = await openSection(official, "Offices near you");
      await offices.locator("[data-directory-office]").first().waitFor({ state: "visible" });
      const votingRecord = await openSection(official, "Voting Record");
      await votingRecord.locator("[data-recent-vote-count]").waitFor({ state: "visible" });
      const componentReadback = {
        contacts: await official.locator(".contact-pill").count(),
        committees: await committees.locator("[data-committee-seat]").count(),
        offices: await offices.locator("[data-directory-office]").count(),
        recentVoteCount: await votingRecord.locator("[data-recent-vote-count]").getAttribute("data-recent-vote-count"),
      };
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
      results.push({ id: "federal-finance-parity", result: "PASS", officialId: "congress:C001133", candidateId: await candidate.locator("[data-candidate-subject]").getAttribute("data-candidate-subject"), api, mapText, ballotText, componentReadback });
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
  if (!refreshBaseline) {
    const { context, page } = await contextPage();
    try {
      // RLC-1 (2026-09-05): the footer's disclosure is required in the form the
      // SERVED snapshot status demands, from the one contract the footer renders
      // (lib/meetings/freshness.ts) — never from a sentence kept here. The status
      // is the page's own /api/meetings answer, captured as the map loads, so the
      // requirement and the rendering come from the same served bytes.
      const servedMeetings = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/meetings" && response.status() === 200,
        { timeout: 60_000 },
      );
      await mapAt(page, "03255");
      const served = (await (await servedMeetings).json()) as { snapshot: SnapshotStatus | null };
      assert.ok(served.snapshot, "the meetings route served no snapshot status, so the footer has nothing to disclose and this case cannot run");
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
      while (await page.locator(".al-more").count()) {
        const before = await page.locator(".al-row").count();
        await page.locator(".al-more").click();
        await page.waitForFunction((count) => document.querySelectorAll(".al-row").length > count || !document.querySelector(".al-more"), before);
      }
      const notice = page.locator('.al-panel [data-meeting-listing-identity="UNRESOLVED_MULTIPLICITY"]');
      await notice.waitFor({ state: "visible" });
      const renderedIds = await page.locator(".al-row[data-meeting-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-meeting-id")));
      const renderedSources = await notice.locator("a[data-calendar-listing-source]").evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute("data-calendar-listing-source"), href: element.getAttribute("href") })));
      for (const group of groups) for (const source of group.sources) {
        assert.equal(renderedIds.filter((id) => id === source.id).length, 1, `${source.id}: rendered listing row`);
        assert.equal(renderedSources.filter((row) => row.id === source.id && row.href === source.sourceUrl).length, 1, `${source.id}: rendered unresolved source link`);
      }
      const pageText = await page.locator("body").innerText();
      const disclosure = freshnessDisclosureProblems(pageText, served.snapshot);
      assert.deepEqual(disclosure.problems, [], "the footer does not disclose what the served snapshot requires");
      const screenshot = await capture(notice, "03255-newbury-unresolved-listings");
      results.push({ id: "newbury-unresolved-listings", result: "PASS", groups, renderedListingRows: await page.locator(".al-row").count(), failedRefreshDisclosure: disclosure.required, screenshot });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

assert.equal(screenshots.length, refreshBaseline ? 3 : 4, `The bounded visual sample is exactly ${refreshBaseline ? 3 : 4} screenshots`);
const resultFloor = floored(
  "passing final rendered proof results",
  outputPath,
  results.length,
  results.filter((result) => result.result === "PASS").length,
);
const screenshotFloor = floored(
  "captured final rendered proof screenshots",
  screenshotsDir,
  screenshots.length,
  screenshots.length,
);
const report = {
  formatVersion: 1,
  exactHead,
  buildId,
  base,
  runId: browser.runId,
  sourceHashes: JSON.parse(readFileSync(proofSourcesPath, "utf8")),
  scope: refreshBaseline
    ? "Three screenshots and DOM/API assertions only for the invalidated state-money surfaces and NJ filed contact."
    : "Four screenshots and DOM/API assertions only for Katie Hobbs parity, NJ filed contact, federal finance parity, and the changed Newbury/meeting seam.",
  results,
  screenshots,
  denominatorFloors: [resultFloor, screenshotFloor],
  screenshotsReadAsImages: screenshots.map((row) => row.path),
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const reportSha256 = hashBytes(outputPath);
const ballotSha256 = hashBytes(ballotEvidencePath);
const witness = (surface: string, component: string, evidencePath = outputPath, evidenceSha256 = reportSha256, included = screenshots) => ({ surface, component, exactHead, evidencePath, evidenceSha256, screenshots: included });
const witnesses = refreshBaseline ? [
  witness("map", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 1)),
  witness("ballot", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(1, 2)),
  witness("state-money", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 2)),
  witness("ballot", "components/ballot/candidate-card.tsx", ballotEvidencePath, ballotSha256, []),
  witness("ballot", "components/ballot/candidate-contact.tsx", outputPath, reportSha256, screenshots.slice(2, 3)),
] : [
  witness("map", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 1)),
  witness("ballot", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(1, 2)),
  witness("state-money", "components/funding/state-money-section.tsx", outputPath, reportSha256, screenshots.slice(0, 2)),
  witness("map", "components/funding/funding-section.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/funding/funding-section.tsx", outputPath, reportSha256, []),
  witness("map", "components/officials/person-identity.tsx", outputPath, reportSha256, []),
  witness("map", "components/officials/contact-pills.tsx", outputPath, reportSha256, []),
  witness("map", "components/officials/member-directory.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/popup/entity-modal.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/popup/district-popup.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/popup/official-popup.tsx", outputPath, reportSha256, []),
  witness("map", "components/officials/key-votes-section.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/officials/person-identity.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/officials/contact-pills.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/officials/member-directory.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/map/popup/official-popup.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/officials/key-votes-section.tsx", outputPath, reportSha256, []),
  witness("ballot", "components/ballot/candidate-card.tsx", ballotEvidencePath, ballotSha256, []),
  witness("ballot", "components/ballot/candidate-contact.tsx", outputPath, reportSha256, screenshots.slice(2, 3)),
  witness("map", "components/map/popup/meeting-popup.tsx", outputPath, reportSha256, screenshots.slice(3, 4)),
  witness("map", "components/map/popup/agenda-section.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/meeting-panel.tsx", outputPath, reportSha256, []),
  witness("map", "components/map/popup/meeting-records.tsx", outputPath, reportSha256, []),
];
writeFileSync(witnessPath, `${JSON.stringify(witnesses, null, 2)}\n`);
console.log(JSON.stringify({ exactHead, buildId, results: results.length, screenshots: screenshots.length, witnesses: witnesses.length }, null, 2));
