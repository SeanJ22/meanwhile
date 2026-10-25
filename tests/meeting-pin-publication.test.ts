import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  placePublishedMeetingPins,
  publishedPinOffices,
  absolutePublisherMeetingUrl,
  normalizeFamilyMeetingCitations,
} from "../lib/meetings/publish-pins.ts";
import { publishedOnlineAccess } from "../lib/meetings/published-online.ts";
import { censusAddressQuery, repeatsPublishedVenue } from "../lib/geo/address-query.ts";
import { verifiedCensusVenuePoint } from "../lib/geo/census-address-match.ts";
import { publishedMeetingPins } from "../lib/meetings/pin-location.ts";
import { normalizeWithDrops } from "../lib/sources/legistar/index.ts";
import type { LegistarClient } from "../lib/sources/legistar/client-registry.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { MeetingPinBody } from "../lib/meetings/pin-location.ts";
import { factDb } from "./helpers/fact-db.ts";
import { createHash } from "node:crypto";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import {
  readSittingFacts,
  withSittingFacts,
} from "../lib/facts/meeting-read.ts";
import { mergeReaderSittings } from "../lib/meetings/sitting-merge.ts";

const NOW = "2026-10-24T00:00:00.000Z",
  DIVISION = "ocd-division/country:us/state:az/place:tucson",
  BODY = `${DIVISION}#governing`;
const SOURCE = {
  sourceUrl: "https://example.gov/calendar",
  sourceOrg: "City",
  collectedAt: NOW,
  verifiedAt: NOW,
};
const OWN = "1415 W Melody Ln, Bisbee, AZ 85603",
  BOARD = "5 Main Street, Concord, NH 03301",
  GOVERNMENT = "55 West Joppa Road, Warner, NH 03278";
const geo = (
  house: string,
  street: string,
  city: string,
  state: string,
  zip: string,
  suffix = "ST",
  direction?: string,
) => ({
  result: {
    addressMatches: [
      {
        matchedAddress: `${house} ${direction ? direction + " " : ""}${street} ${suffix}, ${city}, ${state}, ${zip}`,
        coordinates: { x: -109.92566533383, y: 31.393935355772 },
        addressComponents: {
          city,
          state,
          zip,
          streetName: street,
          preDirection: direction,
          suffixType: suffix,
        },
      },
    ],
  },
});
const OWN_GEO = geo("1415", "MELODY", "BISBEE", "AZ", "85603", "LN", "W");
const BOARD_GEO = geo("5", "MAIN", "CONCORD", "NH", "03301"),
  GOVERNMENT_GEO = geo("55", "JOPPA", "WARNER", "NH", "03278", "RD", "W");
const missing = { result: { addressMatches: [] } };
const meeting = (published: string | null = OWN): Meeting => ({
  id: "legistar:no-hand-list:42",
  bodyId: BODY,
  bodyName: "Council",
  ocdId: DIVISION,
  title: "Regular meeting",
  startsAt: NOW,
  timeZone: "America/Phoenix",
  location: null,
  venueGap: {
    kind: published ? "STATED_NOT_PLACED" : "NOT_STATED_BY_PUBLISHER",
    publishedText: published,
    publisher: "City",
  },
  agendaUrl: null,
  jurisdiction: "City",
  status: "SCHEDULED",
  provenance: SOURCE,
});
const offices = new Map([
  [
    BODY,
    {
      bodyId: BODY,
      name: "Council",
      officeContact: { address: BOARD, phone: null, provenance: SOURCE },
      governmentOffice: {
        name: "Government",
        address: GOVERNMENT,
        provenance: SOURCE,
      },
    } as MeetingPinBody,
  ],
]);
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("a Legistar body with no hand-built venue publishes its exact EventLocation through Census", async () => {
  const client = {
    slug: "no-hand-list",
    eventBodyId: 7,
    ocdId: DIVISION,
    bodyId: BODY,
    jurisdiction: "City",
    publishingOrg: "City",
    timeZone: "America/Phoenix",
  } as LegistarClient;
  const raw = {
    EventId: 42,
    EventBodyId: 7,
    EventBodyName: "Council",
    EventDate: "2026-10-24T00:00:00",
    EventTime: "10:00 AM",
    EventLocation: OWN,
    EventAgendaFile: null,
    EventComment: null,
    EventAgendaStatusName: null,
    EventMinutesStatusName: null,
    EventMinutesFile: null,
    EventInSiteURL: null,
    EventVideoPath: null,
    EventLastModifiedUtc: null,
  };
  const normalized = normalizeWithDrops(
    [{ event: raw, slug: client.slug, collectedAt: NOW, items: null }],
    new Date(NOW),
    [client],
  ).meetings;
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].location, null);
  assert.equal(normalized[0].venueGap?.publishedText, OWN);
  let calls = 0;
  const placed = await placePublishedMeetingPins({
    meetings: normalized,
    clock: () => NOW,
    offices: new Map(),
    fetchImpl: async (request) => {
      calls++;
      assert.equal(new URL(String(request)).searchParams.get("address"), OWN);
      return response(OWN_GEO);
    },
  });
  assert.equal(calls, 1);
  assert.equal(placed.meetings[0].mapPin?.basis, "MEETING");
  assert.equal(placed.meetings[0].location?.address, OWN);
  assert.equal(placed.responses.length, 1);
  assert.equal(placed.meetings[0].id, normalized[0].id);
  assert.equal(raw.EventLocation, OWN);
  const saved = JSON.parse(JSON.stringify(placed.meetings)) as Meeting[];
  const next = await placePublishedMeetingPins({
    meetings: normalized,
    previous: saved,
    offices: new Map(),
    fetchImpl: async () => {
      throw new Error("unchanged published address was geocoded twice");
    },
  });
  assert.equal(next.responses.length, 0);
  assert.deepEqual(next.meetings[0].location, placed.meetings[0].location);
  assert.equal(publishedMeetingPins(next.meetings)[0].address, OWN);
});

test("publication tries source text, board office, then government office and saves the selected basis", async () => {
  const requests: string[] = [];
  const result = await placePublishedMeetingPins({
    meetings: [meeting("Room 301")],
    offices,
    clock: () => NOW,
    fetchImpl: async (request) => {
      const address = new URL(String(request)).searchParams.get("address")!;
      requests.push(address);
      return response(address === GOVERNMENT ? GOVERNMENT_GEO : missing);
    },
  });
  assert.deepEqual(requests, [BOARD, GOVERNMENT]);
  assert.equal(result.meetings[0].mapPin?.basis, "GOVERNMENT_OFFICE");
  assert.equal(result.meetings[0].location, null);
  const next = await placePublishedMeetingPins({
    meetings: [meeting("Room 301")],
    previous: JSON.parse(JSON.stringify(result.meetings)),
    offices,
    fetchImpl: async () => {
      throw new Error(
        "the next scheduled publication must reuse its saved point",
      );
    },
  });
  assert.deepEqual(next.meetings[0].mapPin, result.meetings[0].mapPin);
  assert.equal(next.responses.length, 0);
});

test("a changed source address gets its own point before either office; online-only stays online", async () => {
  const online = {
    ...meeting(null),
    venueGap: undefined,
    online: { label: "Online only", joinUrl: "https://example.gov/join" },
  };
  const fallback = await placePublishedMeetingPins({
    meetings: [online],
    offices,
    fetchImpl: async () => response(BOARD_GEO),
  });
  assert.equal(fallback.meetings[0].mapPin?.basis, "BODY_OFFICE");
  assert.equal(fallback.meetings[0].location, null);
  assert.equal(fallback.meetings[0].online?.joinUrl, online.online.joinUrl);
  const changed = await placePublishedMeetingPins({
    meetings: [meeting()],
    previous: fallback.meetings,
    offices,
    fetchImpl: async () => response(OWN_GEO),
  });
  assert.equal(changed.meetings[0].mapPin?.basis, "MEETING");
});

test("one publication shares a Census read across identical addresses, and a failed match never drops a meeting", async () => {
  let calls = 0;
  const rows = Array.from({ length: 45 }, (_, i) => ({
    ...meeting(),
    id: `legistar:unlisted:${i}`,
  }));
  const result = await placePublishedMeetingPins({
    meetings: rows,
    offices: new Map(),
    fetchImpl: async () => {
      calls++;
      return response(OWN_GEO);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.placedCount, 45);
  assert.deepEqual(
    result.meetings.map((m) => m.id),
    rows.map((m) => m.id),
  );
  const unplaced = await placePublishedMeetingPins({
    meetings: rows,
    offices: new Map(),
    fetchImpl: async () => response(missing),
  });
  assert.equal(unplaced.meetings.length, 45);
  assert.equal(unplaced.placedCount, 0);
});

test("a five-digit house number is not mistaken for a ZIP, and wrong or ambiguous Census matches are refused", () => {
  const vail = geo("13801", "BENSON", "VAIL", "AZ", "85641", "HWY", "E");
  assert.ok(
    verifiedCensusVenuePoint("13801 E Benson Highway, Vail, AZ 85641", vail),
  );
  assert.ok(
    verifiedCensusVenuePoint(
      "Leadership Center at 13801 E Benson Highway, Vail, AZ",
      vail,
    ),
  );
  assert.equal(
    verifiedCensusVenuePoint(OWN.replace("Bisbee", "Tucson"), OWN_GEO),
    null,
  );
  assert.equal(
    verifiedCensusVenuePoint(OWN.replace("85603", "85604"), OWN_GEO),
    null,
  );
  assert.equal(
    verifiedCensusVenuePoint(OWN, {
      result: {
        addressMatches: [
          ...OWN_GEO.result.addressMatches,
          ...OWN_GEO.result.addressMatches,
        ],
      },
    }),
    null,
  );
});

test("relative citations resolve against the exact publisher route", () => {
  const route = "https://example.gov/calendar?kind=meetings";
  assert.equal(
    absolutePublisherMeetingUrl("/event/42", route),
    "https://example.gov/event/42",
  );
  assert.equal(absolutePublisherMeetingUrl("javascript:bad", route), route);
  assert.equal(
    normalizeFamilyMeetingCitations(
      [{ ...meeting(), provenance: { ...SOURCE, sourceUrl: "/event/42" } }],
      new Map([[`legistar:${BODY}`, route]]),
    )[0].provenance.sourceUrl,
    "https://example.gov/event/42",
  );
});

test("publication reads only the exact body's and owning government's live addresses", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(
      "CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,payload jsonb)",
    );
    await db.query(
      `INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:special:own','government','Own Government','AZ',NULL),
      ($1,'body','Own Board','AZ','az:special:own'),('body:neighbour','body','Neighbour','AZ',NULL)`,
      [BODY],
    );
    await db.query(
      `INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/office','https://example.gov/office',$1,$2,'office')`,
      [NOW, "a".repeat(64)],
    );
    await db.query(
      `INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'office_address',$2,$3,'live','OFFICIAL',1,$3,$4,'fixture')`,
      [BODY, JSON.stringify(BOARD), BOARD, NOW],
    );
    await db.query(
      `INSERT INTO civic_data_promotions VALUES('REGISTRATION:US-AZ:registration:v1','REGISTRATION',$1)`,
      [
        JSON.stringify({
          governments: [
            {
              id: "government:US-AZ:cog:own",
              jurisdictionId: "az:special:own",
              state: "AZ",
              name: "Own Government",
              officeAddress: GOVERNMENT,
              provenance: SOURCE,
              aliases: [],
              bodyIds: [],
            },
          ],
        }),
      ],
    );
    const found = await publishedPinOffices(db.query, [BODY, "body:neighbour"]);
    assert.equal(found.get(BODY)?.officeContact?.address, BOARD);
    assert.equal(found.get(BODY)?.governmentOffice?.address, GOVERNMENT);
    assert.equal(found.get("body:neighbour")?.governmentOffice, undefined);
  } finally {
    await db.pg.close();
  }
});

test("saved Census points and online-only office pins survive fact-store publication and a fresh reader", async () => {
  for (const online of [false, true]) {
    const db = await factDb();
    try {
      await db.query(
        "INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Tucson','AZ')",
        [DIVISION],
      );
      const original = online
        ? {
            ...meeting(null),
            venueGap: undefined,
            online: {
              label: "Online only",
              joinUrl: "https://example.gov/join",
            },
          }
        : meeting();
      const placed = await placePublishedMeetingPins({
        meetings: [original],
        offices: online ? offices : new Map(),
        clock: () => NOW,
        fetchImpl: async () => response(online ? BOARD_GEO : OWN_GEO),
      });
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          title: original.title,
          startsAt: original.startsAt,
          EventLocation: online ? original.online!.label : OWN,
          online: original.online,
        }),
      );
      const source = {
        source: "legistar",
        requestedUrl: SOURCE.sourceUrl,
        finalUrl: SOURCE.sourceUrl,
        httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length,
        bytes,
        retrievedAt: NOW,
        contentType: "application/json",
      };
      const report = await publishReadMeetingFacts({
        facts: db,
        vault: new MemoryEvidenceStore(),
        meetings: placed.meetings,
        responses: [source, ...placed.responses],
        producedBy: "meeting-publication-fixture",
        clocks: factClocks(null),
        now: new Date(NOW),
      });
      assert.equal(report.held, 0);
      assert.equal(report.blanks, 0);
      const facts = (await readSittingFacts(db.query, [BODY])).get(BODY)!;
      const [read] = withSittingFacts(
        [
          {
            ...meeting(),
            location: null,
            venueGap: undefined,
            online: undefined,
          },
        ],
        facts,
      );
      assert.equal(read.mapPin?.basis, online ? "BODY_OFFICE" : "MEETING");
      assert.match(
        read.fieldSources!.mapPin.sourceUrl!,
        /^https:\/\/geocoding.geo.census.gov\//,
      );
      assert.equal(read.id, original.id);
      if (online) {
        assert.equal(read.location, null);
        assert.equal(read.online?.joinUrl, original.online!.joinUrl);
      } else {
        assert.equal(read.location?.address, OWN);
        assert.equal(
          read.location?.lat,
          OWN_GEO.result.addressMatches[0].coordinates.y,
        );
      }
      const pins = publishedMeetingPins([read]);
      assert.equal(pins.length, 1);
      const copies = await db.query("SELECT count(*) AS n FROM source_copy");
      assert.equal(Number(copies[0].n), 2);
    } finally {
      await db.pg.close();
    }
  }
});

test("a newer published room and its pin stay together when source aliases merge", async () => {
  const placed = await placePublishedMeetingPins({
    meetings: [meeting()],
    offices: new Map(),
    clock: () => NOW,
    fetchImpl: async () => response(OWN_GEO),
  });
  const updated = {
    ...meeting("Different room"),
    id: "ical:other-door:42",
    provenance: {
      ...SOURCE,
      collectedAt: "2026-10-24T00:01:00Z",
      verifiedAt: "2026-10-24T00:01:00Z",
    },
  };
  const merged = mergeReaderSittings([placed.meetings[0], updated]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].mapPin, undefined);
  assert.equal(merged.rows[0].location, null);
  assert.equal(merged.rows[0].venueGap?.publishedText, "Different room");
  assert.deepEqual(
    new Set(merged.rows[0].mergedMeetingIds),
    new Set([meeting().id, updated.id]),
  );
});

test("a temporary office lookup failure retains an unchanged sitting's saved point", async () => {
  const placed = await placePublishedMeetingPins({
    meetings: [meeting(null)],
    offices,
    fetchImpl: async () => response(BOARD_GEO),
  });
  const next = await placePublishedMeetingPins({
    meetings: [meeting(null)],
    previous: placed.meetings,
    query: async () => {
      throw new Error("temporary read failure");
    },
    fetchImpl: async () => {
      throw new Error("saved point must be reused");
    },
  });
  assert.deepEqual(next.meetings[0].mapPin, placed.meetings[0].mapPin);
  assert.equal(next.held.length, 1);
});

test("a newer venue fact cannot inherit a stale saved pin or an older online-only fact", async () => {
  const placed = await placePublishedMeetingPins({
    meetings: [meeting()],
    offices: new Map(),
    fetchImpl: async () => response(OWN_GEO),
  });
  const source = { ...SOURCE, collectedAt: "2026-10-24T00:02:00Z" };
  const facts = [
    {
      meetingId: meeting().id,
      field: "location" as const,
      value: { name: "New room", address: null },
      source,
    },
    {
      meetingId: meeting().id,
      field: "mapPin" as const,
      value: placed.meetings[0].mapPin,
      source: SOURCE,
    },
    {
      meetingId: meeting().id,
      field: "online" as const,
      value: { label: "Online only", joinUrl: null },
      source: SOURCE,
    },
  ];
  const [read] = withSittingFacts(placed.meetings, facts);
  assert.equal(read.mapPin, undefined);
  assert.equal(read.online, undefined);
  assert.equal(read.venueGap?.publishedText, "New room");
});

test("Census receives a street address without source headings, room numbers or online instructions", () => {
  for (const text of [
    "Council Chambers 1415 W Melody Ln, Bisbee, AZ 85603",
    "In-Person: 1415 W Melody Ln, Room 150, Bisbee, AZ 85603 Virtual (Online): https://example.gov/join",
    "Headquarters\r\n1415 W Melody Ln\r\nBisbee, AZ 85603\r\nJoin Zoom Meeting: https://example.gov/join",
    "<p>Headquarters</p><p>1415 W Melody Ln</p><p>Bisbee, AZ 85603</p>",
  ])
    assert.equal(censusAddressQuery(text), OWN);
});

test("online-only source text retains a published join link while hybrid street addresses stay physical", () => {
  const text =
    "Microsoft Teams Virtual meeting\nJoin: https://teams.microsoft.com/meet/42?p=published";
  assert.deepEqual(publishedOnlineAccess(text), {
    label: text,
    joinUrl: "https://teams.microsoft.com/meet/42?p=published",
  });
  assert.equal(
    publishedOnlineAccess(
      "Hybrid meeting at 1415 W Melody Ln, Bisbee, AZ 85603 or by Zoom",
    ),
    null,
  );
});

test("a room number before a street address is excluded from the Census query", () => {
  assert.equal(
    censusAddressQuery(
      "Community Room #1004 - 1300 West Broward Boulevard, Fort Lauderdale, FL 33312",
    ),
    "1300 West Broward Boulevard, Fort Lauderdale, FL 33312",
  );
});

test("an unambiguous published street and city can match without a stated state, while an explicit conflicting state is refused", () => {
  assert.ok(verifiedCensusVenuePoint("1415 W Melody Ln, Bisbee", OWN_GEO));
  assert.equal(
    verifiedCensusVenuePoint("1415 W Melody Ln, Bisbee, CA 85603", OWN_GEO),
    null,
  );
});


test("a changed published room keeps its saved office point when earlier live facts are composed",async()=>{
  const before=await placePublishedMeetingPins({meetings:[meeting("Room 101")],offices,clock:()=>NOW,fetchImpl:async()=>response(BOARD_GEO)});
  const newer={...meeting("Room 202"),provenance:{...SOURCE,collectedAt:"2026-10-24T01:00:00Z"}};
  const after=await placePublishedMeetingPins({meetings:[newer],previous:before.meetings,offices,fetchImpl:async()=>response(missing)});
  const [read]=withSittingFacts(after.meetings,[
    {meetingId:meeting().id,field:"location",value:{name:"Room 101",address:null},source:SOURCE},
    {meetingId:meeting().id,field:"mapPin",value:before.meetings[0].mapPin,source:SOURCE},
  ]);
  assert.equal(read.venueGap?.publishedText,"Room 202");
  assert.equal(read.mapPin?.basis,"BODY_OFFICE");
  assert.equal(read.mapPin?.publishedLocation,"Room 202");
  assert.equal(read.mapPin?.coordinateCheckedAt,before.meetings[0].mapPin?.coordinateCheckedAt);
});

test("older live location and coordinate facts cannot replace a newer published meeting address",async()=>{
  const before=await placePublishedMeetingPins({meetings:[meeting()],offices:new Map(),clock:()=>NOW,fetchImpl:async()=>response(OWN_GEO)});
  const newer={...meeting(BOARD),provenance:{...SOURCE,collectedAt:"2026-10-24T01:00:00Z"}};
  const after=await placePublishedMeetingPins({meetings:[newer],offices:new Map(),clock:()=>"2026-10-24T01:00:01Z",fetchImpl:async()=>response(BOARD_GEO)});
  const [read]=withSittingFacts(after.meetings,[
    {meetingId:meeting().id,field:"location",value:before.meetings[0].location,source:SOURCE},
    {meetingId:meeting().id,field:"mapPin",value:before.meetings[0].mapPin,source:SOURCE},
  ]);
  assert.equal(read.location?.address,BOARD);assert.equal(read.mapPin?.address,BOARD);
});

test("a shortened published street repeats its prior point, but a conflicting stated city, street or ZIP does not",()=>{
  const prior="1 E. Broadway Boulevard, Suite 401, Tucson, AZ 85701";
  assert.ok(repeatsPublishedVenue("1 E. Broadway, 4th Floor","PAG Office",prior));
  for(const changed of ["1 E. Broadway Boulevard, Phoenix, AZ 85701","1 E. Congress Street, Tucson, AZ 85701",
    "1 E. Broadway Boulevard, Tucson, AZ 85702"])
    assert.equal(repeatsPublishedVenue(changed,"PAG Office",prior),false,changed);
});

test("the following publication reuses the building point but shows the publisher's current room, including over older facts",async()=>{
  const oldText=OWN.replace(", Bisbee",", Room 101, Bisbee"),newText=OWN.replace(", Bisbee",", Room 202, Bisbee");
  const first=await placePublishedMeetingPins({meetings:[meeting(oldText)],offices:new Map(),clock:()=>NOW,fetchImpl:async()=>response(OWN_GEO)});
  const newer={...meeting(newText),provenance:{...SOURCE,collectedAt:"2026-10-24T01:00:00Z"}};
  for(const legacy of [false,true]) {
    const previous=first.meetings.map(row=>legacy?{...row,mapPin:undefined}:row);
    const after=await placePublishedMeetingPins({meetings:[newer],previous,offices:new Map(),
      fetchImpl:async()=>{throw new Error("the verified building point must be reused");}});
    const [read]=withSittingFacts(after.meetings,[
      {meetingId:newer.id,field:"location",value:first.meetings[0].location,source:SOURCE},
      {meetingId:newer.id,field:"online",value:{label:"Virtual",joinUrl:null},source:SOURCE},
    ]);
    assert.equal(read.location?.name,newText);assert.equal(read.location?.address,newText);
    assert.equal(read.location?.lat,first.meetings[0].location?.lat);assert.equal(read.online,undefined);
    assert.equal(after.responses.length,0);assert.deepEqual(after.held,[]);
    assert.deepEqual(after.meetings[0].fieldSources?.location,first.meetings[0].fieldSources?.location ?? first.meetings[0].provenance);
    assert.equal(after.meetings[0].fieldSources?.venueGap?.collectedAt,newer.provenance.collectedAt);
    if(!legacy){assert.equal(read.mapPin?.publishedLocation,newText);assert.equal(read.mapPin?.coordinateCheckedAt,NOW);}
  }
  const [fromFact]=withSittingFacts([newer],[{meetingId:newer.id,field:"location",value:first.meetings[0].location,source:SOURCE}]);
  assert.equal(fromFact.location?.name,newText);assert.equal(fromFact.location?.address,newText);
  assert.equal(fromFact.location?.lat,first.meetings[0].location?.lat);
  const [fromUnplacedFact]=withSittingFacts([newer],[{meetingId:newer.id,field:"location",value:{name:oldText,address:null},source:SOURCE}]);
  assert.equal(fromUnplacedFact.venueGap?.publishedText,newText);
});

test("a newly published physical point replaces an older office-reference pin",async()=>{
  const office=await placePublishedMeetingPins({meetings:[{...meeting(null),online:{label:"Virtual",joinUrl:null},venueGap:undefined}],offices,
    clock:()=>NOW,fetchImpl:async()=>response(BOARD_GEO)});
  const source={...SOURCE,collectedAt:"2026-10-24T01:00:00Z"},physical={name:OWN,address:OWN,lat:31.39,lng:-109.92};
  const [read]=withSittingFacts([meeting(null)],[
    {meetingId:meeting().id,field:"mapPin",value:office.meetings[0].mapPin,source:SOURCE},
    {meetingId:meeting().id,field:"location",value:physical,source},
  ]);
  assert.deepEqual(read.location,physical);assert.equal(read.mapPin,undefined,"the meeting's own point takes precedence over an office reference");
});

test("Census rejects unusable published text with 400 and publication tries the board office; service errors remain visible",async()=>{
  for(const status of [400,503]){
    let requests=0;
    const placed=await placePublishedMeetingPins({meetings:[meeting()],offices,clock:()=>NOW,fetchImpl:async()=>{
      return ++requests===1?new Response("address rejected",{status}):response(BOARD_GEO);
    }});
    assert.equal(placed.meetings[0].mapPin?.basis,"BODY_OFFICE");assert.equal(requests,2);
    assert.equal(placed.held.length,status===400?0:1);
  }
});

test("a confirmed Census road spelling keeps the published house, street name, city, state, ZIP and any stated direction",()=>{
  const rows=JSON.parse(readFileSync(new URL("./fixtures/mt01-galveston-census.json",import.meta.url),"utf8")) as {text:string}[];
  const response=JSON.parse(rows.find(row=>JSON.parse(row.text).result.addressMatches?.[0]?.addressComponents.streetName==="CALDER")!.text);
  const published="174 Calder Rd., League City, TX 77573";
  assert.ok(verifiedCensusVenuePoint(published,response));
  for(const changed of [published.replace("174","176"),published.replace("Calder","Other"),published.replace("League City","Galveston").replace("77573","77550"),
    published.replace("TX","CA"),published.replace("77573","77550"),published.replace("Calder","S Calder")]){
    const conflict=structuredClone(response);conflict.result.input.address.address=changed;
    assert.equal(verifiedCensusVenuePoint(changed,conflict),null,changed);
  }
  const unbound=structuredClone(response);delete unbound.result.input;
  assert.equal(verifiedCensusVenuePoint(published,unbound),null,"an unbound provider copy cannot declare a road spelling change");
});


test("a room number on the line before a published street is never its house number",()=>{
  assert.equal(censusAddressQuery("City & County Building, Council Committee Room, Room 391\r\n1437 Bannock Street"),"1437 Bannock Street");
  assert.equal(censusAddressQuery("Cathy Reynolds City Council Chamber\r\n1437 Bannock Street, Room 450"),"1437 Bannock Street");
});


test("a written house number uses the same published street in the Census query",()=>{
 const published="Metro Headquarters, One Gateway Plaza, 3rd Floor Gateway Plaza Conference Room, Los Angeles, CA 90012";
 const response=JSON.parse(readFileSync(new URL("./fixtures/mt01-gateway-census.json",import.meta.url),"utf8"));
 assert.equal(censusAddressQuery(published),"1 Gateway Plaza Gateway Plaza Conference Room, Los Angeles, CA 90012");
 assert.ok(verifiedCensusVenuePoint(published,response));
 assert.equal(verifiedCensusVenuePoint("One Gateway Plaza, Los Angeles, NY 90012, Metro Board Room",response),null);
 assert.equal(verifiedCensusVenuePoint(published.replace("One","Two"),response),null);
});

test("a street-only municipal address uses its published city and state without changing the fact",async()=>{
 const source={...meeting("1437 Bannock Street"),jurisdiction:"CITY AND COUNTY OF DENVER",
   bodyId:"ocd-division/country:us/state:co/place:denver#governing",ocdId:"ocd-division/country:us/state:co/place:denver"};
 const requests:string[]=[];
 const first=await placePublishedMeetingPins({meetings:[source],offices:new Map(),fetchImpl:async input=>{
   requests.push(new URL(String(input)).searchParams.get("address")!);
   return response(geo("1437","BANNOCK","DENVER","CO","80202"));
 }});
 assert.deepEqual(requests,["1437 Bannock Street, DENVER, CO"]);
 assert.equal(first.meetings[0].mapPin?.address,"1437 Bannock Street");
 assert.equal(source.venueGap?.publishedText,"1437 Bannock Street");
 assert.equal(first.meetings[0].mapPin?.basis,"MEETING");
 const next=await placePublishedMeetingPins({meetings:[source],previous:first.meetings,offices:new Map(),fetchImpl:async()=>{throw Error("A saved point must not request Census again");}});
 assert.deepEqual(next.held,[]);assert.deepEqual(next.meetings[0].mapPin,first.meetings[0].mapPin);
 const county=await placePublishedMeetingPins({meetings:[{...source,jurisdiction:"COUNTY OF DENVER"}],offices:new Map(),fetchImpl:async input=>{
   assert.equal(new URL(String(input)).searchParams.get("address"),"1437 Bannock Street, CO");
   return response(geo("1437","BANNOCK","DENVER","CO","80202"));
 }});
 assert.deepEqual(county.held,[]);
 assert.equal(county.meetings[0].mapPin,undefined,"a county name cannot invent the meeting city without a confirmed unique point");
});


test("a native Census copy keeps the physical street while canonicalizing a delivery ZIP or initialed street name",()=>{
 const rows=JSON.parse(readFileSync(new URL("./fixtures/mt01-census-canonical-forms.json",import.meta.url),"utf8")) as {query:string;response:unknown}[];
 for(const row of rows){
  assert.ok(verifiedCensusVenuePoint(row.query,row.response),row.query);
  const unbound=structuredClone(row.response) as {result:{input?:unknown}}; delete unbound.result.input;
  assert.equal(verifiedCensusVenuePoint(row.query,unbound),null);
  for(const changed of [row.query.replace(/^\d+/,"999"),row.query.replace("Mobile","Other City").replace("Portland","Other City").replace("Morrison","Other City"),row.query.replace("Government","Different").replace("King","Different").replace("Alameda","Different")])
   assert.equal(verifiedCensusVenuePoint(changed,row.response),null,changed);
 }
});


test("a published Wisconsin grid house number keeps its unique Census point and its stated state",()=>{
 const published="American Legion Post, N120W15932 Freistadt Rd., Germantown, WI 5302";
 const response=JSON.parse(readFileSync(new URL("./fixtures/mt01-wisconsin-grid-census.json",import.meta.url),"utf8"));
 assert.ok(verifiedCensusVenuePoint(published,response));
 for(const changed of [published.replace("N120W15932","N120W15933"),published.replace("Freistadt","Different"),
  published.replace("Germantown","Other City"),published.replace("WI","CA")])assert.equal(verifiedCensusVenuePoint(changed,response),null,changed);
});


test("native Census postal city and missing suffix forms retain the same published physical address",()=>{
 const rows=JSON.parse(readFileSync(new URL("./fixtures/mt01-wisconsin-postal-census.json",import.meta.url),"utf8")) as {query:string;response:unknown}[];
 for(const {query,response}of rows){
  assert.ok(verifiedCensusVenuePoint(query,response),query);
  const unbound=structuredClone(response) as {result:{input?:unknown}};delete unbound.result.input;
  assert.equal(verifiedCensusVenuePoint(query,unbound),null);
  for(const changed of [query.replace(/^\d+/,"999"),query.replace("Lake","Different").replace("Ogden","Different"),
    query.replace("WI","CA"),query.replace("Milwaukee","Other City").replace("53110","99999")])
    assert.equal(verifiedCensusVenuePoint(changed,response),null,changed);
 }
});


test("a published street intersection uses its unique native Census point without inventing a house number",()=>{
 const published="Jackson Park – Pickle Ball Courts, S. 43rd St. and Kinnickinnic River Parkway, Milwaukee, WI 53215";
 const response=JSON.parse(readFileSync(new URL("./fixtures/mt01-intersection-census.json",import.meta.url),"utf8"));
 assert.ok(verifiedCensusVenuePoint(published,response));
 for(const changed of [published.replace("43rd","44th"),published.replace("Kinnickinnic","Different"),
  published.replace("S. 43rd","N. 43rd"),published.replace("and Kinnickinnic","and E Kinnickinnic"),
  published.replace("WI","CA"),published.replace("Milwaukee","Other City")]){
   const conflict=structuredClone(response);conflict.result.input.address.address=censusAddressQuery(changed);
   assert.equal(verifiedCensusVenuePoint(changed,conflict),null,changed);
 }
 const unbound=structuredClone(response);delete unbound.result.input;assert.equal(verifiedCensusVenuePoint(published,unbound),null);
});


test("a county's complete street-only address queries its known state and keeps the original source text",async()=>{
 const source={...meeting("1230 W. Cherry St"),jurisdiction:"COUNTY OF MILWAUKEE",
  bodyId:"ocd-division/country:us/state:wi/county:milwaukee#body:health",ocdId:"ocd-division/country:us/state:wi/county:milwaukee"};
 const census=JSON.parse(readFileSync(new URL("./fixtures/mt01-state-qualified-census.json",import.meta.url),"utf8"));
 const first=await placePublishedMeetingPins({meetings:[source],offices:new Map(),fetchImpl:async input=>{
  assert.equal(new URL(String(input)).searchParams.get("address"),"1230 W. Cherry St, WI");return response(census);
 }});
 assert.deepEqual(first.held,[]);assert.equal(first.meetings[0].mapPin?.basis,"MEETING");
 assert.equal(first.meetings[0].mapPin?.address,"1230 W. Cherry St");
 assert.equal(source.venueGap?.publishedText,"1230 W. Cherry St");
 const next=await placePublishedMeetingPins({meetings:[source],previous:first.meetings,offices:new Map(),fetchImpl:async()=>{throw Error("Saved point requested Census again");}});
 assert.deepEqual(next.held,[]);assert.deepEqual(next.meetings[0].mapPin,first.meetings[0].mapPin);
 const conflict=structuredClone(census);conflict.result.addressMatches[0].addressComponents.state="GA";
 assert.equal(verifiedCensusVenuePoint("1230 W. Cherry St, WI",conflict),null);
});

test("a board's own published agenda address precedes its government's separate office",async()=>{
 const division="ocd-division/country:us/state:nc/county:wake",body=`${division}#governing`;
 const header=readFileSync(new URL("./fixtures/mt01-wake-agenda-header.txt",import.meta.url),"utf8");let reads=0;
 const offices=await publishedPinOffices(async()=>++reads===1?[{id:body,name:"Board of Commissioners",government_name:"County of Wake",
  government_address:"1 Government Plaza, Raleigh, NC",government_source:SOURCE}]:[{body_id:body,meeting_id:"legistar:wake:6264",
  jurisdiction:"COUNTY OF WAKE",url:"https://wake.legistar1.com/wake/meeting-agenda.pdf",source_org:"Wake County",collected_at:NOW,header}],[body]);
 assert.equal(offices.get(body)?.officeContact?.address,"301 South McDowell Street, Raleigh, NC");
 assert.equal(offices.get(body)?.governmentOffice?.address,"1 Government Plaza, Raleigh, NC");
 const census=JSON.parse(readFileSync(new URL("./fixtures/mt01-wake-office-census.json",import.meta.url),"utf8"));
 const source={...meeting("Wake County Justice Center"),id:"legistar:wake:6264",bodyId:body,ocdId:division,jurisdiction:"COUNTY OF WAKE"};
 const requests:string[]=[];const result=await placePublishedMeetingPins({meetings:[source],offices,fetchImpl:async input=>{
  requests.push(new URL(String(input)).searchParams.get("address")!);return response(census);
 }});
 assert.deepEqual(requests,["301 South McDowell Street, Raleigh, NC"]);assert.equal(result.meetings[0].mapPin?.basis,"BODY_OFFICE");
});
