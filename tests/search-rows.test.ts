import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSearchIndex } from "@/lib/search/index";
import { bodyFromRow, resolveBodyRow } from "@/lib/search/body-row";
import type { CoveredBody } from "@/lib/registry/coverage";
import { groupByVenue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";

/**
 * M135 (2026-08-18) — every row opens a card, applied to the ask panel's
 * autocomplete.
 *
 * MEASURED, across the four pilot zips
 * (`corepack pnpm exec tsx scripts/audit-search-rows.mts`):
 *
 *   BEFORE  227 rows — 163 venue panel,  0 card, 43 fly only, 21 SILENT
 *   AFTER   227 rows — 163 venue panel, 49 card, 14 fly only,  1 SILENT
 *
 * The AFTER row was 36 card / 26 fly / 2 SILENT at g15, when the place row was
 * the one deliberate non-conversion. g18 shipped the place card on the
 * author's ruling A, and re-measuring on 2026-08-19 (run id
 * `m135-search-audit@2026-08-19T02:55:19.310Z`, 4 production GETs, all
 * declared SYNTHETIC) moved 13 place rows from fly-only to card and closed the
 * last silent place row. ONE row of 227 is still silent, and it is a refusal
 * rather than an oversight — see the distinctness test at the bottom.
 *
 * A row was silent when it carried no venue and no geometry: `onSearchPick`
 * selected a venue for the first, flew for the second, and a row with neither
 * fell off the end of the function. D18 named that defect for the meetings LIST
 * ("a row that answers a click with silence") and fixed it there; the sibling
 * handler never got the same fix.
 *
 * ONE DIAGNOSIS WAS TRIED AND DISCARDED, recorded because it is the more
 * useful half. The first theory was that body and place rows — which are
 * aggregates borrowing geometry from one of their meetings — were borrowing
 * from an online sitting while located ones existed. A reordering was written,
 * and the measurement was identical on both sides: 21 silent either way, because
 * venue meetings are iterated ahead of online ones and the aggregate already
 * preferred a located representative. The change was reverted rather than
 * shipped with a plausible story attached, and no test here asserts it.
 *
 * THE ONE ROW STILL SILENT is named rather than rounded away, and it is a
 * refusal rather than an oversight:
 *   - `85701 body: Finance and Audit Committee Meeting` — the body could not be
 *     resolved distinctly, so no card opens. See the refusal test below.
 *
 * `85641 place: Pima County, AZ` was the second, and it is now converted. The
 * card it opens elects nobody: it lists every body in the division and lets
 * the reader choose, which is the only resolution of a one-to-many that does
 * not invent an answer about who speaks for a jurisdiction.
 */

/**
 * A covered body, for the PU02 resolution tests. Only the fields the resolver
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

/** An online sitting: in no venue, and with no place to fly to (D18). */
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
  /*
   * The property that makes the surface answerable: every row that cannot be
   * answered by a venue or by the camera is of a kind whose pick opens a card.
   * `place` is the one kind that is not, which is why the audit's remainder is
   * a place row and why that row is named in this file's header rather than
   * asserted away.
   */
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
  /*
   * A source guard, not a render test. `onSearchPick` lives inside a large
   * client component whose whole tree would have to be mounted to exercise it,
   * and the property worth protecting is narrow: the fallback branches exist
   * and are gated on the row having no venue. Deleting either one re-opens the
   * defect the audit measured, and the audit script's AFTER column becomes a
   * fiction the same moment — this is what keeps that column honest.
   */
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
  /*
   * THE REASON THE CARD HAS THIS SHAPE (g18, the author's ruling A).
   *
   * g15 left the place row unconverted deliberately, and the reason is the
   * useful part: a place is a division several bodies sit in, and choosing one
   * of them — the largest, the first, the one with the most sittings — would
   * be this product answering "who speaks for Pima County?" out of its own
   * convenience. That is an invented claim about a government.
   *
   * So the guard is not that a card opens. It is that the card lists EVERY
   * body and elects none, and that its onward click matches on `bodyId`
   * rather than on the OCD-ID the place row carries — an ocdId match would
   * open one body's card from another body's row, which is the collapse
   * M135's other open row refuses by name.
   */
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
  /*
   * THE REFUSAL SURVIVES; THE MATCHER WAS REPLACED. (PU02 / M135, NJ Hunt 4
   * item 3, 2026-08-22.)
   *
   * This test used to assert the handler's source text contained
   * `b.name === item.label`. That assertion passed for four days while the
   * comparison behind it did essentially nothing: read off production at four
   * zips, the name match succeeded ONCE across twenty body rows, and at 03255
   * not one of the first five rows opened a card. A regex over source is a weak
   * instrument — it can only see that a line exists, never that it works — so
   * the guard now tests the RESOLVER, with the real strings that defeated it.
   *
   * What has not changed is the rule: several bodies share one division (85701
   * resolves 60 covered bodies against one point) and `CoveredBody.name` is
   * null on derived rows, so a match on ocdId alone would open one body's card
   * from another body's row. Ambiguity is still refused.
   */
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
  /*
   * The half of PU02 that no matcher could have fixed. Sutton, Wilmot, Warner,
   * Amphitheater Unified and Sunnyside Unified all publish meetings this
   * product holds, and the registry carries NO body row on those divisions —
   * so there is nothing to match against, and the row answered a click with
   * silence. The reader clicked a row naming the body; the body is the row.
   *
   * Everything in the built body is READ. Nothing is filled in: no homepage, no
   * agenda source, and `lookedAt` false, so the card renders those as the gaps
   * they are rather than as findings.
   */
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
  /*
   * A named instance is a class-wide defect. The autocomplete's exact-string
   * join had two siblings, both joining `Meeting.bodyName` (whatever a portal
   * published) to `CoveredBody.name` (what a hunt read off the body's page):
   * the Bodies door's "next sitting" lookup, and the place card's per-body
   * sitting count — which prints nothing at zero, so its undercount rendered as
   * "sits never".
   *
   * Found 3, fixed 3, all at the shared path. This guard fails if a fourth
   * appears.
   */
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
