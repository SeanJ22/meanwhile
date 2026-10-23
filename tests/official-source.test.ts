import { test } from "node:test";
import assert from "node:assert/strict";

import { isOfficialSource } from "../lib/civic-data/source-authority.ts";

const cityPage = {
  url: "https://www.sierravistaaz.gov/government/city-council",
  html: `<a href="https://sierravista.legistar.com/Calendar.aspx">Agendas</a>
         <a href='/government/city-council/contact-the-mayor-council'>Contact</a>
         <a href=https://www.cochise.az.us/board>County</a>`,
};

test("any .gov site is official by itself", () => {
  assert.equal(isOfficialSource("https://www.sierravistaaz.gov/government/city-council"), true);
  assert.equal(isOfficialSource("http://api.open.fec.gov/v1/"), true);
  assert.equal(isOfficialSource("https://gov.example.com/"), false);
  assert.equal(isOfficialSource("not a url"), false);
});

test("a vendor portal or a .us/.org/.com government site is official once an official page links it", () => {
  assert.equal(isOfficialSource("https://sierravista.legistar.com/View.ashx?M=A&ID=1"), false);
  assert.equal(isOfficialSource("https://sierravista.legistar.com/View.ashx?M=A&ID=1", cityPage), true);
  assert.equal(isOfficialSource("https://cochise.az.us/board/members", cityPage), true);
  assert.equal(isOfficialSource("https://other.legistar.com/Calendar.aspx", cityPage), false);
});

test("the linking page must itself be official, directly or through its own link", () => {
  const unofficial = { url: "https://news.example.com/story", html: `<a href="https://sierravista.legistar.com/">x</a>` };
  assert.equal(isOfficialSource("https://sierravista.legistar.com/", unofficial), false);
  const portal = { url: "https://sierravista.legistar.com/Calendar.aspx", html: `<a href="https://sierravista.granicus.com/player/clip/9">video</a>`, linkingPage: cityPage };
  assert.equal(isOfficialSource("https://sierravista.granicus.com/player/clip/9", portal), true);
});

test("a native government JSON directory's explicit website link establishes its publisher", () => {
  const directory = { url: "https://www.sos.mo.gov/elections/authority-directory", html: JSON.stringify([
    { COUNTY_NAME: "Kansas City", WEBSITE: "https://www.kceb.org" },
    { COUNTY_NAME: "Example", website: { Url: "https://elections.example.us/" } },
    { description: "https://unrelated.example.org", email: "person@example.com" },
  ]) };
  assert.equal(isOfficialSource("https://kceb.org/elections/poll-locations/", directory), true);
  assert.equal(isOfficialSource("https://elections.example.us/", directory), true);
  assert.equal(isOfficialSource("https://unrelated.example.org/", directory), false);
  assert.equal(isOfficialSource("https://kceb.org.example.com/", directory), false);
  assert.equal(isOfficialSource("https://kceb.org/", { ...directory, url: "https://unverified.example.com/" }), false);
  assert.equal(isOfficialSource("https://kceb.org/", { ...directory, html: 'Text mentioning {"WEBSITE":"https://www.kceb.org"}' }), false);
});
