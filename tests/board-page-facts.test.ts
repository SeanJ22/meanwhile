import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { extractRoster, looksLikeNameCell } from "../lib/hunt/roster-page.ts";
import { blankLinks, siteFindings, type SiteScope } from "../lib/hunt/site-findings.ts";
import { commentRuleSentences, isCommentLinkText, schedulePhrase } from "../lib/hunt/page-rules.ts";

const page = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", "board-pages", name), "utf8");
const scopeFor = (name: string, website: string, id: string): SiteScope => ({ governmentId: id, name, state: "AL", bodyId: `${id}#governing`, website, bodyContext: true });
const read = (scope: SiteScope, url: string, html: string) => siteFindings(scope, { url, html, artifactId: "a", observedAt: "2026-10-22T12:00:00.000Z" });

// These pages are Brewton's, Prichard's and Chatom's own, saved as the hunters found them; the rules are for every page in every state.
test("a council page that lists its members as cards gives every member, their seat and their address, whatever the markup", () => {
  const brewton = extractRoster("http://www.cityofbrewton.org/government/city-council/", page("brewton-council.html")).members;
  assert.deepEqual(brewton.map(member => [member.name, member.officeTitle]), [
    ["Frank M. Nalty JR.", "City of Brewton Mayor"], ["Greg Fleming", "Councilor District 1"], ["David Jennings", "Councilor District 2"],
    ["Feast Broughton", "Councilor District 3"], ["Joe Watson", "Councilor District 4"], ["Cheryl Barton", "Councilor District 5"]]);
  assert.ok(brewton.every(member => /@/.test(member.email ?? "")), "plain-text addresses count as much as mailto links");
  const prichard = extractRoster("http://thecityofprichard.org/prichard-city-council/", page("prichard-council.html")).members;
  assert.deepEqual(prichard.map(member => [member.name, member.officeTitle, member.phone]), [
    ["Annie Williams", "District 1", "251-452-7801"], ["Stephani Johnson-Norwood", "District 2", "251-452-7802"], ["Traci D. Hale", "District 3", "251-452-7803"]]);
  assert.deepEqual(prichard.map(member => member.email), ["a.williams@thecityofprichard.org", "s.norwood@thecityofprichard.org", "t.hale@thecityofprichard.org"], "an address the page hides from scrapers is the address its readers see");
});

test("a list of meetings is not a roster, and a place, notice or menu item is not a person", () => {
  assert.deepEqual(extractRoster("https://prichardcitycouncil.org/meetings", page("prichard-meetings.html")).members, []);
  for (const junk of ["AJ Cooper Municipal Complex", "Pay Ticket Online", "Election Announcement", "Meeting Notice", "Department Quick Links", "Agenda Portal", "Calendar of Events",
    "Public Works Department", "Boards And Committees", "Brewton Councilors", "Minutes And Agendas"]) assert.equal(looksLikeNameCell(junk), false, junk);
  for (const person of ["Frank M. Nalty JR.", "Traci D. Hale", "Roy Smith, II", "Stephani Johnson-Norwood", "Sam Hall", "Jane Park", "Maria De La Cruz", "Pat O'Brien", "Cheryl Barton"]) assert.equal(looksLikeNameCell(person), true, person);
});

test("a body's schedule is the phrase the page states, and a comment rule is a sentence about its meetings", () => {
  const brewton = read(scopeFor("City of Brewton", "http://www.cityofbrewton.org/", "al:city:city-of-brewton"), "http://www.cityofbrewton.org/government/city-council/", page("brewton-council.html"));
  const cadence = brewton.filter(finding => finding.field === "MTG-04");
  assert.deepEqual(cadence.map(finding => finding.value), ["each 2nd and 4th Monday of each month"], "not the paragraph around it");
  assert.match(cadence[0]!.exactQuote, /Regular Meetings held each 2nd and 4th Monday of each month/);
  assert.equal(brewton.filter(finding => finding.field === "OFF-04").length, 6);
  assert.equal(schedulePhrase("The board meets on the first and third Thursdays at 6:30 p.m. in the library."), "first and third Thursdays at 6:30 p.m.");
  assert.equal(schedulePhrase("We meet every Tuesday."), "every Tuesday");
  assert.equal(schedulePhrase("Budget workshops are held in the spring."), null);
  // A grant notice that asks for comment is not the board's rule for taking part.
  const chatom = read(scopeFor("Town of Chatom", "http://www.chatom.org/", "al:city:town-of-chatom"), "http://www.chatom.org/", page("chatom-notice.html"));
  assert.deepEqual(chatom.filter(finding => finding.field === "PAR-02"), []);
  const none = new Set<string>();
  assert.deepEqual(commentRuleSentences("Public Comment", none), [], "a heading");
  assert.deepEqual(commentRuleSentences("Written comments must be received by the Town of Chatom on or before 4/21/2026.", none), [], "a notice with no meeting in it");
  assert.deepEqual(commentRuleSentences("Public Comment", new Set(["public comment"])), [], "link text");
  assert.deepEqual(commentRuleSentences("Sign Up To Speak At A Council Meeting", new Set(["sign up to speak at a council meeting"])), [], "link text, even long");
  assert.deepEqual(commentRuleSentences("Public Comment And Participation At Council Meetings", none), [], "a title-cased heading");
  assert.deepEqual(commentRuleSentences("Residents may address the Council during public comment at each regular meeting; speakers are limited to three minutes.", none),
    ["Residents may address the Council during public comment at each regular meeting; speakers are limited to three minutes."]);
  assert.equal(isCommentLinkText("Public Comment"), true);
  assert.equal(isCommentLinkText("Residents may address the Council during public comment at each regular meeting and are asked to sign in."), false);
});

test("a link whose text says how to comment is followed even when no blank asks for it", () => {
  const html = `<html><body><main><h1>City Council</h1><p><a href="/government/public-comment">Public Comment</a> <a href="/parks">Parks</a></p></main></body></html>`;
  const links = blankLinks({ url: "https://example.gov/council", html, artifactId: "a", observedAt: "2026-10-22T12:00:00.000Z" }, new Set());
  assert.deepEqual(links.map(link => link.url), ["https://example.gov/government/public-comment"]);
});

test("a long page about taking part with no rule sentence in it goes to the plain-English summary; a short one or one with rule sentences does not", () => {
  const scope = scopeFor("City of Brewton", "https://www.cityofbrewton.org/", "al:city:city-of-brewton");
  const url = "https://www.cityofbrewton.org/government/public-participation";
  const filler = Array.from({ length: 30 }, (_, at) => `<li>Form field ${at + 1}: name, address, agenda item number and topic</li>`).join("");
  const long = `<html><body><main><h1>Public Participation at Council Meetings</h1><ul>${filler}</ul></main></body></html>`;
  const found = read(scope, url, long).filter(finding => finding.field === "publicComment.page");
  assert.deepEqual(found.map(finding => [finding.value, finding.exactQuote, finding.subjectId]), [[url, "Public Participation at Council Meetings", "al:city:city-of-brewton#governing"]]);
  assert.deepEqual(read(scope, url, `<html><body><main><h1>Public Participation</h1><p>Contact the clerk.</p></main></body></html>`).filter(finding => finding.field === "publicComment.page"), []);
  const withRules = `<html><body><main><h1>Public Participation at Council Meetings</h1><p>Residents may address the Council during public comment at each regular meeting.</p><ul>${filler}</ul></main></body></html>`;
  const ruled = read(scope, url, withRules);
  assert.deepEqual(ruled.filter(finding => finding.field === "publicComment.page"), []);
  assert.deepEqual(ruled.filter(finding => finding.field === "PAR-02").map(finding => finding.value), ["Residents may address the Council during public comment at each regular meeting."]);
});
