/**
 * The country screen: states at the country, congressional districts at a state, ZIPs at a district, each row with hunts,
 * ZIPs worked of total, place score and stuck; a figure we lack is a dash; no explanation text.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import { SECTION_IDS } from "../../app/(admin)/_mw/admin-v6/contract.ts";
import type { Access } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle, placesFromNational, referenceNational, rememberPlaces } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import type { StateRow } from "../../app/(admin)/_mw/admin-v6/model.ts";
import { breadcrumbs, indexPlaces, nationalDepth, scopeOfPlaceKey } from "../../app/(admin)/_mw/admin-v6/places.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { parseScope } from "../../app/(admin)/_mw/scope.ts";

const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const AT = "2026-10-01T18:00:00.000Z";
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;
const live = (data: readonly StateRow[]): SectionState => ({ phase: "live", data, asOf: AT, revision: "n1", missingParts: [], attempts: 0 });

const row = (over: Partial<StateRow> & Pick<StateRow, "placeKey" | "name" | "code">): StateRow => ({ hunts: null, stuck: null, checklistItems: null, tracked: false, kind: "State", parentKey: "us", zipsWorked: null, zipsTotal: null, score: null, ...over });
const STATES = [
  row({ placeKey: "st:az", name: "Arizona", code: "AZ", tracked: true, hunts: 2, zipsWorked: 1, zipsTotal: 420, score: 12.3, stuck: 4 }),
  row({ placeKey: "st:nj", name: "New Jersey", code: "NJ", tracked: true, hunts: 0, zipsWorked: 0, zipsTotal: 600, score: null, stuck: 0 }),
];
const DISTRICTS = [
  row({ placeKey: "geo:az.congressional_district.0405", name: "AZ-05", code: "AZ-05", kind: "District", parentKey: "st:az", hunts: 0, zipsWorked: 0, zipsTotal: 22, score: null, stuck: 0 }),
  row({ placeKey: "geo:az.congressional_district.0406", name: "AZ-06", code: "AZ-06", kind: "District", parentKey: "st:az", hunts: 3, zipsWorked: 1, zipsTotal: 79, score: 41.6, stuck: 2 }),
];
const ZIPS = [
  row({ placeKey: "geo:az.zcta.85635", name: "ZIP 85635", code: "85635", kind: "ZIP", parentKey: "geo:az.congressional_district.0406", hunts: 1, zipsWorked: 1, zipsTotal: 1, score: 7.4, stuck: 1 }),
  row({ placeKey: "geo:az.zcta.85122", name: "ZIP 85122", code: "85122", kind: "ZIP", parentKey: "geo:az.congressional_district.0406", hunts: 0, zipsWorked: 0, zipsTotal: 1, score: null, stuck: 0 }),
];

function page(scopeKey: string, national: SectionState) {
  const ref = liveReference({ scope: scopeOfPlaceKey(scopeKey)!, observedAt: AT });
  return renderToStaticMarkup(h(CommandCenter, {
    data: buildLiveBundle({ ...waiting, national }, ref, workerStatusFromPulse(null)),
    mode: "live", executor: liveExecutor({ capabilities: () => null }), scopeKey, onScopeChange: () => {},
    connection: "live", lastGoodAt: AT, recovered: false, access: owner,
  }));
}
const card = (html: string) => {
  const start = html.indexOf('id="v6-national"');
  assert.ok(start >= 0, "The country card is on the page");
  return html.slice(start, html.indexOf("</section>", start));
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("at the country, the states carry the five columns, a figure we lack is a dash, and each row opens its state", () => {
  const html = card(page("us", live(STATES)));
  const t = text(html);
  for (const head of ["Place", "Hunts", "ZIPs worked / total", "Completeness", "Stuck"]) assert.ok(t.includes(head), head);
  assert.match(t, /Arizona 2 1 \/ 420 12\.3% 4/);
  assert.match(t, /New Jersey 0 0 \/ 600 — 0/, "a state with no score yet shows a dash, not 0%");
  assert.match(html, /<button[^>]*>Arizona<\/button>/, "the state name is a button that opens it");
  assert.match(html, /Map of states and territories/, "the tile map stays at the country");
});

test("with nothing read, every state is listed with every figure a dash and nothing is said about a missing connection", () => {
  const html = card(page("us", waiting.national));
  const t = text(html);
  assert.doesNotMatch(t, /Not connected|DEP-NATIONAL|waiting for/i);
  const rows = referenceNational(liveReference({ scope: { kind: "all" }, observedAt: AT }));
  assert.ok(rows.every((r) => r.hunts === null && r.zipsWorked === null && r.zipsTotal === null && r.score === null && r.stuck === null));
});

test("at a state, its congressional districts are listed as AZ-06 with ZIPs worked of total, the score and stuck, and no other state", () => {
  const html = card(page("st:az", live(DISTRICTS)));
  const t = text(html);
  assert.match(t, /AZ-06 3 1 \/ 79 41\.6% 2/);
  assert.match(t, /AZ-05 0 0 \/ 22 — 0/);
  assert.doesNotMatch(t, /New Jersey|Alabama/, "the state list is not shown under a state");
  assert.doesNotMatch(html, /Map of states and territories/);
  assert.match(html, /<button[^>]*>AZ-06<\/button>/);
  assert.match(t, /2 districts/);
});

test("while a state's districts are still loading, the state list is not shown under it", () => {
  const html = card(page("st:az", { ...waiting.national, phase: "loading" }));
  assert.doesNotMatch(text(html), /Alabama|New Jersey|Arizona\b.*Hunts/);
});

test("at a district its ZIPs are listed with the same columns", () => {
  const html = card(page("geo:az.congressional_district.0406", live(ZIPS)));
  const t = text(html);
  assert.match(t, /ZIP 85635 1 1 \/ 1 7\.4% 1/);
  assert.match(t, /ZIP 85122 0 0 \/ 1 — 0/);
  assert.match(t, /2 ZIPs/);
});

test("no list at a scope that has none, and no explanation words anywhere in the card", () => {
  const onZip = page("geo:az.zcta.85635", live(ZIPS));
  assert.ok(!onZip.includes('id="v6-national"'), "a ZIP has no country card");
  const t = text(card(page("st:az", live(DISTRICTS))));
  assert.doesNotMatch(t, /couldn't|not connected|waiting|reference|sample|because|until/i);
});

test("the districts and ZIPs listed become places, so opening one keeps its breadcrumbs through its district and state", () => {
  assert.equal(nationalDepth("us"), "states");
  assert.equal(nationalDepth("st:az"), "districts");
  assert.equal(nationalDepth("geo:az.congressional_district.0406"), "zips");
  assert.equal(nationalDepth("geo:az.zcta.85635"), null);
  assert.equal(nationalDepth("geo:az.congressional_district.06"), null);
  const ref = liveReference({ scope: { kind: "all" }, observedAt: AT });
  const seen = [...placesFromNational(DISTRICTS), ...placesFromNational(ZIPS), ...placesFromNational(STATES)];
  assert.equal(seen.length, 4, "states are already listed from the reference");
  const bundle = buildLiveBundle(waiting, ref, workerStatusFromPulse(null), seen);
  const index = indexPlaces(bundle.places.data ?? []);
  assert.deepEqual(breadcrumbs(index, "geo:az.zcta.85635").map((p) => p.name), ["United States", "Arizona", "AZ-06", "ZIP 85635"]);
  assert.equal(index.get("geo:az.congressional_district.0406")?.kind, "Area");
  assert.deepEqual(index.get("geo:az.zcta.85635")?.within, ["geo:az.congressional_district.0406", "st:az"]);
});

test("places listed once are remembered after the list moves on, and a render that adds none changes nothing", () => {
  const first = rememberPlaces([], DISTRICTS);
  assert.deepEqual(first.map((p) => p.name), ["AZ-05", "AZ-06"]);
  assert.equal(rememberPlaces(first, DISTRICTS), first, "nothing new is the same list");
  assert.equal(rememberPlaces(first, null), first, "a list that was reset to nothing forgets nothing");
  assert.deepEqual(rememberPlaces(first, ZIPS).map((p) => p.name), ["AZ-05", "AZ-06", "ZIP 85635", "ZIP 85122"]);
  assert.deepEqual(rememberPlaces(first, STATES), first, "states are already known");
});

test("a district opened from its address is the place AZ-06, not a county", () => {
  const ref = liveReference({ scope: parseScope("az.cd.0406"), observedAt: AT });
  assert.deepEqual(ref.geo, { key: "geo:az.congressional_district.0406", name: "AZ-06", kind: "Area", state: "az" });
  const index = indexPlaces(buildLiveBundle(waiting, ref, workerStatusFromPulse(null)).places.data ?? []);
  assert.deepEqual(breadcrumbs(index, "geo:az.congressional_district.0406").map((p) => p.name), ["United States", "Arizona", "AZ-06"]);
});
