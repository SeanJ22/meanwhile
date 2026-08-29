/**
 * Which InSite portals this adapter reads, and which registry body each row
 * belongs to.
 *
 * Pima is DERIVED from `LEGISTAR_CLIENTS` rather than restated: the OCD id, the
 * body id, the zone, the publishing organisation and the venue table are
 * already sourced there, and a second copy is a second thing that can drift.
 * A tenant that has no WebAPI client — because nobody has wired one, or because
 * the portal is the only route that works — states itself here in full.
 */
import {
  LEGISTAR_CLIENTS,
  venueKey,
  type LegistarVenue,
} from "../legistar/clients.ts";
import type { OcdId } from "../types.ts";

export interface InSiteTenant {
  /** The `{slug}` this adapter namespaces its meeting ids with. */
  slug: string;
  /** The portal host, e.g. `pima.legistar.com`. */
  host: string;
  /** WHERE. Null when the body maps to no Census division. */
  ocdId: OcdId | null;
  /** WHICH BODY. The registry id — never inferred from `ocdId`. */
  bodyId: string;
  /**
   * The grid's own department names that ARE this body.
   *
   * A list, not a string, because a tenant can file one body's sittings under
   * several department names: Mesa publishes "City Council", "City Council
   * Study Session" and "City Council Strategic Planning Session" as three
   * departments, and all three are the council meeting. A row whose department
   * is not listed is `notConfigured` — counted, never silently skipped.
   */
  bodyNames: string[];
  /** Rendered to the reader on the meeting. */
  bodyName: string;
  jurisdiction: string;
  /** The PUBLIC BODY, not Granicus. */
  publishingOrg: string;
  timeZone: string;
  venues: LegistarVenue[];
  /**
   * **THE BODY'S OWN SCHEDULE, ON THE BODY'S OWN DOMAIN.**
   *
   * Every other route in this adapter is Granicus telling us about the county.
   * This is the county telling us about itself, and it is the only available
   * check on the vendor: without a second first-party publisher there is no way
   * to know whether `Calendar.aspx` has dropped a sitting or moved an hour.
   *
   * `null` means **nobody has looked yet** for this tenant. It is a gap in this
   * registry and is reported as one — it is never a finding that the body
   * publishes no schedule of its own.
   *
   * Read as corroboration only: no `Meeting` is produced from it. See
   * `./clerk-schedule.ts`.
   */
  clerkScheduleUrl: string | null;
}

const pima = LEGISTAR_CLIENTS.find((client) => client.slug === "pima");
if (!pima?.insiteHost) {
  // A configuration this adapter depends on, checked where it is read rather
  // than discovered as an empty tenant list at the next refresh.
  throw new Error(
    "legistar-insite: the pima Legistar client states no insiteHost — " +
      "lib/sources/legistar/clients.ts is the only place that can",
  );
}

export const INSITE_TENANTS: InSiteTenant[] = [
  {
    slug: "pima",
    host: pima.insiteHost,
    ocdId: pima.ocdId,
    bodyId: pima.bodyId,
    bodyNames: ["Board of Supervisors"],
    bodyName: "Board of Supervisors",
    jurisdiction: pima.jurisdiction,
    publishingOrg: pima.publishingOrg,
    timeZone: pima.timeZone,
    venues: pima.venues,
    /**
     * Found 2026-08-28 through `www.pima.gov/sitemap.xml` — 1,746 URLs, of
     * which this is the one publishing dated Board sittings. The pages a
     * reader lands on (`/2760/Board-of-Supervisors-Calendar`,
     * `/2599/…-Agenda-Schedule`) publish only a recurrence rule in prose and a
     * link to the vendor; **this** page publishes the instances, with the
     * Clerk's own submission deadline beside each one.
     *
     * Measured the day it was found: 14 explicit future sittings here, 14 on
     * the InSite grid, 14 of 14 agreeing on body, date and wall clock.
     *
     * Permitted: `www.pima.gov/robots.txt` (read 2026-08-28) disallows
     * Baiduspider and Yandex only; `User-agent: *` carries no `Disallow`.
     */
    clerkScheduleUrl: "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule",
  },
  {
    /**
     * **THE UNNAMED CONTROL.** (2026-08-28.)
     *
     * Pima is where the defect was found; Mesa is what says it was never about
     * Pima. On one "Next Month" filter Mesa's grid publishes **15 sittings, 12
     * of them `meeting_NotViewable`**, and `webapi /events` returns **exactly
     * the other 3** — 3 of 3 matched, 12 of 12 missed. A tenant nobody was
     * looking at, losing four fifths of its next month through the API alone.
     *
     * It is wired rather than merely fixtured because a control that only ever
     * runs in a test proves the parse, not the product.
     *
     * **AND WIRING IT WAS NOT FINISHED WHEN IT STARTED SERVING** (2026-08-28).
     *
     * `bodyId` below resolves to exactly one registry body — it always did, and
     * an audit that reported it orphaned was reading a search, not the
     * registry. What was actually wrong is narrower and worse: that body was
     * `coverageStatus: NOT_ATTEMPTED`, `agendaSourceType: NONE`, with no row in
     * `lib/registry/source-wiring.ts` naming it, while this tenant was putting
     * ten of its sittings into `data/meetings-snapshot.json`. The registry said
     * nobody had looked at a body the product was already publishing.
     *
     * It reached production that way because `buildCompositeSource` builds this
     * adapter as `makeLegistarInSiteSource()` with no arguments — the wiring
     * rows are passed to every other adapter and not to this one — so the
     * capability turned on for Pima's row and this list decided the rest. **A
     * tenant added here is a body added to the product.** Both halves now
     * exist: `lib/registry/coverage-audit.ts` carries the walked rungs and
     * `lib/registry/source-wiring.ts` carries the row, and
     * `lib/ops/tenant-body-binding.ts` is the guard that fails the build
     * if a serving tenant ever again names a body the registry does not have.
     */
    slug: "mesa",
    host: "mesa.legistar.com",
    ocdId: "ocd-division/country:us/state:az/place:mesa",
    bodyId: "ocd-division/country:us/state:az/place:mesa#governing",
    bodyNames: [
      "City Council",
      "City Council Study Session",
      "City Council Strategic Planning Session",
    ],
    /**
     * **THE CITY'S OWN WORD FOR ITSELF**, read 2026-08-28 from
     * `https://www.mesaaz.gov/Government/City-Council-Meetings` (200, 159,373
     * bytes): `<h1>City Council Meetings</h1>`, a Schedule & Location table
     * headed "Council Meetings", and a calendar publishing "City Council
     * Meeting" and "City Council Study Session" as dated instances. Granicus
     * agrees independently — `webapi.legistar.com/v1/mesa/events` returns
     * `EventBodyName: "City Council"`.
     *
     * Recorded because the string was previously here uncited, and a
     * reader-facing body name that nothing sourced is a generated claim about
     * a government however obvious it looks.
     */
    bodyName: "City Council",
    jurisdiction: "Mesa, AZ",
    publishingOrg: "City of Mesa City Clerk",
    timeZone: "America/Phoenix",
    venues: [
      {
        match: "Council Chambers",
        name: "Mesa City Hall, Council Chambers",
        // Published by the city itself as "Mesa City Hall Council Chambers,
        // 20 East Main Street, Mesa, AZ 85201". Kept as the city prints it.
        address: "20 E. Main Street, Mesa, AZ 85201",
        lat: 33.415155,
        lng: -111.830942,
        addressSourceUrl: "https://www.mesaaz.gov/Government/City-Council-Meetings",
        coordinateSourceUrl:
          "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=20+E+Main+St%2C+Mesa%2C+AZ+85201&benchmark=Public_AR_Current&format=json",
        verifiedAt: null,
      },
      /*
       * NOT a venue, and deliberately absent: Mesa prints the string "Study
       * Session" in its own LOCATION column for the council's study sessions.
       * It names no place, and it is not one of the placeless strings either —
       * a study session happens in a room. Those rows drop as `unknownVenue`
       * and are counted as such, which is the honest report: we know the
       * sitting exists and we do not know where it is. Inventing City Hall for
       * it would put a pin on a building nobody promised.
       *
       * **AND THE CITY PROMISES ONE.** (Found 2026-08-28, recorded and not
       * yet taken.) `https://www.mesaaz.gov/Government/City-Council-Meetings`
       * publishes study sessions at "Mesa City Hall Study Session, 20 East
       * Main Street, Mesa, AZ 85201", and its Schedule & Location table
       * separates the two rooms: Council Meetings at "City Hall (upper
       * level)", study sessions at "City Hall (lower level)", both at 20 E.
       * Main St. So the sentence above stays true of the LEGISTAR column and
       * is no longer true of Mesa — the city names the place, on its own
       * domain, and the robots.txt read the same day permits the page.
       *
       * Left as a dated lead rather than a venue row because a venue needs
       * coordinates from the Census geocoder alongside the address, and
       * because turning it on moves this tenant's `unknownVenue` tally, which
       * the InSite drop accounting is asserted against. It is a rung nobody
       * has climbed yet, not a place nobody publishes.
       */
    ],
    /**
     * **NULL BECAUSE THE ROUTE EXISTS AND OUR PARSER CANNOT READ IT YET.**
     *
     * This said "nobody has looked" until 2026-08-28. Somebody has now looked,
     * and the honest value moved without the field moving, so the reason is
     * restated rather than left standing as a stale gap.
     *
     * **Found, and permitted.** `https://www.mesaaz.gov/Government/City-Council-Meetings`
     * (200, 159,373 bytes, read 2026-08-28) carries a "Meeting Calendar"
     * section publishing dated sittings on the city's own domain — 2026-08-31
     * City Council Meeting and City Council Study Session, 2026-09-03 Audit,
     * Finance and Enterprise Committee, a 2026-09-03 study session marked
     * Canceled — each with the venue as the city prints it, and each with a
     * "N more dates" expander (20 and 8 respectively).
     * `www.mesaaz.gov/robots.txt` (200, read the same day) carries one
     * `User-agent: *` block of 265 directives with no bare `Disallow: /`, and
     * disallows only this page's `/PublicComments` child. There is no wall.
     *
     * **Still null because of US.** `./clerk-schedule.ts`'s `parseClerkSchedule`
     * is a TABLE parser, written against the Clerk-published HTML table Pima
     * serves. Mesa's page is a CMS event widget with a different shape
     * entirely, and pointing a table parser at it would return zero rows —
     * which `CLAUDE.md` calls a FAILED extraction, not an empty document, and
     * which would then read on every refresh as the city having published
     * nothing. `REQUIRES_NEW_ADAPTER` is the state, and it is a claim about our
     * tooling; the city publishes its schedule, and this field must never be
     * read as saying otherwise. Recorded in `lib/registry/coverage-audit.ts`
     * with the rung and the URL so the next session inherits the finding rather
     * than the hunt.
     */
    clerkScheduleUrl: null,
  },
];

export function findTenant(slug: string): InSiteTenant | undefined {
  return INSITE_TENANTS.find((tenant) => tenant.slug === slug);
}

/** The venue a published location string names, or undefined. */
export function findTenantVenue(
  tenant: InSiteTenant,
  location: string,
): LegistarVenue | undefined {
  const key = venueKey(location);
  return tenant.venues.find((venue) => venueKey(venue.match) === key);
}

/** Is this grid row's department one of the bodies this tenant is wired for? */
export function isWiredBody(tenant: InSiteTenant, bodyName: string): boolean {
  const wanted = bodyName.trim().toLowerCase();
  return tenant.bodyNames.some((name) => name.trim().toLowerCase() === wanted);
}
