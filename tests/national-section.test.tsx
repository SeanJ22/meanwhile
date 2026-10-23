import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NationalCard } from "../lib/national/section.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { serverReaderValue } from "../lib/reader/memory.ts";
import { NATIONAL_LINK_LABEL, NATIONAL_PATH } from "../lib/national/link.ts";

const resident = { roster: null as OfficeholderSet | null };
serverReaderValue("national-president", () => async () => resident.roster);
const { NationalLink } = await import("../components/shell/national-link.tsx");
const { NationalSection } = await import("../components/national/national-section.tsx");
const { default: NationalPage } = await import("../app/national/page.tsx");
const { readNationalCards } = await import("../lib/national/section.ts");

const card = (id: string): NationalCard => ({ id, office: "Cabinet", title: `Secretary ${id}`, holder: `Holder ${id}`,
  sources: [{ what: "the department head", provenance: { sourceUrl: "https://www.whitehouse.gov/administration/cabinet/", sourceOrg: "whitehouse.gov", collectedAt: "2026-10-22", verifiedAt: null } }] });

test("the link reads 'National government, coming soon' and goes to the National section", () => {
  const html = renderToStaticMarkup(<NationalLink />);
  assert.match(html, new RegExp(`href="${NATIONAL_PATH}"`));
  assert.ok(html.includes(NATIONAL_LINK_LABEL));
  assert.equal(NATIONAL_LINK_LABEL, "National government, coming soon");
});

test("with no verified national executive the National section says it is coming soon, with the sooner link, and lists no card", async () => {
  const html = renderToStaticMarkup(await NationalPage());
  assert.match(html, /National government/);
  assert.match(html, /data-national-gap/);
  assert.match(html, /Want us to get this sooner\?/);
  assert.doesNotMatch(html, /data-national-cards/);
});

test("every card is rendered, each with its sources section", () => {
  const html = renderToStaticMarkup(<NationalSection cards={[card("a"), card("b")]} />);
  assert.match(html, /Secretary a/);
  assert.match(html, /Secretary b/);
  assert.match(html, /data-national-cards/);
  assert.doesNotMatch(html, /data-national-gap/);
});

test("both doors to the National section are on the shell: under the Local, State and Federal filter and in Who governs here", () => {
  assert.match(readFileSync(new URL("../components/shell/sidebar.tsx", import.meta.url), "utf8"), /<ViewToggle \/>\s*<NationalLink \/>/);
  assert.match(readFileSync(new URL("../components/map/coverage-notice.tsx", import.meta.url), "utf8"), /<NationalLink className="national-link mt-3 block" \/>/);
});

test("a current executive with seat, name and source page reaches the page; the rest of the profile is never a gate", async () => {
  const at = "2026-10-23T00:00:00.000Z", sourceUrl = "https://www.whitehouse.gov/administration/jd-vance/";
  const imageUrl = "https://www.whitehouse.gov/vance.jpg", imageHash = `sha256-${"a".repeat(64)}`;
  const provenance = { sourceUrl, sourceOrg: "The White House", collectedAt: at, verifiedAt: at };
  const person: Officeholder = {
    id: "white-house:jd-vance", name: "JD Vance", officeTitle: "Vice President of the United States", level: "FEDERAL",
    partyLabel: "Republican", termStart: "2025-01-20", termEnd: "2029-01-20", birthDate: null, websiteUrl: sourceUrl,
    phone: null, email: null, contactFormUrl: "https://www.whitehouse.gov/contact/", campaignUrl: null, provenance,
    fieldSources: Object.fromEntries(["partyLabel", "termStart", "termEnd", "contactFormUrl"].map(key => [key, provenance])),
    photo: { url: `/api/portraits/officials/${imageHash.slice(7)}.webp`, sourceUrl: imageUrl, collectedAt: at, license: null, attribution: null,
      verification: { personId: "white-house:jd-vance", name: "JD Vance", basis: "OWN_PAGE", ownPageUrl: sourceUrl,
        imageUrl, imageHash, sourceImageHash: imageHash, checkedAt: at, attribution: { name: "JD Vance", sourceUrl },
        sources: [{ url: sourceUrl, artifactId: "test-capture", contentHash: imageHash, retrievedAt: at }] } },
    social: [{ platform: "x", url: "https://x.com/VP", accountKind: "OFFICIAL", sourceUrl, collectedAt: at }],
    executive: { biography: { text: "JD Vance serves as Vice President.", sourceUrl, collectedAt: at }, coverage: { tieBreakingVotes: true } },
  };
  const roster: OfficeholderSet = { scope: "US", generatedAt: at, officeholders: [person], unmatched: [],
    divisions: [{ officeholderId: person.id, ocdId: "ocd-division/country:us", bodyId: null }] };
  resident.roster = roster;
  try {
    const cards = await readNationalCards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, person.id);
    assert.equal(cards[0].title, person.officeTitle);
    assert.equal(cards[0].holder, person.name);
    assert.ok(cards[0].sources.some(row => row.provenance.sourceUrl === sourceUrl));
    const html = renderToStaticMarkup(await NationalPage());
    assert.match(html, /JD Vance/);
    assert.match(html, /Vice President of the United States/);
    assert.match(html, /data-national-cards/);
    // The production shape on Oct 23: seat, name and the White House page, with no portrait, biography, term or votes yet.
    const minimum: Officeholder = { ...person, photo: null, partyLabel: null, termStart: "", termEnd: "", contactFormUrl: null, social: [], fieldSources: {}, executive: undefined };
    resident.roster = { ...roster, officeholders: [minimum] };
    assert.deepEqual((await readNationalCards()).map(row => [row.holder, row.title]), [["JD Vance", "Vice President of the United States"]]);
    assert.match(renderToStaticMarkup(await NationalPage()), /JD Vance/);
    resident.roster = { ...roster, officeholders: [{ ...minimum, provenance: { ...provenance, sourceUrl: "" } }] };
    assert.deepEqual(await readNationalCards(), [], "without the page it came from, the holder is not published");
    assert.match(renderToStaticMarkup(await NationalPage()), /data-national-gap/);
    resident.roster = { ...roster, officeholders: [{ ...person, memberships: [{ id: "former-vp", personId: person.id,
      officeId: "vice-president", jurisdiction: "US", sourceUrl, officeTitle: person.officeTitle,
      divisionId: "ocd-division/country:us", current: false }] }], divisions: [{ ...roster.divisions[0], membershipId: "former-vp" }] };
    assert.deepEqual(await readNationalCards(), [], "a former holder is never listed");
  } finally { resident.roster = null; }
});
