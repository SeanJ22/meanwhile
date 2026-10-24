import { test } from "node:test";
import assert from "node:assert/strict";

import { isOfficialSource, type GovernmentWebsiteDelegation } from "../lib/civic-data/source-authority.ts";
import { createHash } from "node:crypto";

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

const delegatedPage = (): GovernmentWebsiteDelegation => {
  const text = JSON.stringify({ Status: 0, Question: [{ name: "elections.example.gov.", type: 5 }],
    Answer: [{ name: "elections.example.gov.", type: 5, data: "government-delivery.example.net." }] });
  return { governmentUrl: "https://elections.example.gov/2026", html: '<link rel="canonical" href="https://elections.example.gov/2026">',
    dns: { url: "https://dns.google/resolve?name=elections.example.gov&type=CNAME", text,
      artifactId: "saved-dns-response", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
      retrievedAt: "2026-10-14T19:00:00.000Z" } };
};

test("saved government CNAME authority identifies the same canonical page on its delivery host", () => {
  assert.equal(isOfficialSource("https://government-delivery.example.net/2026", null, delegatedPage()), true);
  assert.equal(isOfficialSource("https://unrelated.example.net/2026", null, delegatedPage()), false);
  assert.equal(isOfficialSource("https://government-delivery.example.net/other", null, delegatedPage()), false);
});

test("a DNS delegate requires the government's exact canonical page in the native HTML", () => {
  const url = "https://government-delivery.example.net/2026", proof = delegatedPage();
  for (const html of ["<h1>Election office</h1>", '<link rel="canonical" href="https://other.example.gov/2026">',
    '<link rel="canonical" href="https://elections.example.gov/other">',
    '<link rel="canonical" href="https://elections.example.gov/2026"><link rel="canonical" href="https://other.example.gov/2026">']) {
    assert.equal(isOfficialSource(url, null, { ...proof, html }), false);
  }
  assert.equal(isOfficialSource(url, null, { ...proof, governmentUrl: "https://elections.example.com/2026" }), false);
});

test("a DNS delegate refuses an unrelated CNAME owner, resolver, failed response or missing archive identity", () => {
  const url = "https://government-delivery.example.net/2026", proof = delegatedPage();
  for (const dns of [{ ...proof.dns, text: proof.dns.text.replaceAll("elections.example.gov", "other.example.gov") },
    { ...proof.dns, text: proof.dns.text.replace('"Status":0', '"Status":3') },
    { ...proof.dns, url: "https://unrelated.example.net/resolve?name=elections.example.gov&type=CNAME" },
    { ...proof.dns, artifactId: "" }, { ...proof.dns, text: "{" }]) {
    assert.equal(isOfficialSource(url, null, { ...proof, dns }), false);
  }
});
