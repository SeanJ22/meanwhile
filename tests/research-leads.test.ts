/**
 * Research leads from Admin: pasted or uploaded links become one tracked
 * order, known links are marked held, new ones are tested by plain code, and
 * what works becomes a lesson with the owner as its source that spreads.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyConfirmation, applyGatewayReply, confirmationOf, orderStepsReached, startReceipt } from "../app/(admin)/_mw/admin-v6/receipts.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { readV6History } from "../lib/control-plane/admin-view/admin-v6-history.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import type { ActionRequest } from "../lib/control-plane/gateway/contract.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import type { GatewayDeps } from "../lib/control-plane/gateway/registry.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { canonicalLeadUrl, isLeadOrder, LEADS_MAX_ROWS, OWNER_LEAD_SOURCE, placeFromNotes, type LeadOrder } from "../lib/control-plane/leads/order.ts";
import { LINK_COLUMN, parseLeads } from "../lib/control-plane/leads/parse.ts";
import { guardedLeadGet, insideSentPlace, runLeadsPass } from "../lib/control-plane/leads/plain-test.ts";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { createWebsitePacing, WEBSITE_TAKE_SQL, websiteOf, type WebsitePacing } from "../lib/control-plane/website-pacing.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { ResearchGet } from "../lib/hunt/robots-first-fetch.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { runSpreadPass } from "../lib/method/spread-pass.ts";
import { sheetAsCsv } from "../lib/control-plane/bulk-hunts/workbook.ts";
import { previewLeads } from "../lib/control-plane/leads/preview.ts";

const NOW = "2026-10-07T16:00:00.000Z";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MESA = "ocd-division/country:us/state:az/place:mesa";

const deps = (repos: ReturnType<typeof createMemoryRepositories>): GatewayDeps => ({ repos, now: () => NOW, currentStateVersion: null, codeSha: null });
const ask = (key: string, rows: unknown): ActionRequest => ({ type: "leads.upload", subject: "leads", input: { rows }, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "adm_test" });
const door = (doorId: string, ocdId: string, host: string, config: Record<string, string> = {}): DoorRecord =>
  ({ doorId, kind: "legistar", ocdId, hosts: [host], status: "OPEN", bodyIds: [], holds: ["meetings"], config, meeting: null }) as unknown as DoorRecord;

const ROBOTS = "User-agent: *\nAllow: /\n";
type Page = { status: number; body?: string; type?: string; retryAfter?: string };
function siteGet(pages: Readonly<Record<string, Page>>, asked: string[] = []): ResearchGet {
  return async ({ url }) => {
    asked.push(url);
    if (url.endsWith("/robots.txt")) return { status: 200, body: new TextEncoder().encode(ROBOTS), contentType: "text/plain", location: null, transportError: null };
    const page = pages[url];
    if (!page) return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: "getaddrinfo ENOTFOUND" };
    return { status: page.status, body: new TextEncoder().encode(page.body ?? ""), contentType: page.type ?? "text/html", location: null, transportError: null, retryAfter: page.retryAfter ?? null };
  };
}
const passClock = () => {
  let t = Date.parse(NOW);
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};
const orderOf = async (repos: ReturnType<typeof createMemoryRepositories>, id: string): Promise<LeadOrder> => {
  const row = await repos.leadOrders.read(id);
  assert.ok(row && isLeadOrder(row.value));
  return row.value;
};

test("a pasted list takes the first web address on each line as the link and the rest as its note", () => {
  const r = parseLeads("https://www.tucsonaz.gov/clerk  City clerk page\nwww.flagstaff.az.gov/agendas, agendas\nno link here\nhttps://www.tucsonaz.gov/clerk#top\nhtp://broken");
  assert.deepEqual(r.leads.map((l) => l.link), ["https://www.tucsonaz.gov/clerk", "www.flagstaff.az.gov/agendas", "htp://broken"]);
  assert.deepEqual(r.leads[0]!.notes, { Note: "City clerk page" });
  assert.equal(r.duplicates, 1, "the same page with a fragment is the same link");
  assert.equal(r.skipped[0]!.why, "no link in the row");
  assert.equal(canonicalLeadUrl("www.flagstaff.az.gov/agendas"), "https://www.flagstaff.az.gov/agendas");
  assert.equal(canonicalLeadUrl("htp://broken"), null);
});

test("a table is read by its link column and every other column is kept as notes", () => {
  const r = parseLeads('name,url,state,why\n"Tucson, clerk",https://tucson.legistar.com/Calendar.aspx,AZ,council\nEmpty,,AZ,\n');
  assert.deepEqual(r.columns, { link: "url", notes: ["name", "state", "why"] });
  assert.deepEqual(r.leads[0]!.notes, { name: "Tucson, clerk", state: "AZ", why: "council" });
  assert.equal(r.skipped[0]!.count, 1);
  assert.deepEqual(placeFromNotes({ state: "Arizona" }), { place: null, state: "az" });
  assert.deepEqual(placeFromNotes({ where: `${TUCSON} (city)` }), { place: TUCSON, state: "az" });
});

test("the bulk upload previews leads from a paste and from Excel, takes 5,000 rows and refuses 5,001 with the reason", async () => {
  const pasted = previewLeads("https://a.example.gov/x note one\nhttps://b.example.gov/y");
  assert.ok(pasted.ok);
  assert.equal(pasted.leads.length, 2);
  const many = Array.from({ length: LEADS_MAX_ROWS }, (_, i) => `https://site${i}.example.gov/page`).join("\n");
  const full = previewLeads(many);
  assert.ok(full.ok);
  assert.equal(full.leads.length, 5000);
  const over = previewLeads(`${many}\nhttps://one-more.example.gov/`);
  assert.equal(over.ok, false);
  assert.equal(over.ok ? "" : over.says, "That is 5,001 links; one upload takes at most 5,000. Split it.");
  assert.equal(previewLeads("nothing here").ok, false);
  const { buildWorkbook } = await import("../scripts/xlsx.mjs");
  const book = buildWorkbook([{ name: "Zips", header: ["zip"], rows: [["85635"]], widths: [10] }, { name: "Leads", header: ["Website", "Body"], rows: [["https://c.example.gov/agendas", "Council"]], widths: [30, 10] }], "2026-10-07") as Buffer;
  const sheet = sheetAsCsv(book.toString("base64"), LINK_COLUMN);
  assert.ok(sheet.ok);
  const excel = previewLeads(sheet.csv);
  assert.ok(excel.ok);
  assert.deepEqual(excel.leads, [{ n: 1, link: "https://c.example.gov/agendas", notes: { Body: "Council" } }]);
  const noLinks = buildWorkbook([{ name: "Zips", header: ["zip"], rows: [["85635"]], widths: [10] }], "2026-10-07") as Buffer;
  const refused = sheetAsCsv(noLinks.toString("base64"), LINK_COLUMN);
  assert.match(refused.ok ? "" : refused.says, /column named link/);
});

test("the gateway takes 5,000 rows and refuses 5,001 at once, saying why", async () => {
  const repos = createMemoryRepositories();
  const rows = Array.from({ length: LEADS_MAX_ROWS }, (_, i) => ({ link: `https://site${i}.example.gov/`, notes: {} }));
  const ok = await submit(ask("leads-key-5000", rows), deps(repos));
  assert.equal(ok.ok, true, ok.receipt.says);
  assert.equal((await orderOf(repos, ok.receipt.receiptId)).rows.length, 5000);
  const over = await submit(ask("leads-key-5001", [...rows, { link: "https://x.example.gov/", notes: {} }]), deps(repos));
  assert.equal(over.ok, false);
  assert.match(over.receipt.says, /that is 5,001 links; one upload takes at most 5,000\. Split it/);
});

test("five rows flow end to end: parsed, ordered, held or tested, each with its reason, learned with the owner as source, and spread", async () => {
  const repos = createMemoryRepositories();
  // Already held: a saved capture, and a page a door reads.
  await repos.artifacts.append("artifacts", "a1", { artifactId: "a1", canonicalUrl: "https://www.tucsonaz.gov/clerk", recordedAt: NOW } as unknown as ArtifactRecord, NOW);
  await repos.doors.put("d-tucson", door("d-tucson", TUCSON, "tucson.legistar.com", { pageUrl: "https://tucson.legistar.com/Calendar.aspx" }), NOW);
  await repos.doors.put("d-pima", door("d-pima", PIMA, "pima.legistar.com"), NOW);

  const pasted = [
    "https://www.tucsonaz.gov/clerk  City clerk",
    "https://tucson.legistar.com/Calendar.aspx",
    "https://tucson.legistar.com/Departments.aspx  Tucson boards",
    "https://www.flagstaff.az.gov/agendas",
    "https://www.flagstaff.az.gov/missing-page",
  ].join("\n");
  const parsed = parseLeads(pasted);
  assert.equal(parsed.leads.length, 5);
  const rows = parsed.leads.map((l) => ({ link: l.link, notes: l.link.includes("flagstaff") ? { ...l.notes, State: "AZ" } : l.notes }));

  // The send Admin makes, through its own contract.
  const def = actionDef("leads-send");
  assert.equal(def.gateway?.type, "leads.upload");
  const input = actionInput("leads-send", { target: "leads", scopeKey: "us", option: null, words: "", amount: "", selected: [], payload: { rows: JSON.stringify(rows) } });
  const out = await submit(ask("leads-key-e2e", input.rows), deps(repos));
  assert.equal(out.ok, true, out.receipt.says);
  assert.equal(out.receipt.outcome, "QUEUED");
  assert.match(out.receipt.says, /^Received 5 links: 2 already held, 3 still to test\./);

  const order = await orderOf(repos, out.receipt.receiptId);
  assert.deepEqual(order.rows.map((r) => r.state), ["HELD", "HELD", "QUEUED", "QUEUED", "QUEUED"]);
  assert.match(order.rows[0]!.why, /saved copy of this page/);
  assert.match(order.rows[1]!.why, /we read this page on a schedule/);
  assert.equal(order.rows[2]!.place, TUCSON, "a link on a door's website takes that door's place");
  assert.equal(order.rows[3]!.stateAbbr, "az");

  // Received, accepted, scheduled: the order card shows each row before anything is tested.
  const waiting = await confirmReceipt(repos, out.receipt, Date.parse(NOW));
  assert.equal(waiting.state, "waiting");
  assert.deepEqual(waiting.progress, { done: 2, of: 5 });
  const sent = startReceipt({ key: "leads-key-e2e", def, target: "leads", targetName: "5 links", label: def.label, scopeKey: "us", scopeName: "United States", level: "global", at: NOW, simulated: false });
  const queued = applyGatewayReply(sent, def, 200, { ok: true, receipt: out.receipt, replayed: false, confirmation: waiting }, NOW);
  assert.equal(queued.status, "queued");
  assert.equal(queued.items.length, 5);
  assert.equal(orderStepsReached(queued), 2, "accepted: the runner's plan is on the card");

  const asked: string[] = [];
  const clock = passClock();
  const result = await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0,
    get: siteGet({
      "https://tucson.legistar.com/Departments.aspx": { status: 200, body: "<html><title>Departments</title></html>" },
      "https://www.flagstaff.az.gov/agendas": { status: 200, body: "<html>Agendas</html>" },
      "https://www.flagstaff.az.gov/missing-page": { status: 404, body: "Not found" },
    }, asked) });
  assert.deepEqual({ tested: result.tested, works: result.works, failed: result.failed, lessons: result.lessons }, { tested: 3, works: 2, failed: 1, lessons: 2 });
  assert.ok(asked.includes("https://tucson.legistar.com/robots.txt"), "robots.txt is read first and recorded, never a block");
  assert.ok(!asked.some((u) => u.includes("tucsonaz.gov") || u.endsWith("Calendar.aspx")), "held links are never fetched");

  const done = await orderOf(repos, out.receipt.receiptId);
  assert.equal(done.open, false);
  const byLink = new Map(done.rows.map((r) => [r.link, r]));
  const legistar = byLink.get("https://tucson.legistar.com/Departments.aspx")!;
  assert.equal(legistar.state, "WORKS");
  assert.match(legistar.why, /Works: plain code read it\. Saved as a lesson with you as the source\. It spreads to other places on Legistar/);
  assert.equal(legistar.found!.robots!.verdict, "ALLOWED");
  assert.equal(byLink.get("https://www.flagstaff.az.gov/missing-page")!.why, "The page wasn't found (404).");

  // Done: every row with its status and reason, in Admin's existing order tracking.
  const finished = await confirmReceipt(repos, out.receipt, Date.parse(NOW));
  assert.equal(finished.state, "applied");
  assert.equal(finished.words, "Done: 5 links: 2 already held, 2 work, 1 failed.");
  const shown = applyConfirmation(queued, confirmationOf({ confirmation: finished })!, NOW);
  assert.equal(shown.status, "done");
  assert.equal(orderStepsReached(shown), 5);
  assert.deepEqual(shown.items.map((i) => `${i.label}: ${i.name}`), [
    "Failed: https://www.flagstaff.az.gov/missing-page",
    "Works: https://tucson.legistar.com/Departments.aspx",
    "Works: https://www.flagstaff.az.gov/agendas",
    "Already held: https://www.tucsonaz.gov/clerk",
    "Already held: https://tucson.legistar.com/Calendar.aspx",
  ]);
  const history = await readV6History(repos, { scope: "us", asOf: NOW });
  const card = history.data.find((r) => r.gatewayType === "leads.upload")!;
  assert.equal(card.kind, "leads-send");
  assert.equal(card.status, "done");
  assert.equal(card.items.find((i) => i.status === "failed")!.note, "The page wasn't found (404).");

  // Lessons with the owner as source, tied to place and platform; the platform lesson spreads.
  const lesson = (await repos.fieldManual.readMany([legistar.lessonId!]))[0]!.value;
  assert.equal(lesson.source, OWNER_LEAD_SOURCE);
  assert.equal(lesson.kind, "ROUTE");
  assert.deepEqual(lesson.platforms, ["legistar"]);
  assert.deepEqual(lesson.ocdIds, [TUCSON]);
  assert.match(lesson.summary, /^The owner's lead: plain code read it \(HTTP 200, text\/html\)\. Notes: Note: Tucson boards/);
  assert.equal((await repos.fixMap.forPlace(TUCSON)).find((r) => r.methodId === lesson.id)!.state, "WORKS");
  const flagstaff = (await repos.fieldManual.readMany([byLink.get("https://www.flagstaff.az.gov/agendas")!.lessonId!]))[0]!.value;
  assert.deepEqual(flagstaff.states, ["az"]);
  const page = await readFieldManual(repos, { role: "SCOUT", state: "az" });
  assert.ok(page.projection.lines.some((l) => l.includes("flagstaff.az.gov/agendas")), "a worker in the state is shown the lesson");

  // Release 17's auto-try replays the lead's page at the other Legistar door, by plain code.
  assert.equal((lesson.payload as { procedure?: string }).procedure, "GET https://{host}/Departments.aspx");
  const tries: string[] = [];
  const probe: ProbeFetch = async (url) => {
    tries.push(url);
    const ok = url === "https://pima.legistar.com/Departments.aspx" || url.endsWith("/robots.txt");
    return { status: ok ? 200 : 404, headers: { get: () => null }, bytes: async () => new TextEncoder().encode(url.endsWith("/robots.txt") ? ROBOTS : "<html>Departments</html>") };
  };
  const spread = await runSpreadPass({ repos, now: NOW, sendPlaceIds: new Set(), paidTriesLeft: 0, fetch: probe });
  assert.equal(spread.methods, 1);
  assert.equal(spread.tried.works, 1);
  assert.ok(tries.includes("https://pima.legistar.com/Departments.aspx"));
  assert.equal((await repos.fixMap.forPlace(PIMA)).find((r) => r.methodId === lesson.id)!.state, "WORKS", "it now works at Pima County too");

  // A second upload of a link that became a lesson is already held.
  const again = await submit(ask("leads-key-again", [{ link: "https://tucson.legistar.com/Departments.aspx", notes: {} }]), deps(repos));
  assert.equal(again.receipt.outcome, "DONE");
  assert.match((await orderOf(repos, again.receipt.receiptId)).rows[0]!.why, /you sent this link before/);
});

test("a link plain code is turned away from goes to paid work only inside a place with the owner's money", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("leads-key-paid", [
    { link: "https://portal.example.gov/a", notes: { where: TUCSON } },
    { link: "https://portal.example.gov/b", notes: { where: MESA } },
    { link: "https://portal.example.gov/c", notes: {} },
    { link: "not a link at all", notes: {} },
  ]), deps(repos));
  assert.equal(out.ok, true, out.receipt.says);
  const result = await runLeadsPass({ repos, ...passClock(), sendPlaceIds: new Set([TUCSON]), spacingMs: 0,
    get: siteGet({ "https://portal.example.gov/a": { status: 403 }, "https://portal.example.gov/b": { status: 403 }, "https://portal.example.gov/c": { status: 403 } }) });
  assert.equal(result.paid, 1);
  const rows = (await orderOf(repos, out.receipt.receiptId)).rows;
  assert.equal(rows[0]!.state, "PAID");
  assert.match(rows[0]!.why, /Its place has your money, so paid workers there are given it to try\./);
  const lead = (await repos.fieldManual.readMany([rows[0]!.lessonId!]))[0]!.value;
  assert.equal(lead.kind, "LEAD");
  assert.deepEqual(lead.ocdIds, [TUCSON]);
  assert.equal(rows[1]!.state, "FAILED");
  assert.match(rows[1]!.why, /Paid work runs only inside places you've sent money to, and this link's place isn't one of them\./);
  assert.match(rows[2]!.why, /no place is known for this link/);
  assert.equal(rows[3]!.why, "This isn't a web address we can open.");
  assert.ok(insideSentPlace(`${TUCSON}/council_district:1`, new Set([TUCSON])));
  assert.ok(!insideSentPlace("ocd-division/country:us/state:az", new Set([TUCSON])));
});

/** A round's guarded fetch, as the runner builds it: the controller paces every reader through the shared store. */
function roundSafety(pacing: WebsitePacing, clock: () => number, small: (host: string) => boolean): FleetSafetyController {
  return new FleetSafetyController({ now: new Date(clock()).toISOString(), costs: [], clock, websitePacing: pacing,
    websiteSize: (url) => (small(new URL(url).hostname) ? { kind: "local-government", population: 4_000 } : { kind: "federal" }) });
}
/** A website answering from a table of pages, robots.txt allowing everything, and counting what it was asked. */
function site(pages: Readonly<Record<string, Page>>, asked: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (url.endsWith("/robots.txt")) return new Response(ROBOTS, { status: 200, headers: { "content-type": "text/plain" } });
    const page = pages[url];
    if (!page) return new Response("not found", { status: 404 });
    return new Response(page.body ?? "", { status: page.status, headers: { "content-type": page.type ?? "text/html", ...(page.retryAfter ? { "retry-after": page.retryAfter } : {}) } });
  }) as typeof fetch;
}

test("pacing: lead tests and every other reader share one hourly count per small website, across processes and rounds", async () => {
  const repos = createMemoryRepositories();
  const clock = passClock();
  const small = (host: string) => host.replace(/^www\./, "") === "smalltown.example.gov";
  const links = Array.from({ length: 8 }, (_, i) => ({ link: `https://smalltown.example.gov/p${i}`, notes: {} }));
  const out = await submit(ask("leads-key-pace", links), deps(repos));
  const asked: string[] = [];
  const fetchSite = site(Object.fromEntries(links.map((l) => [l.link, { status: 200, body: "ok" }])), asked);

  // Another process (a lease worker acquiring for a hunt) reads the same website six times first.
  const worker = roundSafety(repos.websitePacing, clock.now, small);
  const acquire = worker.guardedOpenOne("public-web", "hunt-acquisition", fetchSite);
  for (let i = 0; i < 6; i += 1) assert.equal((await acquire({ url: "https://www.smalltown.example.gov/agendas", method: "GET", headers: {}, timeoutMs: 1000 })).status, 404);

  const round = roundSafety(repos.websitePacing, clock.now, small);
  const result = await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0, get: guardedLeadGet(round, fetchSite) });
  assert.equal(asked.filter((u) => u.includes("smalltown")).length, 10, "six for the hunt, robots.txt and three pages for the leads: ten in the hour, never eleven");
  let rows = (await orderOf(repos, out.receipt.receiptId)).rows;
  assert.equal(rows.filter((r) => r.state === "WORKS").length, 3);
  const waiting = rows.filter((r) => r.state === "QUEUED");
  assert.equal(waiting.length, 5);
  assert.equal(waiting[0]!.why, "A small local website is read at most 10 times an hour; this link is next in line.");
  assert.equal(waiting[0]!.tries, 0, "waiting for the allowance is not a failed try");
  assert.equal(Date.parse(waiting[0]!.notBefore!), Date.parse(NOW) + 3_600_000, "next in line when the oldest request of the hour ages out");
  assert.equal(result.waiting, 5);
  assert.match(await acquire({ url: "https://smalltown.example.gov/x", method: "GET", headers: {}, timeoutMs: 1000 }).then((r) => r.transportError ?? ""), /^WEBSITE_REQUEST_CAP: /,
    "the leads' requests count against the hunt too");

  // The next round, a new controller over the same store: still nothing until the hour turns.
  const nextRound = roundSafety(repos.websitePacing, clock.now, small);
  const again = await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0, get: guardedLeadGet(nextRound, fetchSite) });
  assert.equal(again.tested, 0, "rows wait for their time");
  await clock.sleep(3_600_000);
  const hourLater = roundSafety(repos.websitePacing, clock.now, small);
  await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0, get: guardedLeadGet(hourLater, fetchSite) });
  rows = (await orderOf(repos, out.receipt.receiptId)).rows;
  assert.equal(rows.filter((r) => r.state === "WORKS").length, 8, "the next hour's allowance reads the rest");

  // A website that is not small is read at full speed.
  const busy = await submit(ask("leads-key-big", Array.from({ length: 15 }, (_, i) => ({ link: `https://big.example.gov/p${i}`, notes: {} }))), deps(repos));
  await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0,
    get: guardedLeadGet(hourLater, site(Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`https://big.example.gov/p${i}`, { status: 200, body: "ok" }])), [])) });
  assert.equal((await orderOf(repos, busy.receipt.receiptId)).rows.filter((r) => r.state === "WORKS").length, 15);
});

test("pacing: a 429 with Retry-After from a lead holds that website for every reader, and another reader's 503 holds the leads", async () => {
  const repos = createMemoryRepositories();
  const clock = passClock();
  const out = await submit(ask("leads-key-wait", [
    { link: "https://busy.example.gov/a", notes: {} }, { link: "https://busy.example.gov/b", notes: {} }, { link: "https://other.example.gov/c", notes: {} },
  ]), deps(repos));
  const asked: string[] = [];
  const pages: Record<string, Page> = { "https://busy.example.gov/a": { status: 429, retryAfter: "1800" }, "https://busy.example.gov/b": { status: 200, body: "ok" },
    "https://other.example.gov/c": { status: 200, body: "ok" } };
  const round = roundSafety(repos.websitePacing, clock.now, () => false);
  await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0, get: guardedLeadGet(round, site(pages, asked)), concurrency: 1 });
  const rows = (await orderOf(repos, out.receipt.receiptId)).rows;
  assert.deepEqual(rows.map((r) => r.state), ["QUEUED", "QUEUED", "WORKS"]);
  assert.match(rows[0]!.why, /^The website asked us to wait; trying again after/);
  assert.equal(rows[0]!.tries, 0, "a request to wait is not a failed try");
  assert.ok(!asked.includes("https://busy.example.gov/b"), "the rest of that website is not asked");
  assert.equal(Date.parse(rows[1]!.notBefore!), Date.parse(NOW) + 1_800_000, "held to the time the website gave");

  // Another process, reading through the shared store, is held too.
  const worker = roundSafety(repos.websitePacing, clock.now, () => false);
  const held = await worker.guardedOpenOne("public-web", "hunt-acquisition", site(pages, asked))({ url: "https://busy.example.gov/agendas", method: "GET", headers: {}, timeoutMs: 1000 });
  assert.match(held.transportError ?? "", /^WEBSITE_ASKED_TO_WAIT: busy\.example\.gov asked to be left alone until /);
  assert.equal(held.requestCount, 0);

  // And a 503 another reader got holds the leads for that website.
  const later = await submit(ask("leads-key-held", [{ link: "https://flaky.example.gov/a", notes: {} }]), deps(repos));
  await worker.guardedOpenBytes("public-web", "hunt-acquisition", (async () => new Response("down", { status: 503 })) as typeof fetch)({ url: "https://flaky.example.gov/", headers: {}, timeoutMs: 1000 });
  const fresh = roundSafety(repos.websitePacing, clock.now, () => false);
  await runLeadsPass({ repos, ...clock, sendPlaceIds: new Set(), spacingMs: 0, get: guardedLeadGet(fresh, site({ "https://flaky.example.gov/a": { status: 200, body: "ok" } }, asked)) });
  const flaky = (await orderOf(repos, later.receipt.receiptId)).rows[0]!;
  assert.equal(flaky.state, "QUEUED");
  assert.match(flaky.why, /^The website asked us to wait; trying again after/);
  assert.ok(!asked.includes("https://flaky.example.gov/a"));

  const working = await confirmReceipt(repos, out.receipt, Date.parse(NOW));
  assert.equal(working.state, "working");
  const card = applyConfirmation(startReceipt({ key: "k", def: actionDef("leads-send"), target: "leads", targetName: "3 links", label: "Send research leads", scopeKey: "us", scopeName: "United States", level: "global", at: NOW, simulated: false }), working, NOW);
  assert.equal(card.status, "running");
  assert.equal(orderStepsReached(card), 4, "in progress");
  assert.equal(card.items.filter((i) => i.label === "Waiting").length, 2);
});

test("the shared pacing store takes a request under one row lock and says when the next is allowed", async () => {
  assert.match(WEBSITE_TAKE_SQL, /ON CONFLICT \(site\) DO UPDATE SET[\s\S]*WHERE cardinality\(ARRAY\(SELECT t FROM unnest\(p\.requests\) t WHERE t > \$2::timestamptz\)\) < \$4\s+RETURNING site/);
  const calls: { text: string; params: readonly unknown[] }[] = [];
  let full = false;
  const pacing = createWebsitePacing(async (text, params) => {
    calls.push({ text, params });
    if (text === WEBSITE_TAKE_SQL) return full ? [] : [{ site: params[0] }];
    if (text.startsWith("SELECT min(t)")) return [{ oldest: new Date("2026-10-07T15:20:00.000Z") }];
    if (text.startsWith("SELECT site, hold_until")) return [{ site: "busy.example.gov", hold_until: "2026-10-07T16:30:00.000Z" }];
    return [];
  });
  assert.deepEqual(await pacing.take("tiny.example.gov", 10, Date.parse(NOW)), { ok: true });
  assert.deepEqual(calls[0]!.params, ["tiny.example.gov", "2026-10-07T15:00:00.000Z", NOW, 10]);
  full = true;
  assert.deepEqual(await pacing.take("tiny.example.gov", 10, Date.parse(NOW)), { ok: false, until: Date.parse("2026-10-07T16:20:00.000Z") });
  await pacing.hold("busy.example.gov", Date.parse("2026-10-07T16:30:00.000Z"), Date.parse(NOW));
  assert.match(calls.at(-1)!.text, /hold_until = GREATEST\(COALESCE\(p\.hold_until, \$2::timestamptz\), \$2::timestamptz\)/);
  assert.deepEqual([...await pacing.heldUntil(Date.parse(NOW))], [["busy.example.gov", Date.parse("2026-10-07T16:30:00.000Z")]]);
  assert.equal(websiteOf("https://WWW.SmallTown.example.gov/x"), "smalltown.example.gov", "one website however it is addressed");
});

test("a lead whose robots.txt disallows us is still read; the verdict is recorded on the row and the lesson", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("leads-key-robots", [{ link: "https://strict.example.gov/agendas", notes: {} }]), deps(repos));
  const get: ResearchGet = async ({ url }) => url.endsWith("/robots.txt")
    ? { status: 200, body: new TextEncoder().encode("User-agent: *\nDisallow: /\n"), contentType: "text/plain", location: null, transportError: null }
    : { status: 200, body: new TextEncoder().encode("<html>Agendas</html>"), contentType: "text/html", location: null, transportError: null };
  await runLeadsPass({ repos, ...passClock(), sendPlaceIds: new Set(), spacingMs: 0, get });
  const row = (await orderOf(repos, out.receipt.receiptId)).rows[0]!;
  assert.equal(row.state, "WORKS");
  assert.equal(row.found!.robots!.verdict, "DISALLOWED");
  assert.match(row.why, /robots\.txt asks automated readers to stay out; that is recorded, and it was read anyway/);
  const lesson = (await repos.fieldManual.readMany([row.lessonId!]))[0]!.value;
  assert.equal((lesson.payload as { lead: { robots: { verdict: string } } }).lead.robots.verdict, "DISALLOWED");
});

test("version 28 declares one row per leads order beside the paced websites, and captures are looked up by the source index's own expression", async () => {
  const { BOOTSTRAP_VERSION, DECLARED_TABLES } = await import("../lib/control-plane/repository/pg-schema.ts");
  const { CAPTURED_URLS_SQL } = await import("../lib/control-plane/repository/pg-store.ts");
  assert.ok(BOOTSTRAP_VERSION >= 28);
  assert.ok(DECLARED_TABLES.includes("cp_lead_orders"));
  assert.ok(DECLARED_TABLES.includes("cp_website_pacing"));
  const { BOOTSTRAP_DDL } = await import("../lib/control-plane/repository/pg-schema.ts");
  const { WEBSITE_PACING_DDL } = await import("../lib/control-plane/website-pacing.ts");
  for (const ddl of WEBSITE_PACING_DDL) {
    assert.ok(BOOTSTRAP_DDL.includes(ddl));
    assert.equal(ddl.trim().split(";").filter((part) => part.trim() !== "").length, 1, "the HTTP driver prepares one statement per query");
  }
  assert.match(CAPTURED_URLS_SQL, /md5\(record->>'canonicalUrl'\) = ANY\(\$1::text\[\]\) AND record->>'canonicalUrl' = ANY\(\$2::text\[\]\)/);
  const repos = createMemoryRepositories();
  await repos.artifacts.append("artifacts", "a1", { artifactId: "a1", canonicalUrl: "https://a.example.gov/", recordedAt: NOW } as unknown as ArtifactRecord, NOW);
  assert.deepEqual([...await repos.capturedCanonicalUrls!(["https://a.example.gov/", "https://b.example.gov/"])], ["https://a.example.gov/"]);
});
