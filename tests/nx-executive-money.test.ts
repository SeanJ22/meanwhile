import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nationalExecutiveFundingAnswer, readNationalExecutiveFunding } from "../lib/funding/national-executive.ts";
import { presidentialFecMoney, resolvePresidentialFecIdentity } from "../lib/sources/white-house/presidential-records.ts";
import { ADMINISTRATION_URL, verifiedWhiteHouseOfficial } from "../lib/sources/white-house/president.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../lib/officials/people-sources.ts";
import { refreshNationalShelf } from "../lib/reader/shelf.ts";
import { installReaderDatabaseQuery, readerDatabaseQuery } from "../lib/reader/database.ts";
import { activateCanonicalFixture } from "./helpers/canonical-reader-fixtures.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { FundingDisplay } from "../components/funding/funding-section.tsx";
import { GET } from "../app/api/funding/[target]/route.ts";

const NOW = "2026-10-23T02:42:00.000Z";
const saved = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const roster = verifiedWhiteHouseOfficial("president", { url: ADMINISTRATION_URL, html: saved("white-house/administration.html") },
  { url: `${ADMINISTRATION_URL}donald-j-trump/`, html: saved("white-house/donald-j-trump.html"), retrievedAt: NOW });
const president = roster.officeholders[0];
const native = resolvePresidentialFecIdentity({ url: "https://api.open.fec.gov/v1/candidates/?office=P&election_year=2024&name=Donald+J.+Trump",
  body: saved("nx-executive/presidential/fec-candidates.json"), retrievedAt: NOW }, president, 2024);
president.fecCandidateIds = [native.candidateId];
president.executive = { money: presidentialFecMoney(saved("nx-executive/presidential/fec-totals.json"), native.candidateId, 2024, NOW)! };

test("saved President filings fill the existing funding display shape, with original period and source date", () => {
  const answer = nationalExecutiveFundingAnswer(president.id, roster);
  assert.equal(answer.kind, "funding");
  if (answer.kind !== "funding") return;
  assert.equal(answer.data.fecCandidateId, "P80001571");
  assert.equal(answer.data.name, "Donald J. Trump");
  assert.equal(answer.data.totals?.receipts, 29133.95);
  assert.equal(answer.data.reportedThrough, "2024-08-08");
  assert.equal(answer.data.cycleLabel, "2023–24");
  assert.equal(answer.data.collectedAt, NOW);
  assert.equal(answer.data.sourceUrl, "https://docquery.fec.gov/cgi-bin/fecimg/?202408089666131832");
  assert.equal(answer.data.sourceOrg, "Federal Election Commission");
  assert.equal(answer.data.contributorsShown, false);
  assert.deepEqual(answer.data.contributorGroups, { organizations: [], individuals: [] });
  assert.equal(answer.data.concentration, null);
  const rendered = renderToStaticMarkup(createElement(FundingDisplay, { data: answer.data, context: null }));
  assert.match(rendered, /data-funding-section/);
  assert.match(rendered, /2023–24/);
  assert.doesNotMatch(JSON.stringify(answer), /address_street|address_zip|donor_name/);
});

test("money stays bound to the current presidency and the independently sourced FEC candidate", () => {
  assert.equal(nationalExecutiveFundingAnswer("white-house:another-person", roster).kind, "none");
  const mismatched = structuredClone(roster);
  mismatched.officeholders[0].fecCandidateIds = ["P00000000"];
  assert.equal(nationalExecutiveFundingAnswer(president.id, mismatched).kind, "none");
  const ended = structuredClone(roster);
  ended.officeholders[0].memberships = ended.officeholders[0].memberships!.map(row => ({ ...row, current: false }));
  assert.equal(nationalExecutiveFundingAnswer(president.id, ended).kind, "none");
  assert.equal(nationalExecutiveFundingAnswer(president.id, null).kind, "none");
});

test("the funding route serves the President from this server's memory, reads again only when the stored rows change, and keeps what it holds when a check fails", async () => {
  const pointer = { recordClass: peopleSourceRecordClass("statewide-executive-sources"), scope: peopleSourceScope("US", "statewide-executive-sources"),
    sourceId: "statewide-executive-sources", versionId: "test:nx-president-money", retrievedAt: NOW };
  const publish = (held: typeof roster) => installPromotedValue({ ...pointer, value: { formatVersion: 1, sourceId: "statewide-executive-sources", jurisdiction: "US", term: "current", generatedAt: NOW, roster: held } });
  publish(roster);
  activateCanonicalFixture("default");
  const canonical = readerDatabaseQuery();
  assert.ok(canonical);
  let databaseReads = 0, upstreamRequests = 0, unavailable = false;
  const originalFetch = globalThis.fetch;
  installReaderDatabaseQuery(async statements => { databaseReads++; if (unavailable) throw new Error("current national read unavailable"); return canonical(statements); });
  globalThis.fetch = (async () => { upstreamRequests++; throw new Error("upstream request on reader path"); }) as typeof fetch;
  const receipts = async () => {
    const response = await GET(new Request(`http://localhost/api/funding/${encodeURIComponent(president.id)}`), { params: Promise.resolve({ target: president.id }) });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.kind, "funding");
    assert.equal(answer.holdingStatus, "PARTIAL", "totals do not claim complete contributor coverage");
    return answer.data.totals.receipts;
  };
  try {
    const started = performance.now();
    assert.equal(await receipts(), 29133.95);
    const loaded = databaseReads;
    assert.ok(loaded > 0);
    assert.equal(await receipts(), 29133.95);
    assert.equal((await readNationalExecutiveFunding(president.id)).kind, "funding");
    assert.equal(databaseReads, loaded, "once loaded, further requests read nothing");
    assert.ok(performance.now() - started < 3000);
    assert.equal(upstreamRequests, 0);

    await refreshNationalShelf();
    assert.equal(databaseReads, loaded + 1, "a check of an unchanged President is one small version read");
    const changed = structuredClone(roster);
    changed.officeholders[0].executive!.money!.totals.receipts = 40000;
    publish(changed);
    assert.equal(await receipts(), 29133.95, "the held President is served until the next check sees a change");
    await refreshNationalShelf();
    assert.equal(await receipts(), 40000, "same-pointer changes reach the next check");

    unavailable = true;
    await assert.rejects(refreshNationalShelf(), /current national read unavailable/);
    assert.equal(await receipts(), 40000, "a failed check keeps serving what is held");
    assert.equal(upstreamRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    installReaderDatabaseQuery(undefined);
  }
});
