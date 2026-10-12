import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSearchIndex } from "@/lib/search/index";
import { bodyFromRow, resolveBodyRow } from "@/lib/search/body-row";
import type { CoveredBody } from "@/lib/registry/coverage";
import { groupByVenue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";

/**
 * A covered body. Only the fields the resolver
 * reads are meaningful; the rest are filled with the registry's own defaults so
 * the fixture is a real `CoveredBody` rather than a cast.
 */
function coveredBody(over: Partial<CoveredBody> & { bodyId: string }): CoveredBody {
  return {
    bodyId: over.bodyId,
    ocdId: over.ocdId ?? null,
    name: over.name ?? null,
    divisionLabel: over.divisionLabel ?? "Pima County, AZ",
    divisionType: over.divisionType ?? "county",
    lsad: over.lsad ?? null,
    schoolDependency: over.schoolDependency ?? "UNCLASSIFIED",
    bodyClass: over.bodyClass ?? "GOVERNING",
    coverageStatus: over.coverageStatus ?? "NOT_ATTEMPTED",
    homepageUrl: over.homepageUrl ?? null,
    agendaSourceRef: over.agendaSourceRef ?? null,
    lookedAt: over.lookedAt ?? false,
    tier: over.tier ?? "local",
  };
}

const PIMA = "ocd-division/country:us/state:az/county:pima";

function meeting(over: Partial<Meeting> & { id: string }): Meeting {
  return {
    ocdId: PIMA,
    bodyName: "Board of Supervisors",
    title: "Regular Meeting",
    startsAt: "2026-09-11T13:30:00-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Board Chambers", address: null, lat: 32.22, lng: -110.97 },
    agendaUrl: null,
    jurisdiction: "Pima County, AZ",
    status: "SCHEDULED" as const,
    provenance: {
      sourceUrl: null,
      sourceOrg: "Pima County",
      collectedAt: "2026-08-18T22:00:00.000Z",
      verifiedAt: null,
    },
    ...over,
  } as Meeting;
}

/** An online sitting: in no venue, and with no place to fly to. */
function online(over: Partial<Meeting> & { id: string }): Meeting {
  return meeting({ ...over, location: null });
}

function index(meetings: Meeting[]) {
  return buildSearchIndex(
    groupByVenue(meetings.filter((m) => m.location !== null)),
    [],
    meetings.filter((m) => m.location === null),
  );
}

/** The handler's body, sliced out of source for the guards below. */
function searchPickSource(): string {
  const source = readFileSync("components/map/map-entry.tsx", "utf8");
  const start = source.indexOf("const onSearchPick = useCallback");
  const end = source.indexOf("const onPickMeeting = useCallback");
  assert.ok(start > 0 && end > start, "onSearchPick is still where the guard expects it");
  return source.slice(start, end);
}

test("an all-online body carries no geometry, and none is invented for it", () => {
  // The precondition the card fallback exists for. A body that genuinely never
  // meets anywhere has no lat/lng, and that is a true fact about the body — the
  // fix answers it with a card, never by manufacturing a point to fly to.
  const rows = index([
    online({ id: "m:a", title: "Regular Meeting" }),
    online({ id: "m:b", title: "Special Meeting" }),
  ]);

  const body = rows.find((r) => r.kind === "body");
  assert.ok(body, "the index still produces a body row");
  assert.equal(body.lat, null, "no location is invented for an all-online body");
  assert.equal(body.venueKey, null, "an online body is in no venue");

  const onlineMeetingRow = rows.find((r) => r.kind === "meeting");
  assert.ok(onlineMeetingRow);
  assert.equal(onlineMeetingRow.venueKey, null, "an online sitting is in no venue");
  assert.equal(onlineMeetingRow.lat, null, "and has nowhere to fly to");
});

test("the rows that carry neither venue nor geometry are exactly the kinds with a card fallback", () => {
  const rows = index([
    online({ id: "m:online", title: "Special Meeting" }),
    meeting({ id: "m:located", title: "Regular Meeting" }),
  ]);

  const noRoute = rows.filter((r) => r.venueKey === null && r.lat === null);
  const kinds = [...new Set(noRoute.map((r) => r.kind))].sort();

  assert.deepEqual(
    kinds.filter((k) => k !== "meeting" && k !== "body"),
    [],
    "a row with no venue and no geometry is a meeting or a body — both have a card",
  );
  console.log(
    `search-rows: ${rows.length} rows, ${noRoute.length} with no venue and no geometry`,
  );
});

test("onSearchPick opens a card for the rows it cannot fly to", () => {
  const pick = searchPickSource();

  assert.match(
    pick,
    /if \(!item\.venueKey\)/,
    "the fallback is gated on the row having no venue",
  );
  assert.match(
    pick,
    /meetingSubject\(/,
    "a meeting row with no venue opens the large meeting card (D18's fix)",
  );
  assert.match(
    pick,
    /bodySubject\(/,
    "a body row opens that body's large battlecard (M135's ruling)",
  );
  assert.match(
    pick,
    /placeSubject\(/,
    "a place row opens the place card (g18, the author's ruling A)",
  );
});

test("the place card elects nobody to stand for the place", () => {
  const source = readFileSync("components/map/map-entry.tsx", "utf8");
  const start = source.indexOf("function placeSubject(");
  const end = source.indexOf("function typeFromOcdId(");
  assert.ok(start > 0 && end > start, "placeSubject is still where the guard expects it");
  const builder = source.slice(start, end);

  assert.match(
    builder,
    /bodies\.filter\(\(b\) => b\.ocdId === ocdId\)/,
    "every body in the division is listed, not a chosen one",
  );
  assert.doesNotMatch(
    builder,
    /\.slice\(0, ?1\)|bodies\.find\(/,
    "no single body is elected to stand for the place",
  );
  assert.match(
    builder,
    /divisionOcdId: null/,
    "the place card carries no re-derive key — a place and a district can share an OCD-ID",
  );
  assert.match(
    builder,
    /absence:/,
    "a place with no bodies renders a stated absence, never an empty list",
  );
  assert.match(
    builder,
    /rowTier \?\? mine\[0\]\?\.tier \?\? null/,
    "the tier is taken or left null, never guessed",
  );

  const onward = source.slice(source.indexOf("onOpenPlaceBody={"), source.indexOf("onOpenPlaceBody={") + 700);
  assert.match(
    onward,
    /b\.bodyId === key/,
    "the onward click matches on bodyId, never on the place row's OCD-ID",
  );
});

test("a body row's card is refused rather than guessed when the match is ambiguous", () => {
  const bodies = [
    coveredBody({ bodyId: "a", name: null, ocdId: PIMA }),
    coveredBody({ bodyId: "b", name: "Board of Adjustment (BAJ)", ocdId: PIMA }),
    coveredBody({ bodyId: "c", name: "Citizens' Water Advisory Committee (CWAC)", ocdId: PIMA }),
  ];

  // The same name written differently resolves, and says it did so by
  // normalising rather than by luck.
  const normalised = resolveBodyRow({ label: "Board of Adjustment", ocdId: PIMA }, bodies);
  assert.equal(normalised?.body.bodyId, "b");
  assert.equal(normalised?.how, "normalised");

  // A different body on the same division is NOT matched to it.
  assert.equal(resolveBodyRow({ label: "Board of Supervisors", ocdId: PIMA }, bodies), null);

  // One body on the division is still accepted on the division alone.
  const only = resolveBodyRow({ label: "Anything At All", ocdId: "ocd-division/country:us/state:az/place:marana" }, [
    coveredBody({ bodyId: "d", name: null, ocdId: "ocd-division/country:us/state:az/place:marana" }),
  ]);
  assert.equal(only?.how, "only-body-on-division");

  // A row on a division the registry does not hold resolves to nothing here —
  // and the handler answers it from the row, which is the next assertion.
  assert.equal(resolveBodyRow({ label: "Selectboard", ocdId: "ocd-division/country:us/state:nh/place:sutton_town" }, bodies), null);
});

test("PU02: a body row the registry cannot resolve still opens a card, built from the row", () => {
  const SUTTON = "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town";
  const built = bodyFromRow({ label: "Select Board", ocdId: SUTTON, jurisdiction: "Sutton, NH" });

  assert.equal(built.name, "Select Board", "the name is the row's own label, not a guess");
  assert.equal(built.ocdId, SUTTON);
  assert.equal(built.divisionLabel, "Sutton, NH");
  assert.equal(built.homepageUrl, null, "no site is invented");
  assert.equal(built.agendaSourceRef, null, "no agenda source is invented");
  assert.equal(built.lookedAt, false, "it does not claim anybody has hunted this body");

  // And the handler reaches for it, rather than opening nothing.
  const pick = searchPickSource();
  assert.match(pick, /resolveBodyRow\(/, "the row is resolved through the shared resolver");
  assert.match(pick, /bodyFromRow\(/, "an unresolved row is answered from the row itself");
  assert.match(pick, /bodySubject\(/, "and it opens the same card every other door onto a body opens");
});

test("PU02 class sweep: no surface joins a snapshot body name to a registry name by ===", () => {
  for (const file of ["components/map/map-entry.tsx", "components/map/door-overlay.tsx"]) {
    const text = readFileSync(file, "utf8");
    const offenders = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .filter((line) => /m[.]bodyName ===|bodyName === [(]?b[.]name|[.]name === item[.]label/.test(line));
    assert.deepEqual(
      offenders,
      [],
      `${file} joins a published body name to a registry name with ===; use sameName()`,
    );
  }
});
