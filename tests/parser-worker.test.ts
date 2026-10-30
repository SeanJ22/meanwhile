import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CAPABILITY_DDL, capabilityLog, reopenDeadEnds } from "../lib/core/capability.ts";
import { LEAD_DDL, WORK_DDL, newestFirst, workList, type WorkInput } from "../lib/core/work.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { workWaiting } from "../lib/core/work-counts.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { loadParsers, type PlatformParser } from "../lib/sources/parser-hook.ts";
import { LEAD_ATTEMPTS, runParserWorkers, type LeadDeps } from "../lib/sources/parser-worker.ts";
import { PLATFORM_PATTERNS, platformOf } from "../lib/sources/platform-of.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-30T12:00:00.000Z");
const CALENDAR = readFileSync(join(ROOT, "tests", "fixtures", "legistar-insite-pima-calendar-this-month.html"), "utf8");
const URL_OF_LEAD = "https://pima.legistar.com/Calendar.aspx";
const GOVERNMENT_PAGE = "https://www.pima.gov/government/agendas";
const PAGES = { [URL_OF_LEAD]: CALENDAR, [GOVERNMENT_PAGE]: `<html><body><a href="${URL_OF_LEAD}">Board of Supervisors agendas and minutes</a></body></html>` };
/** The shape of a waiting production lead: a vendor calendar that a government's own page linked, filed under that government's board. */
const productionLead = (over: Partial<WorkInput> = {}): WorkInput => ({ kind: "lead", url: URL_OF_LEAD, subjectId: "az:county:county-of-pima#governing",
  placeId: "az:county:county-of-pima", state: "AZ", value: { platform: "legistar-insite" }, priority: newestFirst("2026-10-22T13:51:46.148Z"),
  dueAt: "2026-10-22T13:51:46.148Z", origin: { from: "loader" }, source: { source: "Found by a hunter", foundOn: GOVERNMENT_PAGE }, ...over });

const clock = { now: NOW };
async function setup(pages: Record<string, string> = PAGES, parsers?: ReadonlyMap<string, PlatformParser>, otherwise?: string) {
  const facts = await factDb();
  await ensureFactEntities(facts, ROOT, ["az"]);
  for (const ddl of [...WORK_DDL, ...LEAD_DDL]) await facts.pg.exec(ddl);
  const list = workList(facts.query, { owner: "parser-test", leaseMs: 300_000, now: () => clock.now });
  const requests: string[] = [];
  const fetch: ProbeFetch = async url => {
    requests.push(url);
    const body = pages[url] ?? otherwise;
    return { status: body === undefined ? 404 : 200, finalUrl: url, headers: new Headers({ "content-type": "text/html" }), bytes: async () => Buffer.from(body ?? "") };
  };
  const deps: LeadDeps = { list, facts, repos: createMemoryRepositories(), vault: new MemoryEvidenceStore(), fetch, clocks: factClocks(null),
    parsers: parsers ?? await loadParsers(), now: () => clock.now, purge: async () => ({ purged: true }) };
  const run = (maxClaims?: number) => runParserWorkers({ deps, concurrency: 4, maxClaims, stopRequested: () => false });
  return { facts, list, deps, requests, run };
}

test("a link goes from the work list through its parser and the Slide, and each new link is read next, once", async t => {
  const { facts, list, deps, requests, run } = await setup(PAGES, undefined, "<html><body>A sitting</body></html>");
  t.after(() => facts.pg.close());
  await list.ensure([productionLead()]);

  const first = await run(1);
  assert.equal(first.read, 1, "the calendar was read");
  assert.equal(first.published, 1, "the board's agenda page is now a live fact");
  const [fact] = await facts.query(`SELECT f.entity_id, f.field, f.value, f.quote, f.produced_by, f.status, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id`);
  assert.deepEqual({ entity: fact!.entity_id, field: fact!.field, by: fact!.produced_by, status: fact!.status, url: fact!.url },
    { entity: "ocd-division/country:us/state:az/county:pima#governing", field: "agenda_url", by: "parser:legistar-insite", status: "live", url: URL_OF_LEAD });
  assert.ok(String(fact!.quote).includes("Calendar.aspx"), "the fact keeps the exact line of the saved page");
  const bank = (await readFieldManual(deps.repos)).store.entries.filter(entry => entry.kind === "PAGE_READ");
  assert.deepEqual(bank.map(entry => [entry.platforms[0], entry.states[0], entry.outcome, (entry.payload as { published: number }).published]), [["legistar-insite", "az", "YIELDED", 1]], "the win is saved by platform and state");
  assert.equal(first.links, 8, "the board's page and each public sitting's page became leads");

  const waiting = await facts.query(`SELECT url, tier, value->>'platform' AS platform, reports->0->>'foundOn' AS found_on FROM work WHERE kind = 'lead' AND status = 'waiting' ORDER BY url`);
  assert.ok(waiting.length === 8 && waiting.every(row => row.platform === "legistar-insite" && row.found_on === URL_OF_LEAD && row.tier === "coverage"));

  const requestsAfterFirst = requests.length;
  const second = await run();
  assert.equal(second.claimed, 8, "the new links were claimed");
  assert.equal(requests.length, requestsAfterFirst + 8, "each page was fetched once");
  const third = await run();
  assert.equal(third.claimed, 0, "nothing is read twice");
  assert.equal(requests.length, requestsAfterFirst + 8);
  await list.ensure([productionLead(), ...waiting.map(row => productionLead({ url: String(row.url) }))]);
  assert.equal((await run()).claimed, 0, "a link found again is not made again");
  assert.equal(Number((await facts.query(`SELECT count(*) AS n FROM work WHERE kind = 'lead' AND status = 'done'`))[0]!.n), 9);
});

test("links are served by tier, then newest first, from whichever kind of website holds the first", async t => {
  const { facts, list } = await setup();
  t.after(() => facts.pg.close());
  const at = (url: string, found: string, over: Partial<WorkInput> = {}) => productionLead({ url, priority: newestFirst(found), dueAt: found, ...over });
  await list.ensure([
    at("https://a.legistar.com/Calendar.aspx", "2026-10-21T00:00:00Z"),
    at("https://b.legistar.com/Calendar.aspx", "2026-10-29T00:00:00Z"),
    at("https://c.boarddocs.com/x/Board.nsf", "2026-10-28T00:00:00Z", { value: { platform: "boarddocs" } }),
    at("https://d.legistar.com/Calendar.aspx", "2026-10-20T00:00:00Z", { tier: "reader" }),
  ]);
  const waiting = await workWaiting(facts.query);
  assert.deepEqual(waiting.rows.filter(row => row.kind === "lead").map(row => [row.tier, row.waiting]), [["coverage", 3], ["reader", 1]]);
  assert.equal(waiting.oldestLead, "2026-10-20T00:00:00.000Z", "Admin can say how long the oldest link has waited");
  const order: string[] = [];
  for (;;) {
    const platform = await list.firstPlatform(["legistar-insite", "boarddocs"]);
    const [claim] = platform === null ? [] : await list.claim("lead", 1, { platform });
    if (!claim) break;
    order.push(claim.url!.slice(8, 9));
    await list.finish(claim);
  }
  assert.deepEqual(order, ["d", "b", "c", "a"], "a reader's link first, then the newest across both kinds of website");
  assert.equal(await list.firstPlatform(["legistar-insite"]), null);
});

test("a page the parser cannot read, or cannot reach, goes to a detective after its attempts; the parser's change reopens it", async t => {
  const broken: PlatformParser = { platform: "legistar-insite", parse: () => { throw new Error("the grid changed"); } };
  const { facts, list, run, deps } = await setup(PAGES, new Map([[broken.platform, broken]]));
  t.after(() => facts.pg.close());
  await list.ensure([productionLead()]);
  assert.equal((await run()).refused, 1);
  const [row] = await facts.query(`SELECT status, refusal, unlock->>'kind' AS kind, unlock->>'platform' AS platform FROM work WHERE kind = 'lead'`);
  assert.deepEqual({ ...row }, { status: "refused", refusal: "PARSER_THREW:the grid changed", kind: "parser", platform: "legistar-insite" });
  assert.equal(Number((await facts.query(`SELECT count(*) AS n FROM work WHERE kind = 'detect'`))[0]!.n), 1);

  // The lane's parser is fixed: its new code is announced, and the link it could not read goes back on the list and is read.
  for (const ddl of CAPABILITY_DDL) await facts.pg.exec(ddl);
  clock.now = new Date(NOW.getTime() + 60_000);
  await capabilityLog(facts.query).record([{ kind: "parser", name: "legistar-insite", platform: "legistar-insite", because: "a new reader for legistar-insite", version: "v2" }], clock.now.toISOString());
  assert.equal(await reopenDeadEnds(list, capabilityLog(facts.query), 5 * 86_400_000, new Date(clock.now.getTime() + 1_000).toISOString()), 1);
  clock.now = new Date(clock.now.getTime() + 2_000);
  const fixed = await runParserWorkers({ deps: { ...deps, parsers: await loadParsers() }, concurrency: 1, stopRequested: () => false });
  assert.equal(fixed.read, 1);
  clock.now = NOW;

  const unreachable = await setup({});
  t.after(() => unreachable.facts.pg.close());
  await unreachable.list.ensure([productionLead()]);
  for (let attempt = 1; attempt <= LEAD_ATTEMPTS; attempt++) {
    assert.equal((await unreachable.run()).claimed, 1);
    await unreachable.facts.query(`UPDATE work SET due_at = '2026-10-01T00:00:00Z' WHERE kind = 'lead' AND status = 'waiting'`);
  }
  assert.equal((await unreachable.facts.query(`SELECT status FROM work WHERE kind = 'lead'`))[0]!.status, "refused");
});

test("every installed parser is found by its folder, and a link's kind of website is the same to JavaScript and to the database", async t => {
  const parsers = await loadParsers();
  assert.ok(parsers.has("legistar-insite"));
  const { facts } = await setup();
  t.after(() => facts.pg.close());
  const samples = ["https://sitka.legistar.com/Calendar.aspx", "https://webapi.legistar.com/v1/pima/events", "https://x.boarddocs.com/az/y/Board.nsf",
    "https://files.thrillshare.com/documents/a.pdf?x=1", "https://city.gov/AgendaCenter/ViewFile/Agenda/1", "https://city.gov/events.ics", "https://city.gov/about"];
  const inDatabase = PLATFORM_PATTERNS.map(([platform, pattern]) => `WHEN u ~* ${`'${pattern.replaceAll("'", "''")}'`} THEN '${platform}'`).join(" ");
  for (const url of samples) {
    const [row] = await facts.query(`SELECT CASE ${inDatabase} ELSE 'own-site' END AS platform FROM (SELECT $1::text AS u) s`, [url]);
    assert.equal(row!.platform, platformOf(url), url);
  }
  assert.equal(platformOf("https://files.thrillshare.com/documents/a.pdf?x=1"), "pdf", "a file's own type wins over its host");
  assert.equal(platformOf("https://city.gov/about"), "own-site", "a government's own page is read by the own-site parser");
});

test("a person on a page is the one person the matcher finds, in the seat the page gives them, and is not made twice", async t => {
  const roster = (name: string) => `<html><body><h1>Board of Supervisors</h1><p>${name}, Chair</p></body></html>`;
  const people: PlatformParser = { platform: "legistar-insite", parse: (page, lead) => {
    const name = /<p>(.*), Chair<\/p>/.exec(page.raw)![1]!, quote = `${name}, Chair`, who = { name, ids: [["legistar:pima", "77"] as const] };
    return { links: [], facts: [
      { subjectHint: null, person: who, on: "body", field: "member:{person}", fieldKind: "officeholder", value: { name, office: "Chair" }, valueText: name, quote },
      { subjectHint: null, person: who, field: "name", fieldKind: "officeholder", value: name, valueText: name, quote },
      { subjectHint: null, person: who, field: "office:{body}", fieldKind: "officeholder", value: "Chair", valueText: "Chair", quote },
    ] };
  } };
  const pages = { [GOVERNMENT_PAGE]: PAGES[GOVERNMENT_PAGE]!.replace("Calendar.aspx", "a").replace(URL_OF_LEAD, "https://pima.legistar.com/a") + `<a href="https://pima.legistar.com/b">b</a>`,
    "https://pima.legistar.com/a": roster("Jane Roe"), "https://pima.legistar.com/b": roster("Jane Roe") };
  const { facts, list, run } = await setup(pages, new Map([[people.platform, people]]));
  t.after(() => facts.pg.close());
  await list.ensure([productionLead({ url: "https://pima.legistar.com/a" }), productionLead({ url: "https://pima.legistar.com/b" })]);
  assert.equal((await run()).published, 3, "the second page only confirms what the first said");
  const rows = await facts.query(`SELECT e.kind, f.field, f.status FROM fact f JOIN entity e ON e.id = f.entity_id ORDER BY e.kind, f.field`);
  assert.deepEqual(rows.map(row => `${row.kind}:${String(row.field).replace(/:.*/, "")}:${row.status}`), ["body:member:live", "person:name:live", "person:office:live"]);
  assert.equal(Number((await facts.query(`SELECT count(*) AS n FROM entity WHERE id LIKE 'person:az:legistar-pima%'`))[0]!.n), 1, "the same person on two pages is one person");
});
