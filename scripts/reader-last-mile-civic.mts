import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import {
  everydayContactsFor,
  type EverydayContact,
} from "../lib/routing/everyday.ts";
import {
  currentEverydayRoutingProjection,
  everydayRoutingReadState,
} from "../lib/routing/everyday-data-plane.ts";
import { TOPIC_ROUTES } from "../lib/routing/topics.ts";
import { matchTopic } from "../lib/routing/match.ts";
import { answerQuestion } from "../lib/routing/ask.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { prepareReaderProofRuntime } from "./lib/reader-proof-runtime.ts";
import { telHref } from "../lib/officials/phone-numbers.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const cellId = (topicId: string, zip: string) => `${topicId}|${zip}`;
const contactIdentity = (topicId: string, zip: string, contact: EverydayContact) => JSON.stringify([
  topicId,
  zip,
  contact.topicId,
  [...contact.zips],
  contact.body,
  contact.service,
  contact.phone,
  contact.email,
  contact.requestUrl,
  contact.sourceUrl,
  contact.sourceOrg,
  contact.collectedAt,
  contact.verification,
  contact.note,
]);

const runtimeAuthorities = await prepareReaderProofRuntime();
const everydayRoutingRead = everydayRoutingReadState();
if (everydayRoutingRead.kind !== "PROMOTED") {
  throw new Error(`Everyday routing documentary authority is ${everydayRoutingRead.kind}, not PROMOTED.`);
}
assert.ok(everydayRoutingRead.metadata.sourceId, "The promoted everyday routing authority must retain its source id.");
assert.ok(everydayRoutingRead.metadata.version, "The promoted everyday routing authority must retain its source version.");
assert.ok(everydayRoutingRead.metadata.versionId, "The promoted everyday routing authority must retain its version id.");
assert.equal(
  runtimeAuthorities.find(({ id }) => id === "everyday-routing")?.versionId,
  everydayRoutingRead.metadata.versionId,
  "The documentary runtime and promoted everyday read state must name one exact version.",
);
const everydayRouting = currentEverydayRoutingProjection();
assert.deepEqual(everydayRouting, everydayRoutingRead.value);
const promotedRecords = [...everydayRouting.records];
const promotedRecordIds = new Set(promotedRecords.map(({ id }) => id));
assert.equal(promotedRecordIds.size, promotedRecords.length, "Promoted everyday record ids must be unique.");
const expectedContactRecords = promotedRecords.filter((record) => record.kind === "CONTACT");
const expectedOwedRecords = promotedRecords.filter((record) => record.kind === "CONTACT_OWED");
const promotedTopicIds = new Set(promotedRecords.map(({ topicId }) => topicId));
const promotedZips = new Set(promotedRecords.map(({ zip }) => zip));
const topicIds = [...promotedTopicIds].sort();
const zips = [...promotedZips].sort();
const derivedDenominator = {
  topics: promotedTopicIds.size,
  zips: promotedZips.size,
  cells: promotedTopicIds.size * promotedZips.size,
  contactAvailableCells: new Set(expectedContactRecords.map((record) => cellId(record.topicId, record.zip))).size,
  unknownContactOwedCells: new Set(expectedOwedRecords.map((record) => cellId(record.topicId, record.zip))).size,
  contactRecords: expectedContactRecords.length,
  contactSources: new Set(expectedContactRecords.map((record) => record.contact.sourceUrl)).size,
};
assert.deepEqual(everydayRouting.denominator, derivedDenominator, "The promoted everyday denominator must equal its exact records.");
floored(
  "verified everyday contact records",
  `promoted everyday routing ${everydayRoutingRead.metadata.versionId}`,
  everydayRouting.denominator.contactRecords,
  expectedContactRecords.filter(({ contact }) => contact.verification === "PAGE_FETCHED").length,
);
const promotedContactByIdentity = new Map<string, (typeof expectedContactRecords)[number]>();
for (const record of expectedContactRecords) {
  const identity = contactIdentity(record.topicId, record.zip, record.contact);
  assert.equal(promotedContactByIdentity.has(identity), false, `${record.id}: duplicate promoted contact identity`);
  promotedContactByIdentity.set(identity, record);
}
const promotedRecordIndexById = new Map(promotedRecords.map((record, index) => [record.id, index] as const));
const questions = topicIds.map(topicId => {
  const topic = TOPIC_ROUTES.find(row => row.id === topicId);
  assert.ok(topic, `${topicId}: promoted everyday topic has no software route`);
  const question = `Who can help with ${topic.examples.join(" and ")}?`;
  assert.equal(matchTopic(question)?.topicId, topicId, question);
  return { topicId, question, topic };
});
const browser = await launchGuarded({ label: "reader-last-mile-civic" });
const records: unknown[] = [];
const encountered = new Set<string>();
const encounteredOwed = new Set<string>();
const screenshots: string[] = [];
const layoutProofs: unknown[] = [];
mkdirSync("screenshots/reader-last-mile", { recursive: true });
try {
  for (const zip of zips) {
   for (const view of [{ name: "desktop", width: 1440, height: 1000, theme: "dark", placement: "sidebar", all: true }, { name: "desktop", width: 1440, height: 1000, theme: "light", placement: "sidebar", all: false }, ...["map", "sidebar"].flatMap(placement => ["dark", "light"].map(theme => ({ name: "phone", width: 390, height: 844, theme, placement, all: false })))]) {
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
    if (view.placement === "map" && await page.locator('[data-pill-cluster="sidebar"]').count()) await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
    if (view.placement === "sidebar" && !(await page.locator('[data-pill-cluster="sidebar"]').count())) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.locator(`[data-pill-cluster="${view.placement}"]`).waitFor({ state: "visible" });
    const point = resolveZip(zip); assert.ok(point.ok);
    const response = await page.request.get(`${base}/api/meetings?${new URLSearchParams({ zip, lat: String(point.centroid.lat), lng: String(point.centroid.lng) })}`);
    assert.equal(response.status(), 200);
    const coverage = (await response.json()).coverage as CoverageSummary;
    assert.ok(coverage);
    await page.locator("[data-ask-pill]").first().click();
    const panel = page.locator("[data-ask-panel]");
    const box = panel.locator("[data-ask-box]");
    for (const { topicId, question, topic } of (view.all ? questions : questions.slice(0, 1))) {
      const expected = everydayContactsFor(topicId, zip, everydayRouting);
      const expectedRecords = expectedContactRecords.filter((record) =>
        record.topicId === topicId && record.zip === zip
      );
      assert.deepEqual(expected, expectedRecords.map(({ contact }) => contact));
      const canonical = answerQuestion(question, coverage, zip, { everydayRouting });
      assert.equal(canonical.answer.kind, "ROUTED");
      assert.deepEqual(canonical.contacts, expected);
      await box.fill(question);
      const answered = page.waitForResponse(r => new URL(r.url()).pathname === "/api/ask/grounded" && r.request().method() === "POST", { timeout: 90_000 });
      await box.press("Enter");
      const actualResponse = await answered;
      assert.equal(actualResponse.status(), 200);
      const grounded = await actualResponse.json();
      await panel.getByText(topic.label, { exact: true }).waitFor({ state: "visible" });
      if (zip === "07866" && topicId === "property-taxes") {
        assert.ok(grounded.subject, "The Rockaway regression must exercise a bound grounded subject");
        assert.equal(grounded.contacts?.length ?? 0, 0, "The Rockaway regression must exercise the contactless grounded path");
        const preserved = panel.locator("[data-ask-preserved-contact]");
        await preserved.getByText(topic.label, { exact: true }).waitFor({ state: "visible" });
        await preserved.locator('a[href="tel:9736272000;ext=228"]').waitFor({ state: "visible" });
        assert.equal(await preserved.locator('a[href="tel:9736272000228"]').count(), 0, "The extension must not corrupt the dialable number");
        assert.ok(!(await preserved.innerText()).includes(grounded.subject.name), "The routed tax collector must retain its own body attribution");
      }
      assert.equal(await panel.locator('[data-ask-grounded-state="NOTHING_HELD"]').count(), 0, "The held civic answer must not be contradicted by an empty engine's absence sentence.");
      const text = normalize(await panel.innerText());
      for (const contact of expected) {
        const promotedRecord = promotedContactByIdentity.get(contactIdentity(topicId, zip, contact));
        assert.ok(promotedRecord, `${zip}/${topicId}: returned contact has no exact promoted record`);
        const canonicalRecordIndex = promotedRecordIndexById.get(promotedRecord.id);
        assert.notEqual(canonicalRecordIndex, undefined, `${promotedRecord.id}: promoted record index`);
        const expectedFields = [contact.body, contact.service, contact.phone, contact.email, contact.note, `This was sourced from ${contact.sourceOrg}.`].filter((field): field is string => Boolean(field));
        for (const field of expectedFields) assert.ok(text.includes(normalize(field)), `${zip}/${topicId}: ${field}`);
        for (const href of [contact.phone && telHref(contact.phone), contact.email && `mailto:${contact.email}`, contact.requestUrl].filter(Boolean)) {
          assert.ok(await panel.locator(`a[href="${href}"]`).count(), `${zip}/${topicId}: ${href}`);
        }
        encountered.add(promotedRecord.id);
        records.push({ surface: "civic-routing", zip, viewport: view.name, theme: view.theme, topicId, canonicalRecordId: promotedRecord.id, canonicalRecordIndex, everydayRoutingVersionId: everydayRoutingRead.metadata.versionId, sourceUrl: contact.sourceUrl, sourceOrg: contact.sourceOrg, collectedAt: contact.collectedAt, verification: contact.verification, expectedFields, returnedFields: expectedFields, returnedContact: contact, question, canonicalAnswerSha256: hash(JSON.stringify(canonical)), renderedTextSha256: hash(text), grounding: "Exact promoted topic/ZIP contact record; all factual contact fields checked against its holding, independent of model response." });
      }
      if (!expected.length) {
        const owed = expectedOwedRecords.filter((record) => record.topicId === topicId && record.zip === zip);
        assert.equal(owed.length, 1, `${zip}/${topicId}: an empty contact cell requires exactly one promoted CONTACT_OWED record`);
        const [miss] = owed;
        assert.ok(miss);
        encounteredOwed.add(miss.id);
        records.push({ surface: "civic-routing", zip, topicId, canonicalRecordId: miss.id, everydayRoutingVersionId: everydayRoutingRead.metadata.versionId, disposition: "SOURCE/HOLDING_UNAVAILABLE", holdingStatus: miss.holdingStatus, sourceUrl: miss.evidenceSourceUrl, reviewedAt: miss.reviewedAt, reason: miss.reason, expectedCount: 0, returnedCount: 0 });
      } else {
        assert.equal(
          expectedOwedRecords.some((record) => record.topicId === topicId && record.zip === zip),
          false,
          `${zip}/${topicId}: a contact-bearing cell cannot also carry CONTACT_OWED`,
        );
      }
      if (topicId === topicIds[0]) {
        const geometry = await panel.evaluate(element => {
          const expansion = element.closest(".ask-expansion")!;
          const rectangle = expansion.getBoundingClientRect();
          const style = getComputedStyle(expansion);
          const row = element.closest("[data-pill-cluster]")!.querySelector(".map-floaters-row")!.getBoundingClientRect();
          return { left: rectangle.left, right: rectangle.right, top: rectangle.top, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height, viewportWidth: innerWidth, viewportHeight: innerHeight, overflowX: expansion.scrollWidth > expansion.clientWidth + 1, overflowY: style.overflowY, rowBottom: row.bottom, placement: element.closest("[data-pill-cluster]")!.getAttribute("data-pill-cluster") };
        });
        assert.equal(geometry.placement, view.placement);
        assert.equal(geometry.overflowX, false, `${zip}/${view.name}/${view.theme}/${view.placement}: horizontal answer overflow`);
        if (view.name === "phone" && view.placement === "map") {
          assert.ok(geometry.width >= view.width - 26, "The floating Ask answer needs the phone reading width, independent of pill width.");
          assert.ok(geometry.left >= 11 && geometry.right <= view.width - 11 && geometry.top >= geometry.rowBottom && geometry.bottom <= view.height - 11, "The floating answer must fit below its own pill and inside the phone viewport.");
          assert.equal(geometry.overflowY, "auto", "A long floating answer must retain a reachable scroll tail.");
        }
        const tail = panel.locator("p").last();
        await tail.scrollIntoViewIfNeeded();
        const tailReadback = await tail.evaluate(element => {
          const rectangle = element.getBoundingClientRect();
          const x = Math.min(innerWidth - 1, Math.max(0, rectangle.left + rectangle.width / 2));
          const y = Math.min(innerHeight - 1, Math.max(0, rectangle.top + rectangle.height / 2));
          const front = document.elementFromPoint(x, y);
          return { text: element.textContent, top: rectangle.top, bottom: rectangle.bottom, viewportHeight: innerHeight, unobscured: Boolean(front && element.contains(front)), frontClass: front?.className ?? null };
        });
        assert.ok(tailReadback.top >= 0 && tailReadback.bottom <= view.height + 1 && tailReadback.unobscured, `${zip}/${view.name}/${view.theme}/${view.placement}: the reader must reach the final answer line above ambient map chrome`);
        layoutProofs.push({ zip, viewport: view.name, theme: view.theme, placement: view.placement, geometry, tailReadback, status: "PROVEN" });
        const path = `screenshots/reader-last-mile/${zip}-${view.name}-${view.theme}${view.name === "phone" && view.placement === "sidebar" ? "-sidebar" : ""}-civic.png`;
        await box.scrollIntoViewIfNeeded(); await page.screenshot({ path }); screenshots.push(path);
      }
    }
    await context.close();
    console.log(JSON.stringify({ zip, viewport: view.name, theme: view.theme, placement: view.placement, contactRecordsProved: encountered.size }));
   }
  }
} finally { await browser.close(); }
assert.equal(encountered.size, everydayRouting.denominator.contactRecords);
assert.equal(encounteredOwed.size, everydayRouting.denominator.unknownContactOwedCells);
const sourcePaths = ["lib/routing/everyday.ts", "lib/routing/everyday-data-plane.ts", "lib/routing/topics.ts", "lib/routing/ask.ts", "lib/officials/phone-numbers.ts", "components/ask/ask-box.tsx", "components/shell/pill-cluster.tsx", "app/globals.css"];
writeFileSync("docs/evidence/reader-last-mile-civic.json", JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(path, "utf8"))])), everydayRoutingAuthority: { kind: everydayRoutingRead.kind, recordClass: everydayRoutingRead.metadata.recordClass, scope: everydayRoutingRead.metadata.scope, sourceId: everydayRoutingRead.metadata.sourceId, version: everydayRoutingRead.metadata.version, versionId: everydayRoutingRead.metadata.versionId, sourceThrough: everydayRoutingRead.metadata.sourceThrough, projectionSha256: hash(JSON.stringify(everydayRouting)), denominator: everydayRouting.denominator }, expectedCount: everydayRouting.denominator.contactRecords, renderedCount: encountered.size, expectedDispositionCount: everydayRouting.denominator.unknownContactOwedCells, recordedDispositionCount: encounteredOwed.size, records, layoutProofs, screenshots }, null, 2) + "\n");
