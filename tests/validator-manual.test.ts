import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { readValidatorManual, validatorLessons, writeValidatorLessons, type ValidatorObservation } from "../lib/control-plane/promotion/validator-manual.ts";
import { capturesForPublication } from "../lib/civic-data/worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-09-30T08:00:00.000Z";
const capture = (artifactId: string, url: string, text: string): WorkerPublicationCapture => ({
  evidence: { artifactId, contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, text, acquiredByAttemptId: `at-${artifactId}`,
    canonicalUrl: url, retrievedAt: NOW, sourceId: "fixture", methodRouteId: "fixture" },
  observedAt: NOW, httpStatus: 200, transport: "REACHABLE", partial: false,
} as WorkerPublicationCapture);

const portal = capture("art-portal", "https://sierravistaaz.portal.civicclerk.com/", "<h1>City Council</h1>");
const cityHome = capture("art-city", "https://www.sierravistaaz.gov/", `<a href="https://sierravistaaz.portal.civicclerk.com/">Agendas</a>`);
const passed: ValidatorObservation = { recordClass: "MEETING", state: "AZ", workItemId: "wi-a", published: 3,
  page: { url: portal.evidence.canonicalUrl, artifactId: "art-portal", contentHash: portal.evidence.contentHash },
  linking: { url: cityHome.evidence.canonicalUrl, artifactId: "art-city" }, refusal: null };

test("a pass registers the page it verified and the official link that made a vendor portal official", () => {
  const lessons = validatorLessons(passed, NOW);
  assert.deepEqual(lessons.map(l => [l.role, l.kind, l.outcome]), [["SHARED", "SOURCE_REGISTER", "YIELDED"], ["SHARED", "OFFICIAL_LINK", "YIELDED"]]);
  assert.match(lessons[1].summary, /sierravistaaz\.gov.*links sierravistaaz\.portal\.civicclerk\.com/);
});

test("a §3 refusal teaches the next worker why, and a transient hold teaches nothing", () => {
  const refused = validatorLessons({ ...passed, published: 0, linking: null, refusal: { code: "WORKER_PUBLICATION_PAGE_STALE", detail: "The saved page is older than the 12-hour meeting window." } }, NOW);
  assert.deepEqual(refused.map(l => [l.role, l.kind, l.outcome]), [["VALIDATOR", "SECTION3_REFUSAL", "FAILED"]]);
  assert.deepEqual(validatorLessons({ ...passed, published: 0, refusal: null }, NOW), []);
});

test("a later job reuses the saved official page another job captured, so its vendor-hosted page counts as official", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await writeValidatorLessons(repos, [passed], NOW)).written, 2);
  const manual = await readValidatorManual(repos);
  assert.deepEqual(manual.officialLinks.get("sierravistaaz.portal.civicclerk.com"), ["art-city"]);
  const held = new Map([portal, cityHome].map(c => [c.evidence.artifactId, c]));
  const readCapture = async (id: string) => held.get(id) ?? Promise.reject(new Error("missing"));
  // The new job saved only the portal page; without the manual it has no official page linking it.
  const alone = await capturesForPublication({ repos, workItemId: "wi-b", primaryId: "art-portal", results: [], readCapture });
  assert.deepEqual(alone.map(c => c.evidence.artifactId), ["art-portal"]);
  const reused = await capturesForPublication({ repos, workItemId: "wi-b", primaryId: "art-portal", results: [], readCapture, officialLinks: manual.officialLinks });
  assert.deepEqual(reused.map(c => c.evidence.artifactId), ["art-portal", "art-city"]);
  assert.ok((await readFieldManual(repos, { role: "SCOUT", state: "az" })).projection.lines.some(line => line.includes("counts as official")),
    "Scouts and Acquirers read the same lesson.");
});
