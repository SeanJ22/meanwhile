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
       */
    ],
    /**
     * **NULL BECAUSE NOBODY HAS LOOKED, AND THAT IS THE HONEST VALUE.**
     *
     * Mesa's own council-schedule publication on `mesaaz.gov` has not been
     * hunted for in this workstream. This is a gap in THIS REGISTRY — a rung
     * nobody has climbed — and it is emitted as a `NOT_RETRIEVED` route
     * observation saying exactly that, so a later session reads "nobody has
     * looked" and not "the city publishes no schedule of its own".
     * `CLAUDE.md`: absence is never asserted.
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
