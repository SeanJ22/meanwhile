import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NationalLink } from "../components/shell/national-link.tsx";
import { NationalSection } from "../components/national/national-section.tsx";
import NationalPage from "../app/national/page.tsx";
import { completeNationalCards, NATIONAL_LINK_LABEL, NATIONAL_PATH, type NationalCard } from "../lib/national/section.ts";

const card = (id: string, complete: boolean): NationalCard => ({ id, office: "Cabinet", title: `Secretary ${id}`, holder: `Holder ${id}`, complete,
  sources: [{ what: "the department head", provenance: { sourceUrl: "https://www.whitehouse.gov/administration/cabinet/", sourceOrg: "whitehouse.gov", collectedAt: "2026-10-22", verifiedAt: null } }] });

test("the National section shows a card only when its data marks it complete", () => {
  assert.deepEqual(completeNationalCards([card("a", true), card("b", false), card("c", true)]).map(row => row.id), ["a", "c"]);
  assert.deepEqual(completeNationalCards([card("a", false)]), []);
});

test("the link reads 'National government, coming soon' and goes to the National section", () => {
  const html = renderToStaticMarkup(<NationalLink />);
  assert.match(html, new RegExp(`href="${NATIONAL_PATH}"`));
  assert.ok(html.includes(NATIONAL_LINK_LABEL));
  assert.equal(NATIONAL_LINK_LABEL, "National government, coming soon");
});

test("until a card is complete the National section says it is coming soon, with the sooner link, and lists no card", async () => {
  const html = renderToStaticMarkup(await NationalPage());
  assert.match(html, /National government/);
  assert.match(html, /data-national-gap/);
  assert.match(html, /Want us to get this sooner\?/);
  assert.doesNotMatch(html, /data-national-cards/);
});

test("only complete cards are rendered, each with its sources section", () => {
  const html = renderToStaticMarkup(<NationalSection cards={[card("a", true), card("b", false)]} />);
  assert.match(html, /Secretary a/);
  assert.doesNotMatch(html, /Secretary b/);
  assert.match(html, /data-national-cards/);
  assert.doesNotMatch(html, /data-national-gap/);
});

test("both doors to the National section are on the shell: under the Local, State and Federal filter and in Who governs here", () => {
  assert.match(readFileSync(new URL("../components/shell/sidebar.tsx", import.meta.url), "utf8"), /<ViewToggle \/>\s*<NationalLink \/>/);
  assert.match(readFileSync(new URL("../components/map/coverage-notice.tsx", import.meta.url), "utf8"), /<NationalLink className="national-link mt-3 block" \/>/);
});
