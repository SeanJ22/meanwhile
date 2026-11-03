import assert from "node:assert/strict";
import test from "node:test";
import { leadOf, leadsOn, moveBoxLeads } from "../lib/core/leads.ts";
import { LEAD_DDL, LEAD_GOVERNMENT_DDL, WORK_DDL, newestFirst, workList, type WorkInput } from "../lib/core/work.ts";
import { handedLinks, settleHandedLinks } from "../lib/hunt/site-walk-handoff.ts";
import { factDb } from "./helpers/fact-db.ts";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const report = (over: Partial<Parameters<typeof leadOf>[0]> = {}) => ({ subjectId: "az:city:city-of-tempe#governing", field: "DOC-02", value: "https://www.tempe.gov/agendas.pdf",
  recordClass: null, exactQuote: "Agendas", sourceUrl: "https://www.tempe.gov/government", recordedAt: "2026-10-22T13:51:46.148Z", ...over });

async function setup() {
  const facts = await factDb();
  for (const ddl of [...WORK_DDL, ...LEAD_DDL, ...LEAD_GOVERNMENT_DDL]) await facts.pg.exec(ddl);
  await facts.pg.exec("CREATE TABLE cp_box_findings(id text PRIMARY KEY, value jsonb)");
  const list = workList(facts.query, { owner: "test", leaseMs: 300_000, now: () => NOW });
  leadsOn(() => list);
  return { facts, list };
}
const boxRow = (id: string, over: Record<string, unknown> = {}) => ({ id, subjectId: "az:city:city-of-tempe#governing", state: "waiting", exactQuote: "Agendas",
  sourceUrl: "https://www.tempe.gov/government", lastRecordedAt: "2026-10-22T13:51:46.148Z", fact: { field: "DOC-02", value: `https://www.tempe.gov/${id}.pdf`, recordClass: null },
  origins: [{ kind: "SCOUT", workItemId: "hunt-1", recordedAt: "2026-10-22T13:51:46.148Z" }], ...over });

test("only a link to read becomes a lead: the page it was found on, its quote and its kind of website are kept", () => {
  const lead = leadOf(report())!;
  assert.deepEqual([lead.kind, lead.url, lead.placeId, lead.value, lead.sources, lead.priority], ["lead", "https://www.tempe.gov/agendas.pdf", "az:city:city-of-tempe", { platform: "pdf" },
    ["https://www.tempe.gov/government"], newestFirst("2026-10-22T13:51:46.148Z")]);
  assert.equal(lead.source.quote, "Agendas");
  assert.equal(leadOf(report({ value: "https://www.tempe.gov/calendar" }))!.value, null, "a page on the government's own site names no vendor");
  assert.equal(leadOf(report({ field: "OFF-09", value: "clerk@tempe.gov" })), null, "a contact is a fact, not a link");
  assert.equal(leadOf(report({ field: "OFF-04", value: "https://www.tempe.gov/mayor" })), null, "only the pages governments link to are read");
});

test("the Box's links move onto the work list a page at a time: nothing is deleted, a page filed again changes nothing, and one address is one row with every place that linked it", async t => {
  const { facts } = await setup();
  t.after(() => facts.pg.close());
  const shared = "https://www.maricopa.gov/shared.pdf";
  const rows = [boxRow("a"), boxRow("b"), boxRow("c", { state: "built" }), boxRow("d", { fact: { field: "OFF-09", value: "clerk@tempe.gov", recordClass: null } }),
    boxRow("e", { subjectId: "az:county:county-of-maricopa#board", fact: { field: "MTG-01", value: shared, recordClass: null } }),
    boxRow("f", { subjectId: "az:county:county-of-pima#governing", fact: { field: "GOV-03", value: shared, recordClass: null }, origins: [{ kind: "SCOUT", workItemId: "hunt-2", recordedAt: "2026-10-23T00:00:00.000Z", source: { sourceUrl: "https://pima.gov/other" } }] })];
  for (const row of rows) await facts.query("INSERT INTO cp_box_findings VALUES ($1, $2::jsonb)", [row.id, JSON.stringify(row)]);

  let after = "", filed = 0, pages = 0;
  for (;;) {
    const page = await moveBoxLeads(facts.query, after, 2);
    pages++; filed += page.filed;
    if (page.next === null) break;
    after = page.next;
  }
  assert.deepEqual([pages, filed], [4, 4], "six rows read two at a time, then an empty page ends it; the built row and the contact were not links");
  const again = await moveBoxLeads(facts.query, "", 100);
  assert.equal(again.filed, 4, "the whole Box read again files the same links");
  const leads = await facts.query("SELECT url, tier, status, reports, sources FROM work WHERE kind = 'lead' ORDER BY url");
  assert.equal(leads.length, 3, "a, b and the shared address are three rows, with no duplicates");
  const sharedRow = leads.find(row => row.url === shared)!;
  assert.deepEqual((sharedRow.reports as { subjectId: string; foundOn: string; quote: string }[]).map(each => [each.subjectId, each.foundOn, each.quote]).sort(),
    [["az:county:county-of-maricopa#board", "https://www.tempe.gov/government", "Agendas"], ["az:county:county-of-pima#governing", "https://www.tempe.gov/government", "Agendas"]],
    "each place that linked it keeps its page and its quote");
  assert.ok((sharedRow.sources as string[]).includes("https://pima.gov/other"), "a second page that said the same is kept");
  assert.ok(leads.every(row => row.tier === "coverage" && row.status === "waiting"));
  assert.equal(Number((await facts.query("SELECT count(*) AS n FROM cp_box_findings"))[0]!.n), 6, "the Box rows stay until the move is proven");
});

test("moved links never push aside clock work, Sean's orders or reader requests", async t => {
  const { facts, list } = await setup();
  t.after(() => facts.pg.close());
  const lead = (url: string, over: Partial<WorkInput> = {}): WorkInput => ({ kind: "lead", url, placeId: "az:city:city-of-tempe", subjectId: "az:city:city-of-tempe#governing", state: "AZ",
    priority: newestFirst("2026-10-22T13:51:46.148Z"), origin: { from: "loader" }, source: { source: "Found by a hunter" }, ...over });
  await list.addMany([...Array.from({ length: 30 }, (_, index) => lead(`https://www.tempe.gov/moved-${index}.pdf`, { priority: 1_000_000 + index })),
    lead("https://www.tempe.gov/reader", { tier: "reader", priority: 1 }), lead("https://www.tempe.gov/order", { tier: "order", priority: 1 }), lead("https://www.tempe.gov/clock", { tier: "clock", priority: 1 })]);
  assert.deepEqual((await list.claim("lead", 3)).map(claim => claim.tier), ["clock", "order", "reader"]);
  assert.equal((await list.claim("lead", 1))[0]!.tier, "coverage", "the moved links come after");
});

test("a walk takes the links under its own government, its boards and no other, rests the links to other sites, and settles each", async t => {
  const { facts, list } = await setup();
  t.after(() => facts.pg.close());
  const lead = (url: string, subjectId: string, over: Partial<WorkInput> = {}): WorkInput => ({ kind: "lead", url, placeId: subjectId.split("#")[0]!, subjectId, state: "AZ",
    priority: 1, origin: { from: "loader" }, source: { source: "Found by a hunter" }, ...over });
  await list.addMany([
    lead("https://www.tempe.gov/a", "az:city:city-of-tempe#governing"), lead("https://www.tempe.gov/b", "az:city:city-of-tempe#body:parks"), lead("https://tempe.gov/c", "az:city:city-of-tempe"),
    lead("https://www.tempe.gov/other-government", "az:city:city-of-tempe-hills#governing"), lead("https://elsewhere.org/x", "az:city:city-of-tempe#governing"),
    lead("https://www.tempe.gov/vendor", "az:city:city-of-tempe#governing", { value: { platform: "pdf" } }),
  ]);
  const handed = await handedLinks({ list, governmentIds: ["az:city:city-of-tempe"], website: "https://www.tempe.gov/", limit: 25, now: () => NOW.getTime() });
  assert.deepEqual(handed.leads.map(each => each.url).sort(), ["https://tempe.gov/c", "https://www.tempe.gov/a", "https://www.tempe.gov/b"]);
  assert.deepEqual(handed.leads.find(each => each.url.endsWith("/b")), { url: "https://www.tempe.gov/b", bodyId: "az:city:city-of-tempe#body:parks" });
  const rows = Object.fromEntries((await facts.query("SELECT url, status, due_at FROM work")).map(row => [row.url, row]));
  assert.equal(rows["https://www.tempe.gov/other-government"]!.status, "waiting", "another government's link was not touched");
  assert.equal(rows["https://www.tempe.gov/vendor"]!.status, "waiting", "a vendor's reader takes a tagged link, not the walk");
  assert.equal(rows["https://elsewhere.org/x"]!.status, "waiting");
  assert.ok(new Date(rows["https://elsewhere.org/x"]!.due_at as string).getTime() > NOW.getTime() + 4 * 86_400_000, "a link to another site rests up to five days");

  const settled = await settleHandedLinks({ list, handed, read: new Set(["https://www.tempe.gov/a"]), failed: new Map([["https://www.tempe.gov/b", "HTTP_500"]]) });
  assert.deepEqual(settled, { read: 1, failed: 1 });
  const after = Object.fromEntries((await facts.query("SELECT url, status, attempts, refusal FROM work")).map(row => [row.url, row]));
  assert.deepEqual([after["https://www.tempe.gov/a"]!.status, after["https://www.tempe.gov/b"]!.status, after["https://www.tempe.gov/b"]!.refusal], ["done", "waiting", "HTTP_500"]);
  assert.deepEqual([after["https://tempe.gov/c"]!.status, Number(after["https://tempe.gov/c"]!.attempts)], ["waiting", 0], "a link the walk did not reach goes back as it was");
});
