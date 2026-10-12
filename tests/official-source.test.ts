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

test("an official link binds a shared platform account or document, not unrelated tenants or archive copies", () => {
  const page = { url: "https://town.gov/", html: '<a href="https://www.facebook.com/TownCouncil">Council</a><a href="https://youtube.com/watch?v=meeting-1&amp;list=council">Meeting</a><a href="https://sites.google.com/view/town-council/">Site</a><a href="https://twitter.com/">Social</a><a href="https://web.archive.org/web/2020/https://town.gov/">Archive</a><img src="https://unrelated.example/track.png">' };
  assert.equal(isOfficialSource("https://facebook.com/TownCouncil/posts/123", page), true);
  assert.equal(isOfficialSource("https://facebook.com/TownCouncilFans", page), false);
  assert.equal(isOfficialSource("https://facebook.com/OtherTown", page), false);
  assert.equal(isOfficialSource("https://facebook.com/TownCouncil/%2e%2e/OtherTown", page), false);
  assert.equal(isOfficialSource("https://youtube.com/watch?v=meeting-1&list=council", page), true);
  assert.equal(isOfficialSource("https://youtube.com/watch?v=meeting-2&list=council", page), false);
  assert.equal(isOfficialSource("https://sites.google.com/view/town-council/agendas", page), true);
  assert.equal(isOfficialSource("https://sites.google.com/view/someone-else", page), false);
  assert.equal(isOfficialSource("https://twitter.com/anyone", page), false);
  assert.equal(isOfficialSource("https://web.archive.org/web/2020/https://town.gov/", page), false);
  assert.equal(isOfficialSource("https://unrelated.example/anywhere", page), false, "an image embed is not an official website link");
});


test("an embedded civic portal establishes its dedicated host but linked assets do not", () => {
  const page = { url: "https://town.gov/", html: '<iframe src="https://town.legistar.com/Calendar.aspx"></iframe><script src="https://scripts.example/tracker.js"></script><link href="https://styles.example/main.css"><img src="https://images.example/seal.png">' };
  assert.equal(isOfficialSource("https://town.legistar.com/View.ashx?ID=1", page), true);
  for (const host of ["scripts.example", "styles.example", "images.example"]) assert.equal(isOfficialSource(`https://${host}/any`, page), false);
});


test("markup examples and inactive links do not establish an official source", () => {
  const page = { url: "https://town.gov/", html: '<!-- <a href="https://example.org/">old link</a> --><script>const sample = `<a href="https://example.org/">example</a>`;</script><template><a href="https://example.org/">template</a></template>' };
  assert.equal(isOfficialSource("https://example.org/records", page), false);
});
