import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import manifest from "./fixtures/sl-03/manifest.json" with { type: "json" };
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { normalizeOfficialLegislaturePage } from "../lib/sources/people/legislature.ts";
import type { PeopleAcquisitionOptions } from "../lib/sources/people/common.ts";
import { verifyStatewideOfficialPage, statewideRoster, type StatewideLead } from "../lib/sources/statewide/parse.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";

// ZIP 85701 (Tucson, AZ) is served by the Arizona legislature, the Governor and the other statewide officers.
// These are the real pages captured for SL-03; the merge is the one the reader makes.
const NOW = "2026-10-12T22:35:26.000Z";
function fixture(name: string) {
  const metadata = manifest.captures.find(row => row.name === name)!;
  assert.ok(metadata, name);
  const bytes = readFileSync(new URL(`./fixtures/sl-03/${metadata.file}`, import.meta.url));
  return { ...metadata, bytes, body: bytes.toString("utf8") };
}
const options = (): PeopleAcquisitionOptions => ({ sourceId: "official-state-people", state: "az", asOf: NOW, signal: new AbortController().signal,
  store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks, now: () => NOW, acquire: acquireKnownRelease });
const lead = (name: string, officeTitle: string, url: string): StatewideLead => ({ state: "az", name, officeTitle, profileUrls: [url],
  sourceId: "nass", sourceOrg: "National Association of Secretaries of State", sourceUrl: "https://www.nass.org/membership", collectedAt: NOW });

function arizonaPeople() {
  const legislature = fixture("az-legislators");
  const legislators = normalizeOfficialLegislaturePage(legislature.body, legislature.finalUrl, options(), legislature.retrievedAt);
  const executives = [
    ["az-governor-bio", "Katie Hobbs", "Governor"],
    ["az-attorney-general", "Kris Mayes", "Attorney General"],
    ["az-secretary", "Adrian Fontes", "Secretary of State"],
  ].map(([page, name, office]) => {
    const captured = fixture(page);
    const verified = verifyStatewideOfficialPage(lead(name, office, captured.finalUrl), { url: captured.finalUrl, html: captured.body, retrievedAt: captured.retrievedAt });
    return { page, name, office, verified };
  });
  return { legislators, executives };
}

test("each Arizona statewide officer is a verified person named on their own page, never a navigation label", () => {
  const { executives } = arizonaPeople();
  for (const { page, name, verified } of executives) {
    assert.ok("person" in verified, `${page}: ${JSON.stringify(verified)}`);
    if (!("person" in verified)) continue;
    assert.equal(verified.person.name, name, page);
  }
  const attorneyGeneral = executives.find(row => row.page === "az-attorney-general")!.verified;
  assert.ok("person" in attorneyGeneral && attorneyGeneral.person.name === "Kris Mayes");
});

test("a directory entry that is a page label rather than a person is not published as the Attorney General", () => {
  const page = fixture("az-attorney-general");
  for (const label of ["Actions", "Contact", "Menu"]) {
    const verified = verifyStatewideOfficialPage(lead(label, "Attorney General", page.finalUrl), { url: page.finalUrl, html: page.body, retrievedAt: page.retrievedAt });
    assert.ok(!("person" in verified), `${label} must not verify as a person`);
  }
});

test("merging the Arizona legislature with the Governor and statewide officers lists every person once", () => {
  const { legislators, executives } = arizonaPeople();
  const people = executives.flatMap(row => "person" in row.verified ? [row.verified.person] : []);
  const statewide = statewideRoster("az", people, NOW);
  const merged = mergePeopleSets([legislators, statewide])!;
  const names = merged.officeholders.map(person => person.name.normalize("NFKD").toLowerCase());
  assert.equal(new Set(names).size, names.length, "no person is listed twice");
  assert.equal(new Set(merged.officeholders.map(person => person.id)).size, merged.officeholders.length, "no id is listed twice");
  assert.equal(merged.officeholders.filter(person => person.name === "Katie Hobbs").length, 1, "the Governor appears once");
  assert.equal(merged.officeholders.filter(person => person.name === "Kris Mayes").length, 1, "the Attorney General appears once");
  assert.equal(merged.officeholders.filter(person => legislators.officeholders.some(row => row.id === person.id)).length, legislators.officeholders.length, "every legislator is kept");
  assert.ok(!merged.officeholders.some(person => /^(actions|contact|menu)$/i.test(person.name.trim())));
});
