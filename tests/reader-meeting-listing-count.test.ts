import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { renderWithOpenSources } from "./helpers/render-card.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { UPCOMING_HORIZON_DAYS } from "../lib/meetings/constants.ts";
import { meetingListingIdentity } from "../lib/meetings/listing-identity.ts";
import { readerMeetingCount } from "../lib/meetings/reader-listing-count.ts";
import { groupByVenue } from "../lib/meetings/venues.ts";
import { renderedSignature, updateMarkerIcon } from "../lib/map/marker-pool.ts";
import { applyFilters } from "../lib/state/derive.ts";
import { INITIAL_STATE } from "../lib/state/defaults.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { ambiguousListingPairs, dateOnlyListings, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";

await installRegistryAuthority();

/** The recorded 85701 calendar, three of its sittings each listed a second time, and three date-only listings. */
const readSnapshot = () => recordedMeetingsSnapshot([...ambiguousListingPairs(3).meetings, ...dateOnlyListings(3)]);

test("all current ambiguous listing pairs survive scope filtering without becoming distinct-event counts", () => {
  const snapshot = readSnapshot(); assert.ok(snapshot);
  const identity = meetingListingIdentity(snapshot.meetings, canonicalBodyIdentity);
  assert.equal(identity.groups.length, 3);
  const ambiguousSourceIds = identity.groups.flatMap(group => group.sourceIds).sort();
  const ambiguousMeetings = snapshot.meetings.filter(row => ambiguousSourceIds.includes(row.id));
  assert.equal(INITIAL_STATE.filters.daysAhead, UPCOMING_HORIZON_DAYS);
  assert.deepEqual(
    applyFilters({ meetings: ambiguousMeetings, ui: INITIAL_STATE, center: null, now: Date.parse("2026-09-04T00:00:00.000Z") }).map(row => row.id).sort(),
    ambiguousMeetings.filter(row => Date.parse(row.startsAt) <= Date.parse("2026-09-04T00:00:00.000Z") + 90 * 86_400_000).map(row => row.id).sort(),
    "The reader's default filter must retain every eligible listing inside the canonical serving horizon",
  );
  for (const group of identity.groups) {
    const rows = snapshot.meetings.filter(row => group.sourceIds.includes(row.id));
    const count = readerMeetingCount(rows, identity);
    assert.equal(count.count, 2); assert.equal(count.unit, "calendar listings");
    assert.deepEqual(count.groups, [group]);
    const filtered = readerMeetingCount(rows.slice(0, 1), identity);
    assert.equal(filtered.count, 1); assert.equal(filtered.unit, "calendar listing");
    assert.deepEqual(filtered.groups, [group], "Filtering a sibling does not prove event uniqueness");
    const venues = groupByVenue(rows, identity); assert.equal(venues.length, 1);
    const attrs = new Map<string, string>();
    const element = { dataset: {}, querySelector: () => null, setAttribute: (name: string, value: string) => attrs.set(name, value) } as unknown as HTMLButtonElement;
    updateMarkerIcon(element, venues[0]);
    assert.match(attrs.get("aria-label")!, /2 calendar listings.*Distinct meeting count unresolved/);
    assert.notEqual(renderedSignature(venues[0]), renderedSignature({ ...venues[0], listingIdentity: undefined }));
  }
  const unrelated = snapshot.meetings.find(row => !identity.groups.some(group => group.sourceIds.includes(row.id))); assert.ok(unrelated);
  assert.equal(readerMeetingCount([unrelated], identity).unresolved, false);
  assert.equal(readerMeetingCount([], identity).groups.length, 0);
  const dayOnly = snapshot.meetings.filter(row => row.startPrecision === "DAY");
  assert.ok(dayOnly.length > 0); assert.equal(readerMeetingCount(dayOnly, identity).count, dayOnly.length);
  assert.deepEqual(readerMeetingCount(dayOnly, identity).groups, [], "Date-only listings remain eligible without an invented exact-time duplicate claim");
});

test("actual badge, stats, overlay and venue panel render every ambiguous listing source and honest units", async () => {
  const output = execFileSync(process.execPath, ["--import", "data:text/javascript,process.geteuid=()=>0", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { DataProvider } from './lib/state/data.tsx';
    import { UiProvider } from './lib/state/provider.tsx';
    import { CountBadge } from './components/map/count-badge.tsx';
    import { StatsBar } from './components/shell/stats-bar.tsx';
    import { canonicalBodyIdentity } from './lib/ask/body-identity.ts';
    import { installRegistryAuthority } from './tests/helpers/promoted-fixtures.ts';
    import { ambiguousListingPairs, dateOnlyListings, recordedMeetingsSnapshot } from './tests/helpers/reader-fixtures.ts';
    import { meetingListingIdentity } from './lib/meetings/listing-identity.ts';
    import { groupByVenue } from './lib/meetings/venues.ts';
    await installRegistryAuthority();
    const snapshot=recordedMeetingsSnapshot([...ambiguousListingPairs(3).meetings, ...dateOnlyListings(3)]), identity=meetingListingIdentity(snapshot.meetings,canonicalBodyIdentity), results=[];
    for(const group of identity.groups){
      const meetings=snapshot.meetings.filter(row=>group.sourceIds.includes(row.id)),venues=groupByVenue(meetings,identity);
      const data={allMeetings:meetings,meetings,venues,result:{meetings,listingIdentity:identity,coverage:null,tier:'exact',radiusKm:25,center:{lat:43.3,lng:-72}},location:null,drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:'ZIP'};
      const render=child=>renderToStaticMarkup(h(DataProvider,{value:data},h(UiProvider,{initial:{listOverlayOpen:true,listGroupBy:'none'}},child)));
      const browserData={...data};
      const badge=render(h(CountBadge)),stats=render(h(StatsBar));
      data.listingIdentity=identity;data.result=null;
      const carriedBadge=render(h(CountBadge));
      data.searchFailed=true;
      const failedBadge=render(h(CountBadge));
      results.push({group,badge,stats,carriedBadge,failedBadge,data:browserData});
    }
    console.log(JSON.stringify({results}));
  `], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const proof = JSON.parse(output.trim()) as { results: { group: { reason: string; sourceIds: string[]; sources: { id: string; sourceUrl: string }[] }; data: object; badge: string; stats: string; overlay: string; panel: string; carriedBadge:string; carriedOverlay:string; failedBadge:string; failedOverlay:string }[] };
  const { results } = proof;
  const rendered = await renderWithOpenSources(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { DataProvider } from './lib/state/data.tsx';
    import { UiProvider } from './lib/state/provider.tsx';
    import { ListOverlay } from './components/map/list-overlay.tsx';
    import { MeetingPanel } from './components/map/meeting-panel.tsx';
    import { Card } from './components/ui/card.tsx';
    import { MeetingListingNotice } from './components/map/meeting-listing-notice.tsx';
    const results=${JSON.stringify(results)};
    const card=(sources,child)=><Card title="Calendar listings" sources={sources}>{child}</Card>;
    const sources=group=>group.sources.map(source=>({what:'Unresolved calendar listing',provenance:source}));
    createRoot(document.getElementById('root')).render(<>
      {results.flatMap(({group,data})=>[
        [data,<ListOverlay />],
        [data,<MeetingPanel venue={data.venues[0]} onClose={()=>{}} onOpenMeeting={()=>{}} />],
        [{...data,listingIdentity:data.result.listingIdentity,result:null},<ListOverlay />],
        [{...data,listingIdentity:data.result.listingIdentity,result:null,searchFailed:true},<ListOverlay />],
      ].map(([value,child],index)=><div className="proof-surface" key={group.sourceIds.join('|')+index}>
        <DataProvider value={value}><UiProvider initial={{listOverlayOpen:true,listGroupBy:'none'}}>
          {card(sources(group),child)}
        </UiProvider></DataProvider>
      </div>))}
      <div className="proof-surface">{card(results.flatMap(({group})=>sources(group)),
        <MeetingListingNotice groups={results.map(({group})=>group)} />)}</div>
    </>);
  `, results.flatMap(({ group }) => group.sources.map(source => source.sourceUrl)), ".proof-surface");
  const combinedNotice = rendered.at(-1)!;
  for (const [index, result] of results.entries()) {
    [result.overlay, result.panel, result.carriedOverlay, result.failedOverlay] = rendered.slice(index * 4, index * 4 + 4);
  }
  // A URL as rendered markup carries it: an ampersand is escaped.
  const attribute = (url: string) => url.replaceAll("&", "&amp;");
  assert.equal(results.length, 3);
  assert.equal((combinedNotice.match(/data-card-sources=/g) ?? []).length, 1);
  const sharedReason = results[0].group.reason;
  assert.ok(results.every((result) => result.group.reason === sharedReason));
  assert.equal(combinedNotice.split(sharedReason).length - 1, 1, "The shared explanation renders once per notice, not once per pair");
  for (const [index, result] of results.entries()) {
    assert.ok(combinedNotice.includes(`Unresolved listing group ${index + 1}:`));
    assert.ok(combinedNotice.includes(`data-meeting-listing-group="${result.group.sourceIds.join("|")}"`));
    for (const source of result.group.sources) {
      assert.ok(combinedNotice.includes(source.id));
      assert.ok(combinedNotice.includes(attribute(source.sourceUrl)));
    }
  }
  for (const result of results) {
    assert.match(result.badge, /2<\/span> calendar listings/);
    assert.match(result.badge, /Distinct meeting count unresolved/);
    assert.match(result.stats, /Calendar listings/); assert.match(result.stats, /Distinct meeting count unresolved/);
    assert.match(result.stats, /data-stat="meetings"/, "Canonical counter identity survives its more precise visible label");
    assert.match(result.carriedBadge, /calendar listings/);
    assert.match(result.failedBadge, /couldn&#x27;t check/);
    assert.match(result.overlay, /2 calendar listings/); assert.match(result.panel, /2 calendar listings/);
    for (const markup of [result.overlay, result.panel, result.carriedOverlay, result.failedOverlay]) {
      assert.ok(markup.includes(result.group.reason));
      for (const source of result.group.sources) { assert.ok(markup.includes(attribute(source.sourceUrl))); assert.ok(markup.includes(source.id)); }
    }
  }
});
