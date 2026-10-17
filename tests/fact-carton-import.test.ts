import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { cartonComments, cartonOffices, cartonRosters, importCartonComments, importCartonOffices, importCartonRosters } from "../lib/facts/carton-import.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readFactCommentAccess } from "../lib/facts/comment-read.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import type { BodyRoster } from "../lib/registry/body-rosters.ts";
import type { CommentAccess } from "../lib/registry/comment-access-client.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import type { Body } from "../lib/registry/types.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-09-08T12:00:00.000Z";
const SAVED_AT = "2026-09-01T15:00:00.000Z";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TCCC = `${TUCSON}#tucson-convention-center-commission`;
const AGENDA = `${TUCSON}#agenda-committee`;
const ADJUSTMENT = `${TUCSON}#board-of-adjustment`;
const TCCC_URL = "https://clerksboards.tucsonaz.gov/boards/15";
const AGENDA_URL = "https://clerksboards.tucsonaz.gov/boards/?board=136";
const ADJUSTMENT_URL = "https://clerksboards.tucsonaz.gov/boards/?board=8";
const ROSTER_SCOPE = "US-AZ:reader-registry-runtime";
const COMMENT_SCOPE = "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies";
const clocks = factClocks(null);

const page = (title: string, body: string) => `<html><head><title>${title} | City of Tucson, Arizona</title></head><body><h1>${title}</h1>${body}</body></html>`;

/** A fact store with Arizona's entities, the promoted partitions the carton readers look in, and a vault and fetch that only know the given pages. */
async function setup(pages: { readonly held?: Readonly<Record<string, string>>; readonly live?: Readonly<Record<string, string>> }) {
  const facts = await factDb();
  await ensureFactEntities(facts, ROOT, ["az"]);
  await facts.query(`CREATE TABLE civic_data_candidates (id text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL,
    promoted_version_id text, retrieved_at timestamptz NOT NULL)`);
  await facts.query("CREATE TABLE civic_data_promotions (key text PRIMARY KEY,current_version_id text NOT NULL)");
  const repos = createMemoryRepositories();
  const vault = new MemoryEvidenceStore();
  for (const [url, html] of Object.entries(pages.held ?? {})) {
    const { artifact } = recordAcquisition({ canonicalUrl: url, retrievedAt: SAVED_AT, httpStatus: 200, contentType: "text/html", sourceId: new URL(url).hostname,
      methodRouteId: "scout:fetch_public", workItemId: "wi-earlier-hunt", attemptId: "at-earlier-hunt", permission: "ALLOWED", transport: "REACHABLE" }, html);
    await putArtifact(vault, "freshness", artifact, Buffer.from(html));
    await repos.artifacts.append("wi-earlier-hunt", artifact.id, { artifactId: artifact.id, workItemId: "wi-earlier-hunt", routeTaskId: null, attemptId: artifact.attemptId,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: url, partial: false, recordedAt: SAVED_AT }, SAVED_AT);
  }
  const fetched: string[] = [];
  const fetch: ProbeFetch = async url => {
    fetched.push(url);
    if (url.includes("unreachable")) throw new Error("connect ECONNREFUSED");
    const html = pages.live?.[url];
    return { status: html === undefined ? 404 : 200, headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null },
      bytes: async () => new TextEncoder().encode(html ?? "Not Found") };
  };
  const promote = async (id: string, recordClass: string, scope: string) => {
    await facts.query("INSERT INTO civic_data_candidates (id, record_class, scope, promoted_version_id, retrieved_at) VALUES ($1, $2, $3, $1, $4)", [id, recordClass, scope, SAVED_AT]);
    return facts.query("INSERT INTO civic_data_promotions VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id", [`${recordClass}:${scope}`, id]);
  };
  return { facts, repos, vault, fetch, fetched, promote, common: { facts, clocks, repos, vault, fetch, now: NOW } };
}

const member = (bodyId: string, n: number, name: string, officeTitle: string) => ({ id: `roster:${bodyId}#${n}`, name, officeTitle, termNote: null, email: null, phone: null, websiteUrl: null });
const roster = (bodyId: string, bodyName: string, sourceUrl: string, members: BodyRoster["members"]): BodyRoster =>
  ({ bodyId, bodyName, members, sourceUrl, sourceOrg: "City of Tucson Clerk", collectedAt: "2026-08-14", partisanship: "NONPARTISAN" });
const ROSTERS: readonly BodyRoster[] = [
  roster(TCCC, "Tucson Convention Center Commission", TCCC_URL, [member(TCCC, 1, "Ned Beman", "Chairperson"), member(TCCC, 2, "Jose Jimenez", "Vice Chairperson"),
    member(TCCC, 3, "Alysha Ramirez Hall", "Member"), member(TCCC, 4, "Ronnie Reyna", "Member")]),
  roster(AGENDA, "Agenda Committee", AGENDA_URL, [member(AGENDA, 1, "Dana Example", "Chair"), member(AGENDA, 2, "Rosa Sample", "Member")]),
  roster(ADJUSTMENT, "Board of Adjustment (BAJ)", ADJUSTMENT_URL, [member(ADJUSTMENT, 1, "Lee Placeholder", "Chair")]),
];

test("the rosters readers saw go live as facts on a held or freshly saved copy of their page; an unreadable page leaves SOURCE_BLOCKED blanks, once", async () => {
  const agendaPage = page("Agenda Committee", "<table><tr><th>Name</th><th>Title</th></tr><tr><td>Dana Example</td><td>Chair</td></tr><tr><td>Rosa Sample</td><td>Member</td></tr></table>");
  const s = await setup({ held: { [TCCC_URL]: readFileSync(join(ROOT, "tests", "fixtures", "clerksboards", "b15.html"), "utf8") }, live: { [AGENDA_URL]: agendaPage } });
  await s.promote("rv-rosters", "REGISTRY_RUNTIME_BINDING", ROSTER_SCOPE);
  const readCandidate = async (id: string) => (id === "rv-rosters" ? { candidate: { readModel: { bodyRosters: ROSTERS } } } : null);
  const carton = await cartonRosters(s.facts.query, readCandidate, ROSTER_SCOPE);
  assert.equal(carton?.versionId, "rv-rosters");
  const report = await importCartonRosters({ ...carton!, ...s.common });
  assert.deepEqual(report, { rosters: 3, live: 18, confirmed: 0, blanks: 0, unreadable: [{ url: ADJUSTMENT_URL, reason: "HTTP_404" }] });
  assert.deepEqual(s.fetched.sort(), [ADJUSTMENT_URL, AGENDA_URL].sort(), "a page another job already saved is not fetched again");

  const { rosters } = await readFactRosters(s.facts.query, [TCCC, AGENDA, ADJUSTMENT]);
  assert.deepEqual(rosters.map(row => row.bodyId).sort(), [AGENDA, TCCC]);
  const tccc = rosters.find(row => row.bodyId === TCCC)!;
  assert.deepEqual(tccc.members.map(m => [m.name, m.officeTitle]).sort(), [["Alysha Ramirez Hall", "Member"], ["Jose Jimenez", "Vice Chairperson"], ["Ned Beman", "Chairperson"], ["Ronnie Reyna", "Member"]]);
  assert.ok(tccc.members.every(m => m.fieldSources?.name?.sourceUrl === TCCC_URL), "each seat cites the saved page");
  assert.deepEqual(tccc.members.map(m => m.id).sort(), ROSTERS[0]!.members.map(m => m.id).sort(), "links readers already hold keep resolving");
  assert.deepEqual(rosters.find(row => row.bodyId === AGENDA)!.members.map(m => m.name).sort(), ["Dana Example", "Rosa Sample"]);
  const receipts = await s.facts.query("SELECT DISTINCT s.url, s.blob_key FROM fact f JOIN source_copy s ON s.id = f.source_copy_id");
  assert.deepEqual(receipts.map(row => row.url).sort(), [AGENDA_URL, TCCC_URL].sort());
  assert.ok(receipts.every(row => String(row.blob_key).startsWith("artifact:")), "every receipt is a saved copy in the vault");
  assert.equal((await s.repos.artifactsByCanonicalUrl!(AGENDA_URL, 3)).length, 1, "the freshly fetched page is saved for the next reader");

  assert.deepEqual(await s.facts.query("SELECT entity_id, field, stage, reason, detail FROM blank"),
    [{ entity_id: ADJUSTMENT, field: `member-row:roster:${ADJUSTMENT}#1`, stage: "ACQUIRE", reason: "SOURCE_BLOCKED", detail: `${ADJUSTMENT_URL}: HTTP_404` }]);
  assert.equal(await cartonRosters(s.facts.query, readCandidate, ROSTER_SCOPE), null, "the carton is carried onto facts once");
});

test("comment rules readers saw are re-proved rule by rule on their page; a summary not on the page and an unreachable page each leave a blank", async () => {
  const ruleUrl = "https://www.tucsonaz.gov/agenda-committee/public-comment";
  const blocked = "https://unreachable.example.gov/comment";
  const rulePage = page("Agenda Committee", "<p>Call to the Audience is held at each regular meeting.</p><p>Each speaker may address the committee for three minutes.</p>");
  const records: CommentAccess[] = [
    { bodyId: AGENDA, ocdId: TUCSON, bodyNames: ["Agenda Committee"], commentPeriod: "YES", commentPeriodDetail: "Call to the Audience is held at each regular meeting.",
      signup: "Register online before the meeting.", writtenComment: null, attend: null, timeLimit: "three minutes", sourceUrl: ruleUrl, collectedAt: "2026-08-14", verifiedAt: "2026-08-14",
      fieldSources: { timeLimit: { quote: "Each speaker may address the committee for three minutes.", sourceUrl: ruleUrl, collectedAt: "2026-08-14", verifiedAt: "2026-08-14" } } },
    { bodyId: ADJUSTMENT, ocdId: TUCSON, bodyNames: ["Board of Adjustment (BAJ)"], commentPeriod: "NO", commentPeriodDetail: "No public comment is taken.", signup: null,
      writtenComment: null, attend: null, timeLimit: null, sourceUrl: blocked, collectedAt: "2026-08-14", verifiedAt: "2026-08-14" },
  ];
  const s = await setup({ live: { [ruleUrl]: rulePage } });
  await s.promote("cv-comments", "CURATED_READER_RECORD", COMMENT_SCOPE);
  const readCandidate = async (id: string) => (id === "cv-comments" ? { candidate: { readModel: { records } } } : null);
  const carton = await cartonComments(s.facts.query, readCandidate);
  assert.equal(carton?.records.length, 2);
  const report = await importCartonComments({ ...carton!, ...s.common });
  assert.deepEqual(report, { rosters: 0, live: 3, confirmed: 0, blanks: 1, unreadable: [{ url: blocked, reason: "FETCH_FAILED:connect ECONNREFUSED" }] });

  const [rules, ...others] = await readFactCommentAccess(s.facts.query, [AGENDA, ADJUSTMENT]);
  assert.deepEqual(others, [], "an unproved body is not shown as taking comment or not");
  assert.deepEqual([rules!.bodyId, rules!.commentPeriod, rules!.commentPeriodDetail, rules!.timeLimit, rules!.signup],
    [AGENDA, "YES", records[0]!.commentPeriodDetail, "three minutes", null]);
  assert.equal(rules!.fieldSources!.timeLimit!.quote, "Each speaker may address the committee for three minutes.");
  assert.ok(Object.values(rules!.fieldSources!).every(source => source!.sourceUrl === ruleUrl), "each rule cites the saved page");
  assert.deepEqual(await s.facts.query("SELECT entity_id, field, stage, reason FROM blank ORDER BY field"), [
    { entity_id: ADJUSTMENT, field: "comment:period", stage: "ACQUIRE", reason: "SOURCE_BLOCKED" },
    { entity_id: AGENDA, field: "comment:signup", stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
  assert.equal(await cartonComments(s.facts.query, readCandidate), null, "the carton is carried onto facts once");
});

const listed = (id: string) => registry.bodies.find(row => row.id === id) as unknown as Body;
const BLOCKED_OFFICE = { ...listed(ADJUSTMENT), officePhone: "(520) 791-4000", provenance: { ...listed(ADJUSTMENT).provenance, sourceUrl: "https://unreachable.example.gov/baj" } };

test("office addresses and phones readers saw go live on the body's saved page; one not on the page stays a blank; an unreadable page is reported", async () => {
  const agendaUrl = "https://www.tucsonaz.gov/agenda-committee";
  const tcccUrl = "https://www.tucsonaz.gov/tccc";
  const bodies: Body[] = [
    { ...listed(AGENDA), officeAddress: "255 W. Alameda St., Tucson, AZ 85701", officePhone: "(520) 791-4213", provenance: { ...listed(AGENDA).provenance, sourceUrl: agendaUrl } },
    { ...listed(TCCC), officeAddress: "260 S. Church Ave., Tucson, AZ 85701", provenance: { ...listed(TCCC).provenance, sourceUrl: tcccUrl } },
    BLOCKED_OFFICE,
    { ...listed(AGENDA), id: `${TUCSON}#no-office` },
  ];
  const s = await setup({
    held: { [agendaUrl]: page("Agenda Committee", "<p>City Clerk's Office, 255 W. Alameda St., Tucson, AZ 85701. Phone (520) 791-4213.</p>") },
    live: { [tcccUrl]: page("Tucson Convention Center Commission", "<p>Meetings are held downtown.</p>") },
  });
  const carton = await cartonOffices(s.facts.query, { versionId: "rv-offices", payload: { registry: { bodies } } }, "AZ");
  assert.deepEqual(carton?.bodies.map(body => body.id), [AGENDA, TCCC, ADJUSTMENT], "only bodies that showed an office are carried");
  const report = await importCartonOffices({ ...carton!, ...s.common });
  assert.deepEqual(report, { rosters: 2, live: 2, confirmed: 0, blanks: 2, unreadable: [{ url: "https://unreachable.example.gov/baj", reason: "FETCH_FAILED:connect ECONNREFUSED" }] });
  assert.deepEqual(s.fetched.sort(), ["https://unreachable.example.gov/baj", tcccUrl]);

  const live = await s.facts.query(`SELECT f.entity_id, f.field, f.value, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
    WHERE f.status = 'live' ORDER BY f.field`);
  assert.deepEqual(live, [
    { entity_id: AGENDA, field: "office_address", value: "255 W. Alameda St., Tucson, AZ 85701", url: agendaUrl },
    { entity_id: AGENDA, field: "office_phone", value: "(520) 791-4213", url: agendaUrl }]);
  assert.deepEqual(await s.facts.query("SELECT entity_id, field, stage, reason FROM blank ORDER BY entity_id"), [
    { entity_id: ADJUSTMENT, field: "office_phone", stage: "ACQUIRE", reason: "SOURCE_BLOCKED" },
    { entity_id: TCCC, field: "office_address", stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
  assert.equal(await cartonOffices(s.facts.query, { versionId: "rv-offices", payload: { registry: { bodies } } }, "AZ"), null, "the carton is carried onto facts once");
});

test("an office phone whose page cannot be read stays open as a SOURCE_BLOCKED blank after the carton is retired", async () => {
  const s = await setup({});
  await importCartonOffices({ state: "AZ", bodies: [BLOCKED_OFFICE], versionId: "rv-offices", ...s.common });
  assert.equal(await cartonOffices(s.facts.query, { versionId: "rv-offices", payload: { registry: { bodies: [BLOCKED_OFFICE] } } }, "AZ"), null);
  assert.deepEqual(await s.facts.query("SELECT entity_id, field, stage, reason FROM blank"),
    [{ entity_id: ADJUSTMENT, field: "office_phone", stage: "ACQUIRE", reason: "SOURCE_BLOCKED" }], "the phone readers saw is owed, not silently dropped");
});
