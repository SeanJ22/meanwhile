import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pageDoorDraft } from "../lib/doors/page-doors.ts";
import { PAGE_REFRESH_PER_PASS, pageDoorUrl, pageDoorsDue, recheckPage, refreshDuePageDoors } from "../lib/doors/page-refresh.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { WebsiteWait } from "../lib/doors/probe-fetch.ts";
import { upsertDerivedDoor, type DoorRecord } from "../lib/doors/registry.ts";
import { fetchCapture } from "../lib/facts/capture.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureEntity } from "../lib/facts/entities.ts";
import { publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { factDb } from "./helpers/fact-db.ts";

/** DB-29: a page door past its refresh date is re-read and its published values are checked against the page. */

const NOW = "2026-10-06T12:00:00.000Z";
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

function page(id: string, lastSuccessDays: number, over: Partial<DoorRecord> = {}): DoorRecord {
  return {
    formatVersion: 1, doorId: id, kind: "page", ocdId: null, bodyIds: [], hosts: ["town.example"],
    config: { url: "https://town.example/council", recordClass: "OFFICIAL_ROSTER" }, holds: ["official-roster"],
    checkEveryMinutes: 30 * 24 * 60, notes: "", meeting: null, status: "OPEN", lastSuccessAt: daysAgo(lastSuccessDays),
    lastFailureAt: null, shutSince: null, readNow: false, origin: "DERIVED", editedAt: null, updatedAt: daysAgo(40), validators: null,
    ...over,
  };
}

describe("DB-29: page doors past their refresh date", () => {
  it("lists only open page doors past their check, most late first", () => {
    const due = pageDoorsDue([
      page("fresh", 5),
      page("late", 35),
      page("later", 60),
      page("shut", 90, { status: "SHUT" }),
      page("feed", 90, { kind: "legistar" }),
    ], NOW);
    assert.deepEqual(due.map((d) => d.doorId), ["later", "late"]);
  });

  it("caps one pass so a backlog drains over passes", () => {
    const many = Array.from({ length: PAGE_REFRESH_PER_PASS + 10 }, (_, i) => page(`p${i}`, 40 + i));
    assert.equal(pageDoorsDue(many, NOW).length, PAGE_REFRESH_PER_PASS);
    assert.equal(pageDoorsDue(many, NOW, 3).length, 3);
    assert.equal(pageDoorsDue(many, NOW, 0).length, 0);
  });

  it("re-fetches the address the door was keyed on", () => {
    assert.equal(pageDoorUrl(page("a", 1)), "https://town.example/council");
    assert.equal(pageDoorUrl(page("b", 1, { config: {} })), null);
  });
});

describe("DB-29: the re-read check", () => {
  const html = "<ul><li>Mayor Jane Doe</li><li><a href='tel:6025550100'>(602) 555-0100</a></li></ul>";
  it("confirms and moves the checked date when every value is still there", () => {
    assert.deepEqual(recheckPage(html, [{ field: "name", value: "Jane Doe" }, { field: "phone", value: "(602) 555-0100" }], NOW), { kind: "CONFIRMED", confirmedAt: NOW });
  });
  it("names the fields that are no longer on the page and confirms nothing", () => {
    assert.deepEqual(recheckPage(html, [{ field: "name", value: "John Roe" }, { field: "phone", value: "(602) 555-0100" }], NOW), { kind: "CHANGED", changedFields: ["name"] });
  });
  it("an empty page or no published values is unreadable, never changed", () => {
    assert.deepEqual(recheckPage("  ", [{ field: "name", value: "Jane Doe" }], NOW), { kind: "UNREADABLE" });
    assert.deepEqual(recheckPage(html, [], NOW), { kind: "UNREADABLE" });
  });
});

describe("DB-29: the pass re-reads due pages and restamps what still holds", () => {
  const URL = "https://clerksboards.tucsonaz.gov/boards/15";
  const BODY = "ocd-division/country:us/state:az/place:tucson#tccc";
  const PUBLISHED = daysAgo(40);
  const roster = (chair: string) => `<html><body><h1>Tucson Convention Center Commission</h1><table>
    <tr><td>${chair}</td><td>Chairperson</td></tr><tr><td>Jose Jimenez</td><td>Vice Chairperson</td></tr></table>
    <p>Call <a href="tel:5207914101">(520) 791-4101</a></p></body></html>`;
  const serve = (status: number, body: string, calls: string[] = []): ProbeFetch => async (url) => {
    calls.push(url);
    return { status, headers: { get: () => "text/html" }, bytes: async () => new TextEncoder().encode(body) };
  };

  /** A roster page whose two members went live 40 days ago, and its page door last read then too. */
  async function setup() {
    const facts = await factDb();
    const repos = createMemoryRepositories();
    const vault = new MemoryEvidenceStore();
    await ensureEntity(facts.query, { id: BODY, kind: "body", name: "Tucson Convention Center Commission", state: "AZ", parentId: null });
    const read = await fetchCapture({ url: URL, repos, vault, fetch: serve(200, roster("Ned Beman")), now: PUBLISHED });
    assert.ok(!("error" in read));
    await publishRosterFacts(facts, { body: { id: BODY, name: "Tucson Convention Center Commission", state: "AZ", parentId: null }, capture: read.capture,
      complete: false, producedBy: "test", members: [{ recordId: "a", fields: { name: "Ned Beman", office: "Chairperson" } }, { recordId: "b", fields: { name: "Jose Jimenez" } }] },
    factClocks(null), new Date(PUBLISHED));
    const draft = pageDoorDraft({ url: URL, recordClass: "OFFICIAL_ROSTER", retrievedAt: PUBLISHED, foundBy: null })!;
    await upsertDerivedDoor(repos.doors, draft, PUBLISHED, PUBLISHED);
    const row = await repos.doors.mustRead(draft.doorId);
    await repos.doors.compareAndSet(draft.doorId, row.revision, { ...row.value, lastSuccessAt: PUBLISHED }, PUBLISHED);
    const doors = async () => (await repos.doors.list()).map((door) => door.value);
    const live = () => facts.query(`SELECT f.field, f.checked_at, s.fetched_at FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
      WHERE f.status = 'live' ORDER BY f.id`);
    const pass = async (fetch: ProbeFetch) => refreshDuePageDoors({ repos, facts, vault, fetch, doors: await doors(), now: NOW, clock: () => NOW, purge: async () => ({ purged: true }) });
    return { facts, repos, door: draft.doorId, live, pass };
  }
  const iso = (at: unknown) => new Date(at as string).toISOString();

  it("a page that still shows every value moves each fact's checked date and receipt to the new read, with no Send", async () => {
    const { repos, door, live, pass } = await setup();
    const before = await live();
    assert.ok(before.length >= 3 && before.every((row) => iso(row.checked_at) === PUBLISHED));
    const report = await pass(serve(200, roster("Ned Beman").replace("</body>", "<p>Updated this week.</p></body>")));
    assert.deepEqual({ ...report, failures: report.failures.length }, { looked: 1, confirmed: 1, restamped: before.length, changed: 0, unreadable: 0, waiting: 0, failures: 0 });
    assert.ok((await live()).every((row) => iso(row.checked_at) === NOW && iso(row.fetched_at) === NOW), "each fact now cites the copy saved by this read");
    assert.equal((await repos.doors.mustRead(door)).value.lastSuccessAt, NOW);
    assert.deepEqual(pageDoorsDue((await repos.doors.list()).map((row) => row.value), NOW), []);
  });

  it("the same bytes read again keep their one saved copy and move the checked date", async () => {
    const { live, pass } = await setup();
    assert.equal((await pass(serve(200, roster("Ned Beman")))).confirmed, 1);
    assert.ok((await live()).every((row) => iso(row.checked_at) === NOW && iso(row.fetched_at) === PUBLISHED));
  });

  it("a page that lost a value restamps nothing, records the read, and hands the page back with the field that moved", async () => {
    const { repos, door, live, pass } = await setup();
    const report = await pass(serve(200, roster("Ana Roe")));
    assert.equal(report.changed, 1);
    assert.equal(report.restamped, 0);
    assert.ok((await live()).every((row) => iso(row.checked_at) === PUBLISHED));
    assert.equal((await repos.doors.mustRead(door)).value.lastSuccessAt, NOW);
    assert.match(report.failures.join(), /no saved work instructions/, "a page with no worker instructions says so rather than dropping the change");
  });

  it("a page that does not answer confirms nothing and goes down the door's failure path", async () => {
    const { repos, door, live, pass } = await setup();
    const report = await pass(serve(503, ""));
    assert.equal(report.unreadable, 1);
    assert.equal(report.restamped, 0);
    assert.ok((await live()).every((row) => iso(row.checked_at) === PUBLISHED));
    const after = (await repos.doors.mustRead(door)).value;
    assert.equal(after.lastFailureAt, NOW);
    assert.equal(after.lastSuccessAt, PUBLISHED);
    assert.equal(after.transportFailures, 1);
  });

  it("a website that asked to be left alone is not counted as read or failed", async () => {
    const { repos, door, pass } = await setup();
    const report = await pass(async () => { throw new WebsiteWait(Date.parse(NOW) + 60_000, "HOURLY_ALLOWANCE"); });
    assert.deepEqual([report.looked, report.waiting, report.unreadable], [0, 1, 0]);
    assert.equal((await repos.doors.mustRead(door)).value.lastFailureAt, null);
  });

  it("a due page no live fact cites is not fetched", async () => {
    const { facts, pass } = await setup();
    await facts.query("UPDATE fact SET status = 'superseded'");
    const calls: string[] = [];
    const report = await pass(serve(200, roster("Ned Beman"), calls));
    assert.deepEqual([report.looked, calls.length], [0, 0]);
  });
});
