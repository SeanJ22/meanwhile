import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { newFieldManualEntry, readFieldManual } from "../lib/control-plane/field-manual.ts";
import { readValidatorOfficialLinks, validatorLessons, writeValidatorLessons, type ValidatorObservation } from "../lib/control-plane/promotion/validator-manual.ts";
import { linkingPageFrom, section3Page } from "../lib/control-plane/promotion/section3.ts";
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
  const host = "sierravistaaz.portal.civicclerk.com";
  assert.deepEqual((await readValidatorOfficialLinks(repos, host)).artifactIds, ["art-city"]);
  const held = new Map([portal, cityHome].map(c => [c.evidence.artifactId, c]));
  const readCapture = async (id: string) => held.get(id) ?? Promise.reject(new Error("missing"));
  // The new job saved only the portal page; without the manual it has no official page linking it.
  const alone = await capturesForPublication({ repos, workItemId: "wi-b", primaryId: "art-portal", results: [], readCapture });
  assert.deepEqual(alone.map(c => c.evidence.artifactId), ["art-portal"]);
  const reused = await capturesForPublication({ repos, workItemId: "wi-b", primaryId: "art-portal", results: [], readCapture,
    officialLinks: async canonicalHost => (await readValidatorOfficialLinks(repos, canonicalHost)).artifactIds });
  assert.deepEqual(reused.map(c => c.evidence.artifactId), ["art-portal", "art-city"]);
  assert.deepEqual(section3Page({ url: portal.evidence.canonicalUrl, text: portal.evidence.text, retrievedAt: NOW,
    linkingPage: linkingPageFrom(portal.evidence.canonicalUrl, reused.map(value => value.evidence)) }, "MEETING", NOW),
  { ok: true, kind: "OFFICIAL", reason: null }, "the saved official page still supplies the actual §3 source proof");
  assert.ok((await readFieldManual(repos, { role: "SCOUT", state: "az" })).projection.lines.some(line => line.includes("counts as official")),
    "Scouts and Acquirers read the same lesson.");
});

test("host lookup preserves other-source and cross-state links, newest ordering and the existing three-copy selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "validator-links-"));
  try {
    for (const repos of [createMemoryRepositories(), await createFileRepositories(directory)]) {
      const host = "sierravistaaz.portal.civicclerk.com";
      const links = Array.from({ length: 8 }, (_, n) => newFieldManualEntry(`source-${n}`, `official-${n}`, {
        role: n === 0 ? "VALIDATOR" : "SHARED", kind: "OFFICIAL_LINK", outcome: "YIELDED", states: [n % 2 ? "nh" : "nj"],
        recordClasses: [n % 2 ? "budget" : "election"], title: "Saved official link", summary: "A different job learned it.",
        observedAt: n < 4 ? NOW : "2026-09-29T00:00:00.000Z", payload: { host, linkingArtifactId: `saved-${n}` } }));
      for (const entry of [...links].reverse()) await repos.fieldManual.put(entry.id, entry, NOW);
      for (const [key, changes] of [
        ["other-host", { payload: { host: "unrelated.example", linkingArtifactId: "wrong-host" } }],
        ["wrong-role", { role: "SCOUT" as const }], ["failed", { outcome: "FAILED" as const }],
        ["invalid", { payload: { host, linkingArtifactId: 42 } }],
      ] as const) {
        const entry = { ...links[0], ...changes, id: `invalid-${key}` };
        await repos.fieldManual.put(entry.id, entry, NOW);
      }
      const fail = async (): Promise<never> => { throw new Error("COUNTRY_MANUAL_ARRAY_READ"); };
      repos.fieldManual.slice = fail; repos.fieldManual.list = fail; repos.fieldManual.listWhereNarrowed = fail;
      const expected = links.slice(0, 4).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3)
        .map(entry => (entry.payload as { linkingArtifactId: string }).linkingArtifactId);
      const first = await readValidatorOfficialLinks(repos, host);
      assert.equal(first.error, undefined);
      assert.deepEqual(first.artifactIds, expected);
      const newest = newFieldManualEntry("fresh-source", "latest", { role: "SHARED", kind: "OFFICIAL_LINK", outcome: "YIELDED",
        title: "A fresh official page", summary: "The next pass must see this link.", observedAt: "2026-10-01T00:00:00.000Z",
        payload: { host, linkingArtifactId: "newest" } });
      await repos.fieldManual.put(newest.id, newest, NOW);
      assert.deepEqual((await readValidatorOfficialLinks(repos, host)).artifactIds, ["newest", ...expected.slice(0, 2)], "no country host cache hides a later lesson");
      assert.deepEqual((await readValidatorOfficialLinks(repos, "absent.example")).artifactIds, []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("publication reads learned links only for a nonofficial primary host and tolerates failed inherited reads", async () => {
  const repos = createMemoryRepositories();
  let lookups = 0;
  const captures = new Map([portal, cityHome].map(value => [value.evidence.artifactId, value]));
  const readCapture = async (id: string) => captures.get(id) ?? Promise.reject(new Error("missing"));
  const officialLinks = async (host: string) => {
    lookups++;
    assert.equal(host, "sierravistaaz.portal.civicclerk.com");
    return ["missing", "art-city", "missing-again", "must-not-read"];
  };
  assert.deepEqual((await capturesForPublication({ repos, workItemId: "wi-next-state", primaryId: "art-city", results: [], readCapture, officialLinks }))
    .map(value => value.evidence.artifactId), ["art-city"]);
  assert.equal(lookups, 0, "an official source needs no inherited host inventory");
  assert.deepEqual((await capturesForPublication({ repos, workItemId: "wi-next-state", primaryId: "art-portal", results: [],
    readCapture: async id => { assert.notEqual(id, "must-not-read"); return readCapture(id); }, officialLinks })).map(value => value.evidence.artifactId), ["art-portal", "art-city"]);
  assert.equal(lookups, 1);
  const failed = await capturesForPublication({ repos, workItemId: "wi-next-state", primaryId: "art-portal", results: [], readCapture,
    officialLinks: async () => { throw new Error("MANUAL_UNAVAILABLE"); } });
  assert.deepEqual(failed.map(value => value.evidence.artifactId), ["art-portal"]);
  const manual = await readValidatorOfficialLinks({ ...repos, fieldManual: { ...repos.fieldManual,
    visitSlice: async (_query, visit) => {
      const entry = validatorLessons(passed, NOW)[1];
      await visit({ id: entry.id, revision: 1, updatedAt: NOW, value: entry });
      throw new Error("MANUAL_FAILED_AFTER_FIRST_PAGE");
    } } }, "sierravistaaz.portal.civicclerk.com");
  assert.deepEqual(manual, { artifactIds: [], offered: 0, error: "MANUAL_FAILED_AFTER_FIRST_PAGE" }, "a failed read does not inherit a partial inventory");
});

test("Postgres filters the exact learned host before streaming only publication's scalar evidence", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb)");
    await pg.exec(`INSERT INTO cp_field_manual_entries SELECT 'link-'||lpad(n::text,4,'0'),1,now(),jsonb_build_object(
      'id','link-'||lpad(n::text,4,'0'),'role','SHARED','kind','OFFICIAL_LINK','outcome','YIELDED',
      'observedAt',to_char(timestamptz '2026-09-30T08:00:00Z'-n*interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'states',jsonb_build_array('nh'),'recordClasses',jsonb_build_array(),'platforms',jsonb_build_array(),
      'placeResults',jsonb_build_array(jsonb_build_object('place','UNRELATED_COUNTRY_PLACE_HISTORY')),
      'payload',jsonb_build_object('host',CASE WHEN n<300 THEN 'sierravistaaz.portal.civicclerk.com' ELSE 'unrelated-'||n||'.example' END,
      'linkingArtifactId','saved-'||n,'outcomes',repeat('UNRELATED_COUNTRY_PAYLOAD',100))) FROM generate_series(0,999) n`);
    let pages = 0, returned = 0;
    const sql: Sql = { query: async (text, params = []) => {
      assert.match(text, /value#>>'\{payload,host\}'=\$11::text/);
      assert.equal(params[10], "sierravistaaz.portal.civicclerk.com");
      const rows = (await pg.query(text, [...params])).rows;
      pages++; returned += rows.length;
      assert.ok(rows.length <= 250);
      assert.equal(JSON.stringify(rows).includes("UNRELATED_COUNTRY"), false);
      for (const row of rows) assert.equal(((row as { value: { payload: { host: string } } }).value.payload.host), params[10]);
      return rows;
    } };
    const links = await readValidatorOfficialLinks({ fieldManual: pgFieldManualRepository(sql) }, "sierravistaaz.portal.civicclerk.com");
    assert.equal(links.error, undefined);
    assert.deepEqual(links.artifactIds, ["saved-0", "saved-1", "saved-2"]);
    assert.equal(links.offered, 300);
    assert.equal(returned, 300);
    assert.ok(pages > 1, "same-host history is consumed as bounded pages and reduced to the existing three selections");
  } finally { await pg.close(); }
});
