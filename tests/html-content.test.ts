import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { readableContent } from "../lib/extract/html-content.ts";
import { extractHtmlText } from "../lib/meetings/agenda-documents.ts";

/** Navigation chrome must never masquerade as civic content, and legitimate prose containing chrome words must survive. */

const text = (html: string) =>
  extractHtmlText(html).replace(/\s+/g, " ").trim();

test("DATA-1: a div-soup page with no landmarks drops its menu and keeps its notice", () => {
  // The shape of www.cap-az.com: no <main>, no <nav>, no roles. Elementor
  // names its regions in class attributes and nowhere else.
  const html = `
    <html><body class="page-template-elementor_header_footer">
      <a class="screen-reader-text skip-link" href="#content" title="Skip to content">Skip to content</a>
      <div class="elementor elementor-location-header">
        <ul class="elementor-nav-menu">
          <li class="menu-item"><a href="/water">Know Your Water</a></li>
          <li class="menu-item"><a href="/news">News</a></li>
          <li class="menu-item"><a href="/es">En Espanol</a></li>
        </ul>
      </div>
      <div id="content">
        <p>CAWCD meeting notices are posted at CAP Headquarters, 23636 N. 7th
        Street, Phoenix in the Building 1 reception area.</p>
      </div>
      <div class="elementor-location-footer">
        <a href="#">Facebook-f</a> <a href="#">X-twitter</a>
      </div>
    </body></html>`;

  const out = text(html);
  assert.match(out, /CAWCD meeting notices are posted at CAP Headquarters/);
  assert.doesNotMatch(out, /Skip to content/i);
  assert.doesNotMatch(out, /Know Your Water/i);
  assert.doesNotMatch(out, /En Espanol/i);
  assert.doesNotMatch(out, /Facebook-f/i);
});

test("DATA-1 control: a landmark page uses <main> and drops nav/header/footer", () => {
  const html = `
    <html><body>
      <header><a href="/">Home</a> <a href="/news">News</a></header>
      <nav><a href="/board">Board</a> <a href="/jobs">Careers</a></nav>
      <main><p>The Board will consider the fiscal year budget override.</p></main>
      <footer><a href="/privacy">Privacy Policy</a></footer>
    </body></html>`;

  const r = readableContent(html);
  assert.equal(r.region, "main");
  const out = text(html);
  assert.match(out, /fiscal year budget override/);
  assert.doesNotMatch(out, /Privacy Policy/i);
  assert.doesNotMatch(out, /Careers/i);
});

test("DATA-1 control: ARIA roles are honoured when tags are generic divs", () => {
  const html = `
    <html><body>
      <div role="banner"><span>Sahuarita Unified District</span></div>
      <div role="navigation"><a href="/a">Agendas</a> <a href="/b">Minutes</a></div>
      <div role="main"><p>Call to order at 6:00 p.m. in the district office.</p></div>
      <div role="contentinfo"><span>All rights reserved</span></div>
    </body></html>`;

  const r = readableContent(html);
  assert.equal(r.region, "role-main");
  const out = text(html);
  assert.match(out, /Call to order at 6:00 p\.m\./);
  assert.doesNotMatch(out, /All rights reserved/i);
});

test("DATA-1 control: a link-dense list is dropped even with no chrome class", () => {
  // Vendor-neutral backstop: this menu names itself nothing at all.
  const links = Array.from(
    { length: 14 },
    (_, i) => `<li><a href="/p${i}">Department Page Number ${i}</a></li>`,
  ).join("");
  const html = `
    <html><body><div id="content">
      <ul>${links}</ul>
      <p>The governing board meets on the second Tuesday of each month.</p>
    </div></body></html>`;

  const out = text(html);
  assert.match(out, /second Tuesday of each month/);
  assert.doesNotMatch(out, /Department Page Number 7/);
});

test("DATA-1 negative control: civic prose is not keyword-deleted", () => {
  // Each sentence contains a word that also appears in navigation chrome.
  const html = `
    <html><body><main>
      <p>The Board will receive the News and Public Information Officer's
      quarterly report.</p>
      <p>Staff will present the district's Facebook and social media policy for
      adoption.</p>
      <p>Item 7: Careers in Water Supply — an update on the internship menu
      offered to secondary students.</p>
    </main></body></html>`;

  const out = text(html);
  assert.match(out, /News and Public Information Officer/);
  assert.match(out, /Facebook and social media policy/);
  assert.match(out, /Careers in Water Supply/);
  assert.match(out, /internship menu/);
});

test("DATA-1 negative control: a short link line beside prose survives", () => {
  // Below LINK_DENSITY_MIN_CHARS. Cutting it would lose a real agenda link.
  const html = `
    <html><body><main>
      <div><a href="/packet.pdf">Board packet</a></div>
      <p>Public comment will be taken on each action item before the vote is
      called by the presiding officer.</p>
    </main></body></html>`;

  const out = text(html);
  assert.match(out, /Board packet/);
  assert.match(out, /Public comment will be taken/);
});

test("DATA-1: an empty page extracts as empty, never as invented content", () => {
  assert.equal(text("<html><body><nav><a href='/'>Home</a></nav></body></html>"), "");
});

test("DATA-1: entity decoding and mojibake repair still run after the region pass", () => {
  const html = `<html><body><main><p>Rates &amp; Fees &#8212; 9:00 a.m.</p></main></body></html>`;
  const out = text(html);
  assert.match(out, /Rates & Fees/);
});

/* Recorded Diligent Community meeting pages: page-state values, script tokens and WebResource ids are fixed placeholders; every other byte is as served. */
const tusd502 = readFileSync("tests/fixtures/diligent/meeting-information-tusd-502.html", "utf8");
const pcc698 = readFileSync("tests/fixtures/diligent/meeting-information-pcc-698.html", "utf8");

test("a WebForms page is not deleted with its server form: the page's own content survives", () => {
  // What was stored before: the only words outside `<form id="aspnetForm">`.
  const stored = "Skip Navigation Jump to SideBar Tucson Unified School District";
  const r = readableContent(tusd502);
  assert.equal(r.pageForms, 1, "the server form wrapping the page was not recognised");
  assert.equal(r.region, "role-main", "the page's own main region is inside the form");
  const out = text(tusd502);
  assert.notEqual(out, stored);
  assert.match(out, /Bond Oversight Committee Meeting Agenda/);
  assert.match(out, /Names and details, including available support documents/);
  assert.match(text(pcc698), /Finance and Audit Committee Meeting/);
});

test("the kept server form still loses its controls: no page state, no sign-in panel, no buttons", () => {
  for (const html of [tusd502, pcc698]) {
    const out = text(html);
    assert.doesNotMatch(out, /SANITIZED-|VIEWSTATE|EVENTVALIDATION|TSM/, "page state reached the text");
    // The separate sign-in form after the page form is a control, and goes whole.
    assert.doesNotMatch(out, /Remember me next time|Forgot password|User name/);
    // The meeting carousel and the document-type toolbar are <button>s.
    assert.doesNotMatch(out, /Live Meeting|Show Map/);
  }
});

test("a hidden field can never leak into text, even when its value holds a '>'", () => {
  const html = `<html><body><form id="aspnetForm" action="./Page.aspx">
      <input type="hidden" name="__VIEWSTATE" value="dDwt>LEAKED-STATE<x" />
      <input type="hidden" name="token" value='a>LEAKED-TOKEN' />
      <div><p>The board will hear the annual audit report and adopt the calendar.</p></div>
    </form></body></html>`;
  const out = text(html);
  assert.match(out, /annual audit report/);
  assert.doesNotMatch(out, /LEAKED/);
});

test("a form nested inside the page form is still a control and goes whole", () => {
  const html = `<html><body><form id="aspnetForm">
      <input type="hidden" name="__VIEWSTATE" value="x" />
      <form id="search"><span>Search the archive</span></form>
      <div><p>Item 1. Approval of the consent agenda and the minutes of June 3.</p></div>
    </form></body></html>`;
  const out = text(html);
  assert.match(out, /Approval of the consent agenda/);
  assert.doesNotMatch(out, /Search the archive/);
});

test("negative control: a form that is not a WebForms server form is removed whole, however much it holds", () => {
  // The measured case: a search engine's bot challenge keeps its words inside
  // its own form. Keeping them would turn a wall into content.
  const html = `<html><body><h1>Example Search</h1>
      <form id="challenge-form"><p>Unfortunately, bots use this service too. Please
      complete the following challenge to confirm this search was made by a human.
      Select all squares containing a duck.</p></form></body></html>`;
  assert.equal(readableContent(html).pageForms, 0);
  assert.doesNotMatch(text(html), /bots use this service/);
});

test("negative control: a WebForms form holding a sliver of the page is a control and goes whole", () => {
  const html = `<html><body>
      <div id="content"><p>The Planning Board meets on the first Wednesday of each
      month at 7:00 p.m. in the Town Office meeting room, and the public may speak
      on every item before the board votes.</p></div>
      <form id="aspnetForm"><input type="hidden" name="__VIEWSTATE" value="x" />
      <span>Subscribe</span></form></body></html>`;
  assert.equal(readableContent(html).pageForms, 0);
  const out = text(html);
  assert.match(out, /first Wednesday of each month/);
  assert.doesNotMatch(out, /Subscribe/);
});
