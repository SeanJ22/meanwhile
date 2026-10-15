import assert from "node:assert/strict";
import test from "node:test";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { capturedText, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { statewideRoster, verifyStatewideOfficialPage } from "../lib/sources/statewide/parse.ts";

const T1 = "2026-10-14T10:00:00.000Z", T2 = "2026-10-14T11:00:00.000Z";
/* A real member page carries kilobytes of site chrome around the few facts read from it. */
const chrome = `<footer>${"<p>Site navigation, accessibility notices and agency links.</p>".repeat(4000)}</footer>`;
const page = (name: string) => `<html><body><h1>${name}, Secretary of State</h1><p>New Jersey Secretary of State ${name} was appointed by the Governor.</p>${chrome}</body></html>`;

function release(name: string, url: string, at: string, html = page(name)) {
  const verified = verifyStatewideOfficialPage({ sourceId: "association", sourceOrg: "Association fixture", sourceUrl: "https://association.example/members",
    collectedAt: at, state: "nj", name, officeTitle: "Secretary of State", profileUrls: [url] }, { url, html, retrievedAt: at });
  assert.ok("person" in verified);
  return { roster: statewideRoster("nj", [verified.person], at), acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body: html, retrievedAt: at }] };
}
const publish = (store: MemoryRoutineDataStore, vault: MemoryEvidenceStore, read: ReturnType<typeof release>, now: string) =>
  publishPeopleSource({ store, vault, state: "nj", sourceId: "statewide-executive-sources", ...read,
    releaseId: read.acquisitions.map(row => `${row.finalUrl}:${row.body.length}`).join("|"), now });
const candidates = (store: MemoryRoutineDataStore) => (store as unknown as { candidates: Map<string, CandidateVersionRecord> }).candidates;

test("a people candidate holds vault references and the extracted people, never the pages", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), url = "https://office.example.gov/about-jordan";
  const read = release("Jordan Reader", url, T1);
  const published = await publish(store, vault, read, T1);
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
  const stored = JSON.stringify(candidates(store).get(published.candidate.id)!.candidate);
  assert.ok(read.acquisitions[0]!.body.length > 200_000);
  assert.ok(stored.length < 16 * 1024, `${stored.length} bytes`);
  assert.ok(!stored.includes("Site navigation"));
  const [capture] = (published.candidate.normalizedPayload as { captures: StatePeopleCapture[] }).captures;
  assert.equal(await capturedText(vault, capture!), read.acquisitions[0]!.body, "the exact page comes back from the vault");
});

test("a newer read orders after the promoted version, including one versioned by a content hash", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), url = "https://office.example.gov/about-jordan";
  const first = await publish(store, vault, release("Jordan Reader", url, T1), T1);
  const second = await publish(store, vault, release("Jordan Reader", url, T2, page("Jordan Reader").replace("appointed", "appointed in 2025")), T2);
  assert.ok(second.outcome.promoted, JSON.stringify(second.outcome.candidate.receipt));
  assert.ok(second.candidate.temporal.version > first.candidate.temporal.version);
  assert.ok(second.candidate.temporal.version > "f".repeat(64), "sorts after any earlier hash version");
});

test("a re-read with unchanged values writes no candidate, and a refused one is recorded on the candidate it repeats", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), url = "https://office.example.gov/about-jordan";
  await publish(store, vault, release("Jordan Reader", url, T1), T1);
  await publish(store, vault, release("Jordan Reader", url, T1), T2);
  const rows = candidates(store).size;
  const again = await publish(store, vault, release("Jordan Reader", url, T1), "2026-10-14T12:00:00.000Z");
  assert.ok(again.outcome.confirmed, "confirmed against the held version");
  assert.equal(candidates(store).size, rows);

  const refusedStore = new MemoryRoutineDataStore();
  const unverified = { ...release("Jordan Reader", url, T1), acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body: "<html><body>Office closed.</body></html>", retrievedAt: T1 }] };
  const refused = await publish(refusedStore, vault, unverified, T1);
  assert.equal(refused.outcome.promoted, null);
  const refusedRows = candidates(refusedStore).size;
  const repeat = await publish(refusedStore, vault, unverified, T2);
  assert.equal(candidates(refusedStore).size, refusedRows, "the same values meeting the same refusal write no second candidate");
  assert.equal(repeat.outcome.candidate.candidate.id, refused.outcome.candidate.candidate.id);
  assert.ok((await refusedStore.events(refused.outcome.candidate.candidate.id)).some(event => event.detail.startsWith("RECHECKED_UNCHANGED")));
});
