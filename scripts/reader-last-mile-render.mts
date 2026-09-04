/** Real reader gestures against the local production build; no React state injection. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";
import { campaignMoneyForTarget } from "../lib/funding/campaign-money.ts";
import { stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";
import { formatMeetingDate, meetingRowTitle, meetingSubline } from "../lib/map/format.ts";
import { minutesSummaryForMeeting } from "../lib/meetings/minutes-summaries.ts";
import { commentAccessFor } from "../lib/registry/comment-access.ts";
import { areaFactsForState } from "../lib/area/facts.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { divisionsAt } from "../lib/registry/server.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { MeetingReaderRecords } from "../lib/meetings/reader-records.ts";
import type { VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import { officialActionsForTarget, type ReaderOfficialActions } from "../lib/officials/reader-actions.ts";
import { directoryFor } from "../lib/officials/directory.ts";
import { keyVotesForMember } from "../lib/votes/key-votes-reader.ts";
import { pollingLookupFallbacks } from "../lib/ballot/polling-lookup-fallback.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { positionsFor, type PositionAnswer } from "../lib/corpus/positions.ts";
import { readerPositionsFor } from "../lib/corpus/reader-positions.ts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname), "Rendered regression runs on local production build");
const PROVISIONAL = process.env.READER_RENDER_PHASE === "provisional";
const OUT = join(process.cwd(), "screenshots", "reader-last-mile", ...(PROVISIONAL ? ["provisional"] : []));
const REPORT = join(process.cwd(), "docs", "evidence", PROVISIONAL ? "reader-last-mile-render-provisional.json" : "reader-last-mile-render.json");
mkdirSync(OUT, { recursive: true });
const pilots = [
  { zip: "85701", name: "Katie Hobbs", official: "statewide:az/governor", key: "ballot-az-pima:governor:hobbs-katie", raised: "$11,109,720", spent: "$14,355,613" },
  { zip: "85641", name: "Katie Hobbs", official: "statewide:az/governor", key: "ballot-az-pima:governor:hobbs-katie", raised: "$11,109,720", spent: "$14,355,613" },
  { zip: "07866", name: "Tayfun Selen", official: "roster:morris#6", key: "ballot-nj-morris:county-commissioner:selen", raised: "$225,026", spent: "$229,526" },
  { zip: "03255", name: "Kelly Ayotte", official: "statewide:nh/governor", key: "ballot-nh-merrimack:governor:ayotte-kelly", raised: "$5,995,303", spent: "$3,276,135" },
];
const results: Record<string, unknown>[] = [];
const screenshots: string[] = [];
const heldMeetings = (JSON.parse(readFileSync(join(process.cwd(), "data/meetings-snapshot.json"), "utf8")) as { meetings: Meeting[] }).meetings;
const browser = await launchGuarded({ label: "reader-last-mile-render" });

async function capture(page: Page, label: string, focus?: Locator) {
  if (focus) await focus.scrollIntoViewIfNeeded();
  const path = join(OUT, `${label}.png`);
  await page.screenshot({ path });
  screenshots.push(path);
  return path;
}
async function openSection(modal: Locator, label: string) {
  const button = modal.locator("button.card-section-header").filter({ has: modal.getByText(label, { exact: true }) });
  await button.waitFor({ state: "visible", timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button.locator("..");
}

async function federalRecordsWitness(page: Page, modal: Locator, label: string, ballot: boolean) {
  const member = "congress:C001133";
  const held = directoryFor(member);
  assert.ok(held);
  const directoryResponse = await page.request.get(`${BASE}/api/directory?member=${encodeURIComponent(member)}`);
  assert.equal(directoryResponse.status(), 200);
  const directory = await directoryResponse.json();
  assert.deepEqual(directory.districtOffices, held.entry.districtOffices);
  assert.deepEqual(directory.committees.map((row: { committeeId: string }) => row.committeeId), held.entry.committees.map(row => row.committeeId));
  const committees = await openSection(modal, "Committees");
  await committees.locator("[data-committee-seat]").first().waitFor({ state: "visible" });
  assert.deepEqual((await committees.locator("[data-committee-seat]").evaluateAll(elements => elements.map(element => element.getAttribute("data-committee-seat")))).sort(), held.entry.committees.map(row => row.committeeId).sort());
  const committeeMeta = committees.locator(":scope > button .card-section-meta");
  if (await committeeMeta.count()) assert.equal(Number(await committeeMeta.innerText()), held.entry.committees.length);
  await capture(page, `${label}-committees`, committees);
  const offices = await openSection(modal, "Offices near you");
  await offices.locator("[data-directory-office]").first().waitFor({ state: "visible" });
  assert.equal(await offices.locator("[data-directory-office]").count(), held.entry.districtOffices.length);
  for (let i = 0; i < held.entry.districtOffices.length; i++) {
    const row = held.entry.districtOffices[i];
    const text = await offices.locator(`[data-directory-office="${i}"]`).innerText();
    for (const value of [row.city, row.address, row.phone]) if (value) assert.ok(text.includes(value), `${member}: held office fact missing ${value}`);
  }
  const officeMeta = offices.locator(":scope > button .card-section-meta");
  if (await officeMeta.count()) assert.equal(Number(await officeMeta.innerText()), held.entry.districtOffices.length);
  await capture(page, `${label}-offices`, offices);
  const expectedVotes = await keyVotesForMember(member);
  const votesResponse = await page.request.get(`${BASE}/api/votes?member=${encodeURIComponent(member)}`);
  assert.equal(votesResponse.status(), 200);
  const votes = await votesResponse.json();
  assert.deepEqual(votes.keyVotes, expectedVotes.rows);
  const record = await openSection(modal, ballot ? "Voting record" : "Voting Record");
  const keyToggle = record.getByRole("button", { name: /^When it mattered/ });
  await keyToggle.waitFor({ state: "visible" });
  await keyToggle.click();
  const laws = await openSection(record, "Votes on laws");
  const rows = expectedVotes.rows.filter(row => row.entry.group === "LAWS");
  assert.equal(await laws.locator("[data-key-vote]").count(), rows.length);
  for (const row of rows) {
    const item = laws.locator(`[data-key-vote="${row.entry.id}"]`);
    const text = await item.innerText();
    assert.ok(text.includes(row.entry.title));
    assert.ok(text.includes(row.entry.explainer));
    for (let i = 0; i < row.refs.length; i++) {
      const ref = row.refs[i];
      if (ref.url) assert.ok(await item.locator(`a[href="${ref.url}"]`).count());
      const position = row.positions[i];
      const expected = position === "YES" ? "Voted yes" : position === "NO" ? "Voted no" : position === "PRESENT" ? "Voted present" : position ? "Did not vote" : row.held?.[i] ? "Not in this chamber for this vote" : "We haven't recorded this vote yet";
      assert.ok(text.includes(expected), `${member}/${row.entry.id}: held position missing`);
    }
  }
  await capture(page, `${label}-key-votes`, laws.locator("[data-key-vote]").first());
  await capture(page, `${label}-key-votes-last`, laws.locator("[data-key-vote]").last());
  return { member, committees: held.entry.committees.length, offices: held.entry.districtOffices.length, keyVoteRows: rows.length, positionsReadAt: expectedVotes.positionsReadAt };
}
async function dismissNarrowing(page: Page) {
  const optional = page.getByRole("button", { name: /No thanks|show me everything|Skip for now/i }).first();
  if (await optional.isVisible().catch(() => false)) await optional.click();
}
async function mapAt(page: Page, zip: string, theme: string) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const zipInput = page.locator(".welcome-overlay input").first();
  await zipInput.waitFor({ state: "visible", timeout: 30_000 });
  await zipInput.fill(zip);
  await zipInput.press("Enter");
  // The exit animation retains an opacity-zero input; the closed class is
  // the component's state, while Playwright's visibility test ignores opacity.
  await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached", timeout: 30_000 });
  const tour = page.getByRole("button", { name: "Skip the tour", exact: true });
  if (await tour.isVisible().catch(() => false)) await tour.click();
  await dismissNarrowing(page);
  const switcher = page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).first();
  const beforeTheme = (await page.locator("html").getAttribute("data-theme")) === "light" ? "light" : "dark";
  if (beforeTheme !== theme) {
    if (!(await switcher.isVisible().catch(() => false))) {
      const menu = page.getByRole("button", { name: "Open menu", exact: true });
      if (await menu.isVisible()) await menu.click();
    }
    await switcher.waitFor({ state: "visible" });
    await switcher.click();
  }
  const actualTheme = await page.locator("html").getAttribute("data-theme");
  assert.equal(actualTheme === "light" ? "light" : "dark", theme);
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
async function inspectMoney(modal: Locator, expectedKey: string, raised: string, spent: string) {
  const section = await openSection(modal, "Campaign money");
  const record = section.locator("[data-state-money-targets]");
  await record.waitFor({ state: "visible", timeout: 15_000 });
  const text = await record.innerText();
  assert.ok(text.includes(raised), `${expectedKey}: raised missing from rendered answer: ${text}`);
  assert.ok(text.includes(spent), `${expectedKey}: spent missing from rendered answer: ${text}`);
  assert.ok((await record.getAttribute("data-state-money-targets"))?.split(" ").includes(expectedKey));
  return { section, text, canonicalTargets: await record.getAttribute("data-state-money-targets"), renderedRecords: Number(await record.getAttribute("data-state-money-record-count")) };
}
async function inspectOfficialActions(page: Page, modal: Locator, expected: ReaderOfficialActions, label: string) {
  const section = await openSection(modal, "Official actions");
  const root = section.locator("[data-official-actions-count]");
  assert.equal(Number(await root.getAttribute("data-official-actions-count")), expected.count);
  const rows = root.locator("li[data-official-action-id]");
  assert.equal(await rows.count(), expected.count);
  const actualIds = await rows.evaluateAll(elements => elements.map(element => element.getAttribute("data-official-action-id")));
  assert.deepEqual(actualIds, expected.records.map(record => record.id));
  for (const record of expected.records) {
    const row = root.locator(`[data-official-action-id="${record.id}"]`);
    assert.ok((await row.innerText()).includes(record.text));
    assert.equal(await row.getAttribute("data-official-id"), record.officialId);
    assert.ok(await row.locator(`a[href="${record.sourceUrl}"]`).count());
  }
  await capture(page, `${label}-official-actions`, rows.first());
  await capture(page, `${label}-official-actions-last`, rows.last());
  return { canonicalTarget: await root.getAttribute("data-official-actions-target"), count: expected.count, actualIds };
}

async function positionsWitness(page: Page, modal: Locator, subjectId: string, label: string) {
  const topic = "transparency";
  const holding = positionsFor("ballot-az-pima:governor|Katie Hobbs", topic, unifiedCorpus());
  assert.equal(holding.kind, "MATCHED", "Positions control must come from an eligible held quotation");
  const section = await openSection(modal, "Positions");
  // Search is inside the caller's one disclosure. A nested top-level section
  // would close its own parent through CardSectionGroup and hide the holding.
  const input = section.locator("[data-positions-search]");
  await input.waitFor({ state: "visible" });
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === `/api/positions/${encodeURIComponent(subjectId)}/${topic}`, { timeout: 30_000 });
  await input.fill(topic);
  const response = await pending;
  assert.equal(response.status(), 200);
  const answer = await response.json() as PositionAnswer & { totalMatches: number; canonicalSubjectKeys: string[] };
  assert.equal(answer.kind, "MATCHED");
  const expected = readerPositionsFor(subjectId, topic);
  assert.deepEqual(answer.passages, expected.passages);
  assert.deepEqual(answer.canonicalSubjectKeys, expected.canonicalSubjectKeys);
  assert.ok(holding.passages.every(passage => answer.passages.some(actual => actual.snapshotId === passage.snapshotId && actual.quote === passage.quote && actual.url === passage.url)), `${subjectId}: held candidacy quotation disappeared`);
  const result = section.locator('[data-positions-answer="MATCHED"]');
  await result.waitFor({ state: "visible" });
  const figures = result.locator("figure");
  assert.equal(answer.totalMatches, answer.passages.length);
  assert.equal(await figures.count(), answer.passages.length);
  for (let i = 0; i < answer.passages.length; i++) {
    assert.ok((await figures.nth(i).innerText()).includes(answer.passages[i].quote));
    assert.equal(await figures.nth(i).locator(`a[href="${answer.passages[i].url}"]`).count(), 1);
  }
  await capture(page, `${label}-positions`, result);
  return { topic, canonicalSubjectKeys: answer.canonicalSubjectKeys, passages: answer.passages, renderedCount: await figures.count() };
}
async function openBallotCandidate(page: Page, name: string) {
  const row = page.locator(".candidate-row").filter({ hasText: name }).first();
  await row.locator("[data-battlecard-pill]").click();
  const modal = page.getByRole("dialog", { name, exact: true });
  await modal.waitFor({ state: "visible" });
  return modal;
}
async function allBallotMoney(page: Page) {
  const pills = page.locator("[data-battlecard-pill]");
  const total = await pills.count();
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < total; i++) {
    await pills.nth(i).click();
    const modal = page.locator("[data-candidate-battlecard]");
    await modal.waitFor({ state: "visible" });
    const key = (await modal.getAttribute("data-candidate-subject"))!;
    const expected = stateMoneyRecordsForDisplay(campaignMoneyForTarget(key).state.records);
    const section = await openSection(modal, "Campaign money");
    const record = section.locator("[data-state-money-targets]");
    const count = (await record.count()) ? Number(await record.getAttribute("data-state-money-record-count")) : 0;
    assert.equal(count, expected.length, `${key}: held eligible displayed record count`);
    if (expected.length) {
      const text = await record.innerText();
      for (const r of expected) for (const value of [r.totals.receipts, r.totals.expenditures]) {
        if (value !== null && r.filingState === "FILED") assert.ok(text.includes(`$${Math.round(value).toLocaleString("en-US")}`), `${key}: held dollars missing`);
      }
    }
    rows.push({ key, eligibleDisplayRecords: expected.length, renderedRecords: count });
    await page.keyboard.press("Escape");
  }
  return { cardsOpened: total, rows };
}

async function meetingWitness(page: Page, meetingId: string, label: string) {
  const meeting = heldMeetings.find(row => row.id === meetingId);
  assert.ok(meeting, `${meetingId}: canonical sitting exists`);
  const listButton = page.locator('[data-stat="meetings"]').first();
  if (!(await listButton.isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
  }
  await listButton.click();
  const groupedDiagnostic = process.env.READER_RENDER_GROUPED_DIAGNOSTIC === "1";
  if (!groupedDiagnostic) {
    await page.getByRole("combobox", { name: "Group by", exact: true }).selectOption("jurisdiction");
    const group = page.locator(".al-group-head").first();
    if ((await group.getAttribute("aria-expanded")) === "true") await group.click();
    assert.equal(await group.locator("..").locator(".al-row").count(), 0, "Named group remains collapsible");
    await group.click();
    assert.ok(await group.locator("..").locator(".al-row").count(), "Named group expands to held rows");
  }
  await page.getByRole("combobox", { name: "Group by", exact: true }).selectOption(groupedDiagnostic ? "jurisdiction" : "none");
  if (groupedDiagnostic) {
    const group = page.locator(".al-group-head").filter({ hasText: meeting.jurisdiction! }).first();
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  } else {
    while (await page.locator(".al-more").count()) await page.locator(".al-more").click();
    const stated = Number((await page.locator(".al-overlay-count").innerText()).split(" ")[0]);
    assert.equal(await page.locator(".al-row").count(), stated, "Ungrouped stated meeting count equals all accessible rows");
  }
  const title = [meetingRowTitle(meeting, { jurisdictionShown: groupedDiagnostic }), meetingSubline(meeting)].filter(Boolean).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
  const row = groupedDiagnostic ? page.locator(".al-row").filter({ has: page.locator(".al-row-title").filter({ hasText: new RegExp(`^${title}$`) }) }).filter({ hasText: formatMeetingDate(meeting) }) : page.locator(`[data-meeting-id="${meetingId}"]`);
  assert.equal(await row.count(), 1, `${meetingId}: actual list has exactly one matching sitting: ${JSON.stringify(await row.allInnerTexts())}`);
  await row.click();
  if (meeting.location) {
    // The list first opens the venue's real sitting list. Use the sitting's
    // held agenda link and date to distinguish regular/study sessions there.
    assert.ok(meeting.agendaUrl, `${meetingId}: known-answer witness has its exact agenda URL`);
    const entry = page.locator('aside[aria-label^="Meetings at"]:visible article').filter({ has: page.locator(`a[href="${meeting.agendaUrl}"]`) }).filter({ hasText: formatMeetingDate(meeting) });
    assert.equal(await entry.count(), 1, `${meetingId}: exact venue sitting`);
    await entry.locator("h3 button").click();
  }
  if (groupedDiagnostic) await capture(page, `${label}-meeting-diagnostic-popup`);
  const [response] = await Promise.all([page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/agenda" && url.searchParams.get("meetingId") === meetingId;
  }), page.getByRole("button", { name: `More about ${meeting.title} — agenda and how to be heard`, exact: true }).click()]);
  assert.equal(response.status(), 200);
  const payload = await response.json() as { meetingId: string; documentCount: number; documents: { documentUrl: string; text: string | null }[]; records: MeetingReaderRecords };
  assert.equal(payload.meetingId, meetingId);
  assert.equal(payload.documentCount, payload.documents.length);
  const modal = page.locator('.account-modal-overlay[role="dialog"]');
  await modal.waitFor({ state: "visible" });
  const records = modal.locator(`[data-meeting-records="${meetingId}"]`);
  if (payload.records.status === "HELD") {
    await records.waitFor({ state: "visible" });
    assert.equal(payload.records.bodyId, meeting.bodyId);
    for (const [attribute, field] of [["data-agenda-record", "agenda"], ["data-action-record", "actions"], ["data-roll-call-record", "rollCalls"], ["data-recorded-vote", "votes"]] as const) {
      assert.equal(await records.locator(`[${attribute}]`).count(), payload.records.counts[field], `${meetingId}: ${field} returned/rendered count`);
    }
    for (const [title, field] of [["Recorded agenda items", "agenda"], ["Recorded actions", "actions"], ["Recorded roll calls", "rollCalls"]] as const) {
      if (payload.records.counts[field] === 0) continue;
      const summary = records.locator("summary").filter({ hasText: `${title} (${payload.records.counts[field]})` });
      assert.equal(await summary.count(), 1, `${meetingId}: printed ${field} count`);
      if ((await summary.locator("..").getAttribute("open")) === null) await summary.click();
      await capture(page, `${label}-${meetingId.replaceAll(":", "-")}-${field}`, summary);
    }
    assert.ok(await records.locator(`a[href="${payload.records.sourceUrl}"]`).count());
  }
  const minutes = minutesSummaryForMeeting(meetingId);
  if (minutes) {
    const summary = modal.locator(`[data-minutes-summary="${meetingId}"]`);
    await summary.waitFor({ state: "visible" });
    assert.ok((await summary.innerText()).includes(minutes.summary));
    assert.equal(await summary.locator(`a[href="${minutes.minutesUrl}"]`).count(), 1);
    await capture(page, `${label}-${meetingId.replaceAll(":", "-")}-minutes`, summary);
  }
  const textDocument = payload.documents.find(document => document.text);
  if (textDocument) {
    const source = modal.locator(`a[href="${textDocument.documentUrl}"]`).last();
    await source.waitFor({ state: "attached" });
    const raw = modal.locator("p.whitespace-pre-line");
    assert.ok((await raw.innerText()).includes(textDocument.text!.slice(0, 100)), `${meetingId}: held agenda text reaches DOM`);
    await capture(page, `${label}-${meetingId.replaceAll(":", "-")}-agenda-text`, raw);
  }
  const access = commentAccessFor(meeting.ocdId, meeting.bodyName, meeting.bodyId);
  let accessLines = 0;
  if (access && access.commentPeriod !== "UNKNOWN" && meeting.status !== "CONCLUDED") {
    const expected = [access.commentPeriodDetail, access.timeLimit, access.signup, access.writtenComment, access.attend].filter((line): line is string => Boolean(line));
    const section = modal.locator(".how-to-be-heard");
    await section.locator("summary").click();
    assert.deepEqual(await section.locator("li").allInnerTexts(), expected);
    assert.equal(await section.locator(`a[href="${access.sourceUrl}"]`).count(), 1);
    accessLines = expected.length;
    await capture(page, `${label}-${meetingId.replaceAll(":", "-")}-comment-access`, section);
  }
  if (payload.records.status !== "HELD" && !minutes && !textDocument) await capture(page, `${label}-${meetingId.replaceAll(":", "-")}-meeting`, modal);
  await page.keyboard.press("Escape");
  return { meetingId, bodyId: meeting.bodyId, returned: payload, renderedCounts: payload.records.counts, minutes: minutes?.summary ?? null, commentAccessBodyId: access?.bodyId ?? null, commentAccessLines: accessLines, commentAccessApplicability: meeting.status === "CONCLUDED" ? "Concluded sitting: participation rules intentionally do not apply" : "Current body participation rules" };
}

async function activityWitnesses(page: Page, zip: string, label: string) {
  const ids = zip === "85701" ? ["legistar:pima:1825", "legistar:pima:1822", "legistar:pima:1827"] : zip === "85641" ? ["apptegy:vail:60703698"] : zip === "07866" ? ["iqm2:morriscountynj:2236"] : ["diligent:newburynh:3367"];
  const rows = [];
  for (const id of ids) rows.push(await meetingWitness(page, id, label));
  return rows;
}

async function votingWitness(page: Page, label: string) {
  const opener = page.getByRole("button", { name: "Where can I vote?", exact: true });
  if (!(await opener.isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
  }
  await opener.click();
  const panel = page.locator(".voting-panel");
  await panel.getByLabel("Your street address").fill("240 N Stone Avenue, Tucson, AZ 85701");
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/voting-sites" && response.request().method() === "POST", { timeout: 90_000 });
  await panel.getByRole("button", { name: "Show me", exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const answer = await response.json() as VotingSitesAnswer;
  assert.equal(answer.match, true);
  assert.ok(answer.jurisdictions.length > 0);
  await panel.locator(".voting-jurisdiction").first().waitFor({ state: "visible" });
  const bounds = await panel.boundingBox();
  const layoutFailure = !bounds || bounds.x < 0 || bounds.x + bounds.width > page.viewportSize()!.width ? "Voting panel overflows the reader viewport" : null;
  if (!PROVISIONAL) assert.equal(layoutFailure, null, "Voting sites and attribution fit inside the reader viewport");
  assert.equal(await panel.locator(".voting-jurisdiction").count(), answer.jurisdictions.length);
  const sites = answer.jurisdictions.flatMap(jurisdiction => jurisdiction.sites);
  assert.ok(sites.length > 0);
  assert.equal(await panel.locator(".voting-site").count(), sites.length);
  for (const site of sites) assert.ok((await panel.locator(".voting-site-name").allInnerTexts()).includes(site.name));
  for (const jurisdiction of answer.jurisdictions) assert.ok(await panel.locator(`a[href="${jurisdiction.sourceUrl}"]`).count());
  await capture(page, `${label}-voting-sites`, panel.locator(".voting-site").first());
  await capture(page, `${label}-voting-sites-source`, panel.locator(".voting-source").last());
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  return { ...answer, renderedJurisdictions: answer.jurisdictions.length, renderedSites: sites.length, layoutFailure };
}

async function votingFallbackWitness(page: Page, label: string, kind: "outside-coverage" | "assigned-unresolved") {
  const opener = page.getByRole("button", { name: "Where can I vote?", exact: true });
  if (!(await opener.isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
  }
  await opener.click();
  const panel = page.locator(".voting-panel");
  // Public municipal buildings only. The NJ address is held in the meetings
  // snapshot; Phoenix City Hall is the city clerk's published public address.
  const address = kind === "outside-coverage" ? "200 W Washington Street, Phoenix, AZ 85003" : "65 Mount Hope Road, Rockaway Township, NJ 07866";
  const addressSource = kind === "outside-coverage" ? "https://www.phoenix.gov/administration/departments/cityclerk/contact-us.html" : "data/meetings-snapshot.json";
  await panel.getByLabel("Your street address").fill(address);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/voting-sites" && response.request().method() === "POST", { timeout: 90_000 });
  await panel.getByRole("button", { name: "Show me", exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const answer = await response.json() as VotingSitesAnswer;
  assert.equal(answer.match, true, `${address}: public address must actually resolve`);
  if (kind === "outside-coverage") assert.equal(answer.outsideCoverage, true);
  else assert.ok(answer.jurisdictions.some(jurisdiction => jurisdiction.state === "NJ" && jurisdiction.narrowing.kind === "REFUSED"));
  const expected = pollingLookupFallbacks("answered", answer);
  assert.ok(expected.length > 0);
  const fallback = panel.locator("[data-polling-lookup-fallback]");
  await fallback.waitFor({ state: "visible" });
  assert.equal(await fallback.locator("[data-polling-lookup-state]").count(), expected.length);
  for (const link of expected) {
    const row = fallback.locator(`[data-polling-lookup-state="${link.state}"]`);
    assert.ok((await row.innerText()).includes(link.note));
    assert.ok((await row.innerText()).includes(link.sourceOrg));
    assert.equal(await row.locator(`a[href="${link.url}"]`).count(), 1);
  }
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width, "Voting fallback fits the reader viewport");
  await capture(page, `${label}-voting-${kind}`, fallback);
  await capture(page, `${label}-voting-${kind}-last`, fallback.locator("[data-polling-lookup-state]").last());
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  return { kind, address, addressSource, answer, links: expected, renderedLinks: expected.length };
}

async function areaWitness(page: Page, zip: string, label: string) {
  const location = resolveZip(zip);
  assert.ok(location.ok, `${zip}: canonical centroid is held`);
  const divisions = await divisionsAt(location.centroid.lat, location.centroid.lng);
  const state = divisions.map(division => division.ocdId.match(/state:([a-z]{2})/)?.[1]).find(Boolean);
  assert.ok(state, `${zip}: canonical state division resolves`);
  const facts = areaFactsForState(state.toUpperCase());
  assert.ok(facts, `${state}: declared area facts are held`);
  const response = await page.goto(`${BASE}/about-area?zip=${zip}`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await page.getByRole("heading", { name: `The basics of living here — ${facts.stateName}`, exact: true }).waitFor({ state: "visible" });
  const cards = page.locator("main > section");
  assert.equal(await cards.count(), facts.facts.length);
  for (const fact of facts.facts) {
    const card = cards.filter({ has: page.getByRole("heading", { name: fact.question, exact: true }) });
    assert.equal(await card.count(), 1);
    assert.ok((await card.innerText()).includes(fact.answer));
    assert.equal(await card.locator(`a[href="${fact.sourceUrl}"]`).count(), 1);
  }
  await capture(page, `${label}-about-area`, cards.first());
  return { state: facts.state, renderedFacts: facts.facts.length, facts: facts.facts };
}

async function ballotAskMoney(page: Page, pilot: typeof pilots[number], label: string) {
  const question = `How much campaign money has ${pilot.name} raised and spent?`;
  const pill = page.locator("[data-ballot-ask-pill]");
  if ((await pill.getAttribute("aria-expanded")) !== "true") await pill.click();
  const panel = page.locator("[data-ballot-ask]");
  const input = panel.locator("[data-ask-input]");
  await input.fill(question);
  const pendingResponse = page.waitForResponse(response => response.url().includes("/api/ask/grounded") && response.request().method() === "POST", { timeout: 60_000 });
  await panel.locator("[data-ask-submit]").click();
  const response = await pendingResponse;
  assert.equal(response.status(), 200);
  const payload = await response.json();
  const finance = (payload.records ?? []).filter((record: { kind: string }) => record.kind === "FINANCE_SUMMARY");
  assert.ok(finance.length > 0, `${pilot.zip}: Ask retrieved no finance holding`);
  assert.ok(finance.some((record: { canonicalSubjectId: string }) => record.canonicalSubjectId === pilot.key), `${pilot.zip}: Ask used another candidacy`);
  const eligible = stateMoneyRecordsForDisplay(campaignMoneyForTarget(pilot.key).state.records);
  const answer = panel.locator("[data-ask-mode]");
  await answer.waitFor({ state: "visible", timeout: 20_000 });
  const recordDisclosure = answer.locator("[data-ask-record-count]");
  const expectedRecords = (payload.records ?? []).filter((record: { kind: string }) => record.kind !== "CONTACT");
  await recordDisclosure.waitFor({ state: "visible" });
  assert.equal(Number(await recordDisclosure.getAttribute("data-ask-record-count")), expectedRecords.length);
  assert.equal(await recordDisclosure.locator("li[data-ask-record-id]").count(), expectedRecords.length);
  if ((await recordDisclosure.getAttribute("open")) === null) await recordDisclosure.locator("summary").click();
  const actualRecordIds = await recordDisclosure.locator("li[data-ask-record-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-ask-record-id")));
  assert.deepEqual(actualRecordIds, expectedRecords.map((record: { id: string }) => record.id));
  const renderedText = await answer.innerText();
  if (["07866", "03255"].includes(pilot.zip)) {
    assert.doesNotMatch(renderedText, /Arizona.?s legislature|bills she signed|She also sent the legislature|Pima County/i, `${pilot.zip}: another jurisdiction or person's diagnostic was attached`);
  }
  for (const record of eligible.filter(r => r.filingState === "FILED")) {
    for (const value of [record.totals.receipts, record.totals.expenditures]) {
      if (value === null) continue;
      const exact = `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      assert.ok(finance.some((r: { text: string }) => r.text.includes(exact)), `${pilot.zip}: Ask record lacks held amount ${exact}`);
      assert.ok(renderedText.includes(exact) || renderedText.includes(`$${Math.round(value).toLocaleString("en-US")}`), `${pilot.zip}: visible Ask hides held amount ${exact}`);
    }
  }
  const links = await answer.locator("a[href]").evaluateAll(els => els.map(el => el.getAttribute("href")));
  assert.ok(finance.every((record: { sourceUrl: string | null }) => record.sourceUrl && links.includes(record.sourceUrl)), `${pilot.zip}: rendered provenance differs from retrieved record`);
  await capture(page, `${label}-ballot-ask`, answer);
  await capture(page, `${label}-ballot-ask-last-record`, recordDisclosure.locator("li[data-ask-record-id]").last());
  return { question, canonicalCandidacyId: pilot.key, renderedText, retrievedRecords: finance, links, mode: payload.mode, trace: payload.trace, answer: payload.answer, renderedRecordCount: expectedRecords.length, renderedRecordIds: actualRecordIds };
}

try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }]) {
    for (const theme of ["dark", "light"]) for (const pilot of pilots) {
      const label = `${pilot.zip}-${viewport.name}-${theme}`;
      if (process.env.READER_RENDER_CASE && !new RegExp(process.env.READER_RENDER_CASE).test(label)) continue;
      const context = await browser.context({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      const tourSkip = page.getByRole("button", { name: "Skip the tour", exact: true });
      await page.addLocatorHandler(tourSkip, async () => { await tourSkip.click(); });
      const addressSkip = page.getByRole("button", { name: "No thanks", exact: true });
      await page.addLocatorHandler(addressSkip, async () => { await addressSkip.click(); });
      try {
        await mapAt(page, pilot.zip, theme);
        const build = await (await context.request.get(`${BASE}/api/build`)).json();
        const apiResponse = await context.request.get(`${BASE}/api/funding/${encodeURIComponent(pilot.official)}`);
        assert.equal(apiResponse.status(), 200);
        const api = await apiResponse.json();
        assert.equal(api.kind, "state");
        assert.equal(api.data.resolvedTargetKey, pilot.key);
        const mapModal = await openOfficial(page, pilot.name);
        const mapMoney = await inspectMoney(mapModal, pilot.key, pilot.raised, pilot.spent);
        await capture(page, `${label}-map-money`, mapMoney.section);
        const mapPositions = pilot.zip === "85701" && viewport.name === "phone" ? await positionsWitness(page, mapModal, pilot.official, `${label}-map`) : null;
        const expectedActions = officialActionsForTarget(pilot.key);
        const mapActions = pilot.zip === "85701" ? await inspectOfficialActions(page, mapModal, expectedActions, `${label}-map`) : null;
        await page.keyboard.press("Escape");
        let mapFederalRecords = null;
        if (pilot.zip === "85641") {
          const federal = await openOfficial(page, "Juan Ciscomani");
          const profile = await openSection(federal, "Public statements");
          assert.match(await profile.innerText(), /6,875 statements/);
          await capture(page, `${label}-map-profile`, profile);
          const money = await openSection(federal, "Campaign money");
          const federalApi = await (await context.request.get(`${BASE}/api/funding/congress%3AC001133`)).json();
          assert.equal(federalApi.kind, "funding");
          await money.getByText(federalApi.data.sentences[0], { exact: true }).waitFor({ state: "visible" });
          assert.ok((await money.innerText()).replace(/\s+/g, " ").includes(federalApi.data.sentences[0]));
          mapFederalRecords = await federalRecordsWitness(page, federal, `${label}-map`, false);
          await page.keyboard.press("Escape");
        }
        const meetings = await activityWitnesses(page, pilot.zip, label);
        const voting = pilot.zip === "85701" ? await votingWitness(page, label) : null;
        const votingFallback = viewport.name === "phone" && ["85701", "07866"].includes(pilot.zip) ? await votingFallbackWitness(page, label, pilot.zip === "85701" ? "outside-coverage" : "assigned-unresolved") : null;
        await page.goto(`${BASE}/ballot?zip=${pilot.zip}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.locator("[data-battlecard-pill]").first().waitFor({ state: "visible", timeout: 30_000 });
        const ballotModal = await openBallotCandidate(page, pilot.name);
        const ballotMoney = await inspectMoney(ballotModal, pilot.key, pilot.raised, pilot.spent);
        assert.equal(ballotMoney.text, mapMoney.text);
        await capture(page, `${label}-ballot-money`, ballotMoney.section);
        const ballotPositions = pilot.zip === "85701" && viewport.name === "phone" ? await positionsWitness(page, ballotModal, (await ballotModal.getAttribute("data-candidate-subject"))!, `${label}-ballot`) : null;
        if (mapPositions && ballotPositions) assert.deepEqual(ballotPositions, mapPositions, "Map and ballot must quote the same canonical person holdings");
        const ballotActions = pilot.zip === "85701" ? await inspectOfficialActions(page, ballotModal, expectedActions, `${label}-ballot`) : null;
        if (mapActions && ballotActions) {
          assert.deepEqual(mapActions.actualIds, ballotActions.actualIds);
          assert.equal(ballotActions.canonicalTarget, pilot.key);
        }
        await page.keyboard.press("Escape");
        if (pilot.zip === "07866") {
          const candidate = await openBallotCandidate(page, "Analilia Mejia");
          const sources = await openSection(candidate, "Sources");
          const filing = sources.locator("[data-filed-contact]");
          await filing.waitFor({ state: "visible" });
          assert.ok((await filing.getAttribute("data-filed-contact"))?.includes("mejia"));
          assert.match(await filing.innerText(), /Published filing contact/);
          assert.ok(await filing.locator('a[href^="mailto:"]').count());
          await capture(page, `${label}-ballot-filed-contact`, sources);
          await page.keyboard.press("Escape");
        }
        let ballotFederalRecords = null;
        if (pilot.zip === "85641") {
          const federal = await openBallotCandidate(page, "Juan Ciscomani");
          const profile = await openSection(federal, "Public statements");
          assert.match(await profile.innerText(), /6,875 statements/);
          await capture(page, `${label}-ballot-profile`, profile);
          ballotFederalRecords = await federalRecordsWitness(page, federal, `${label}-ballot`, true);
          assert.deepEqual(ballotFederalRecords, mapFederalRecords);
          await page.keyboard.press("Escape");
        }
        const population = viewport.name === "desktop" && theme === "dark" ? await allBallotMoney(page) : null;
        if (population) console.log(`${label}: opened and checked ${population.cardsOpened} ballot cards`);
        const ask = viewport.name === "desktop" && theme === "dark" ? await ballotAskMoney(page, pilot, label) : null;
        const area = await areaWitness(page, pilot.zip, label);
        const result = voting?.layoutFailure ? "FAIL" : "PASS";
        results.push({ label, result, error: voting?.layoutFailure ?? null, build, map: mapMoney.text, ballot: ballotMoney.text, canonicalCandidacyId: pilot.key, api, population, ask, meetings, voting, votingFallback, area, mapActions, ballotActions, mapPositions, ballotPositions, mapFederalRecords, ballotFederalRecords });
        console.log(`${result} ${label}${population ? `; ${population.cardsOpened} ballot cards individually opened` : ""}${voting?.layoutFailure ? `; ${voting.layoutFailure}` : ""}`);
      } catch (error) {
        await capture(page, `${label}-failure`).catch(() => {});
        results.push({ label, result: "FAIL", error: String(error), url: page.url() });
        console.error(`FAIL ${label}: ${String(error)}`);
      } finally { await context.close(); }
      writeFileSync(REPORT, JSON.stringify({ date: today(), base: BASE, runId: browser.runId, results, screenshots, screenshotsReadAsImages: [] }, null, 2) + "\n");
    }
  }
} finally { await browser.close(); }
if (results.some(r => r.result === "FAIL")) process.exitCode = 1;
