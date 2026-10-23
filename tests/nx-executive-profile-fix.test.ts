import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseExecutiveProfile, parseExecutiveInstitutionalSocial, EXECUTIVE_INSTITUTIONAL_ACCOUNTS_URL, parseExecutiveOathRelease, executiveOathLinks } from "../lib/sources/white-house/profile.ts";
import { verifiedWhiteHouseOfficial, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { executiveCardCompleteness } from "../lib/officials/national-executive.ts";
const at = "2026-10-23T00:00:00.000Z";
const fixture = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
const index = { url: ADMINISTRATION_URL, html: fixture("white-house/administration.html"), retrievedAt: at };
const vice = verifiedWhiteHouseOfficial("vice-president", index, { url: `${ADMINISTRATION_URL}jd-vance/`, html: fixture("white-house/jd-vance.html"), retrievedAt: at }).officeholders[0];
const accounts = { url: EXECUTIVE_INSTITUTIONAL_ACCOUNTS_URL, html: fixture("nx-executive/profiles/archives-transition-faq.html"), retrievedAt: at };
const cabinet = { url: `${ADMINISTRATION_URL}cabinet/`, html: fixture("white-house/cabinet.html"), retrievedAt: at };

test("NARA's institutional @VP account binds to the current White House Vice President", () => {
  const patch = parseExecutiveInstitutionalSocial(vice, accounts);
  assert.ok(Array.isArray(patch.social));
  assert.equal((patch.social as {url:string}[])[0].url, "https://x.com/VP");
  assert.equal(patch.fieldSources!.social.sourceUrl, accounts.url);
  assert.equal(patch.fieldSources!.social.collectedAt, at);
  assert.match(patch.fieldSources!.social.quote!, /@VP/);
  assert.match(patch.fieldSources!.social.quote!, /transfer to the incoming administration/);
  assert.ok(executiveCardCompleteness({ ...vice, ...patch }).missing.includes("portrait"));
  assert.ok(!executiveCardCompleteness({ ...vice, ...patch }).missing.includes("officialSocial"));
  const sharedOnly = { ...vice, social: [], executive: { officeSocial: [{ platform: "twitter", url: "https://x.com/whitehouse", accountKind: "OFFICIAL" as const, label: "The White House on X", scope: "WHITE_HOUSE" as const, sourceUrl: cabinet.url, collectedAt: at }] } };
  assert.ok(executiveCardCompleteness(sharedOnly).missing.includes("officialSocial"));
  assert.throws(() => parseExecutiveInstitutionalSocial({ ...vice, memberships: vice.memberships!.map(row => ({ ...row, current: false })) }, accounts), /CURRENT_WHITE_HOUSE_OFFICE/);
  assert.throws(() => parseExecutiveInstitutionalSocial(vice, { ...accounts, html: accounts.html.replaceAll("@VP", "@VPArchive") }), /ACCOUNT_UNRESOLVED/);
});

test("a prior deputy appointment cannot become the current Attorney General or Labor Secretary start", () => {
  const attorney = { name: "Todd Blanche", officeTitle: "Attorney General" };
  const attorneyPage = { ...cabinet, html: cabinet.html.replace("The Honorable Todd Blanche", "Todd Blanche was sworn in as Deputy Attorney General on March 14, 2025. The Honorable Todd Blanche") };
  assert.equal(parseExecutiveProfile({ person: attorney, page: attorneyPage }).patch.termStart, undefined);
  const labor = { name: "Keith Sonderling", officeTitle: "Secretary of Labor" };
  const laborPage = { ...cabinet, html: cabinet.html.replace("Prior to becoming Secretary, Sonderling", "Keith Sonderling was sworn in as United States Deputy Secretary of Labor on March 12, 2025. Prior to becoming Secretary, Sonderling") };
  assert.equal(parseExecutiveProfile({ person: labor, page: laborPage }).patch.termStart, undefined);
  const currentPage = { ...attorneyPage, html: attorneyPage.html.replace("The Honorable Todd Blanche", "Todd Blanche took office as Attorney General on August 1, 2026. The Honorable Todd Blanche") };
  assert.equal(parseExecutiveProfile({ person: attorney, page: currentPage }).patch.termStart, "2026-08-01");
});

test("Treasury's actual oath release proves Bessent's start separately from Senate confirmation", () => {
  const person = { name: "Scott Bessent", officeTitle: "Secretary of the Treasury" };
  const page = { url: "https://home.treasury.gov/news/press-releases/sb0001", html: fixture("nx-executive/profiles/treasury-bessent-sworn.html"), retrievedAt: at };
  const patch = parseExecutiveOathRelease(person, page);
  assert.equal(patch.termStart, "2025-01-28");
  assert.equal(patch.fieldSources!.termStart.sourceUrl, page.url);
  assert.equal(patch.fieldSources!.termStart.collectedAt, at);
  assert.match(patch.fieldSources!.termStart.quote!, /Secretary of the Treasury/);
  assert.match(patch.fieldSources!.termStart.quote!, /Brett M\. Kavanaugh on January 28, 2025/);
  assert.throws(() => parseExecutiveOathRelease({ ...person, officeTitle: "Attorney General" }, page), /OWN_DEPARTMENT/);
  assert.throws(() => parseExecutiveOathRelease(person, { ...page, html: page.html.replaceAll("Secretary of the Treasury", "Deputy Secretary of the Treasury") }), /CURRENT_OFFICE_DATE/);
  const lead = { ...page, html: `<a href="${page.url}">Scott Bessent sworn in as Secretary of the Treasury</a>` };
  assert.deepEqual(executiveOathLinks(person, lead), [page.url]);
  assert.deepEqual(executiveOathLinks({ ...person, name: "A Different Person" }, lead), []);
});
