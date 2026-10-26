import assert from "node:assert/strict";
import test from "node:test";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readBodyFacts } from "../lib/facts/registry-overlay.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import { bodyContactRows, bodyContactSources } from "../lib/registry/body-contact.ts";
import { districtCardSources } from "../lib/officials/card-sources.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { factDb } from "./helpers/fact-db.ts";

const BODY = "ocd-division/country:us/state:nc/county:wake#governing";
const DIVISION = BODY.split("#")[0];
const at = "2026-10-25T12:00:00.000Z";
const source = { sourceUrl: "https://wake.example.gov/board", sourceOrg: "Wake County", collectedAt: at, verifiedAt: null };

function bodyFixture(overrides: Partial<CoveredBody> = {}): CoveredBody {
  return { bodyId: BODY, ocdId: DIVISION, name: "Board of Commissioners", divisionLabel: "Wake County", divisionType: "county", lsad: null,
    schoolDependency: "UNCLASSIFIED", bodyClass: "GOVERNING", coverageStatus: "NOT_ATTEMPTED", homepageUrl: null,
    agendaSourceRef: null, lookedAt: false, tier: "local", ...overrides };
}

test("published body contacts reach Contact together and keep every source page", async () => {
  const db = await factDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Wake County','NC',NULL),($2,'body','Board of Commissioners','NC',$1)", [DIVISION, BODY]);
    const contacts = [
      ["office_phone", "919-555-0100 ext. 42"],
      ["office_address", "301 South McDowell Street, Raleigh, NC"],
      ["office_email", "board@wake.example.gov"],
      ["homepage", "https://wake.example.gov/board"],
    ];
    for (const [index, [field, value]] of contacts.entries()) {
      const url = `https://wake.example.gov/contact/${index}`;
      await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES($1,$2,$2,$3,$4,$5)", [index + 1, url, at, "a".repeat(64), `contact-${index}`]);
      await door(db, { entity: { id: BODY, fullName: "Board of Commissioners", stateName: "North Carolina", hosts: [], externalIds: [] },
        field, fieldKind: "contact", value, valueText: value, quote: value, provenance: "OFFICIAL", producedBy: "ct-01-test", costUsd: 0,
        copy: { id: index + 1, finalUrl: url, text: value, fetchedAt: new Date(at), isArchive: false } },
      factClocks(null), new Date(at), { purge: async () => ({ purged: true }) });
    }
    const runtime: RegistryRuntimeReadModel = { formatVersion: 1,
      registry: { generatedAt: at, bodies: [{ id: BODY, ocdId: DIVISION, name: "Board of Commissioners", bodyClass: "GOVERNING",
        bodyOrigin: "SOURCED", coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null,
        meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY", provenance: source }],
      divisions: [{ ocdId: DIVISION, divisionType: "county", label: "Wake County", tier: "local", state: "NC", parentOcdId: null,
        lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: DIVISION, canonicalMatch: "exact", sourceDataset: "TIGER_CB2023", provenance: source }] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
    const facts = await readBodyFacts(db.query, [BODY], true);
    const body = stateCoverage({ state: "NC", registry: runtime, version: "ct-01-test" }, [DIVISION], 0, 0, [], facts).bodies[0];
    assert.deepEqual(bodyContactRows(body), [
      { label: "Phone", value: contacts[0][1], href: "tel:9195550100;ext=42" },
      { label: "Office address", value: contacts[1][1], href: null },
      { label: "Email", value: contacts[2][1], href: "mailto:board@wake.example.gov" },
      { label: "Website", value: "wake.example.gov", href: contacts[3][1] },
    ]);
    const urls = new Set(districtCardSources([], [], body.officeContact?.provenance, body.fieldSources).map(entry => entry.provenance.sourceUrl));
    for (const index of contacts.keys()) assert.ok(urls.has(`https://wake.example.gov/contact/${index}`));
  } finally { await db.pg.close(); }
});

test("the already held shared board number is readable without a website or direct office contacts", () => {
  const body = bodyFixture({
    readerRoster: { members: [{ id: "held:member", name: "Held Member", officeTitle: "Commissioner", phone: "919-555-0200", provenance: source,
      partyLabel: null, termEnd: null, birthDate: null, websiteUrl: null, sourceUrl: source.sourceUrl, email: null,
      contactFormUrl: null, photoUrl: null, campaignUrl: null }], gaps: [],
      officePhone: { phone: "919-555-0200", sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg } },
  });
  assert.deepEqual(bodyContactRows(body), [{ label: "Phone", value: "919-555-0200", href: "tel:9195550200" }]);
  assert.deepEqual(bodyContactSources(body).map(entry => entry.provenance), [source]);
  assert.deepEqual(bodyContactRows({ ...body, readerRoster: undefined }), []);
});

test("a sourced website keeps its publisher page even without a per-field source", () => {
  const body = bodyFixture({ homepageUrl: "https://wake.example.gov/board", provenance: source });
  assert.deepEqual(bodyContactSources(body).map(entry => entry.provenance), [source]);
});

test("distinct published board phones stay visible and a repeated number appears once", () => {
  const body = bodyFixture({
    officeContact: { phone: "919-555-0100", address: null, provenance: source },
    readerRoster: { members: [], gaps: [], officePhone: { phone: "(919) 555-0100", sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg } },
  });
  assert.equal(bodyContactRows(body).length, 1);
  body.readerRoster!.officePhone!.phone = "919-555-0200";
  assert.deepEqual(bodyContactRows(body).map(row => row.value), ["919-555-0100", "919-555-0200"]);
});
