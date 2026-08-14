/**
 * The everyday-topics contact map (session brief 3, wall clock 2026-08-14):
 * the pothole standard. For each everyday topic × zip, the office that
 * actually owns the fix, with a REAL contact — phone, email, or request
 * URL — and the page that proves it. Where the true answer is a service
 * line rather than a person (Tucson's street-maintenance line), the
 * service line IS the answer: never route to a person who doesn't own the
 * topic.
 *
 * Curated and cited, never inferred. Every cell of the topics × zips grid
 * is accounted for: a row here, or a recorded miss in EVERYDAY_MISSES with
 * its reason — tests assert the accounting is complete (no cell silently
 * empty). The A07 rule carries through: a topic with no contact in a zip
 * renders the route's general steps and the honest gap, never a guessed
 * number.
 *
 * Verification states, honest about the hunt (the standing rule: a URL
 * cited must have been fetched and verified):
 *  - "PAGE_FETCHED": the source page was retrieved by a plain client this
 *    session and the contact read off it.
 *  - "PENDING_BROWSER": the government's host walls plain clients (403) —
 *    the number comes from the official page via search snippets or a
 *    secondary source, and the browser phase of this session verifies it
 *    against the page itself before ship. A row that fails browser
 *    verification is removed to a miss, never shipped on faith.
 */

export type EverydayVerification = "PAGE_FETCHED" | "PENDING_BROWSER";

export interface EverydayContact {
  /** A TOPIC_ROUTES id — the routing map's own key. */
  topicId: string;
  /** The zips this contact serves, of the four covered. */
  zips: readonly string[];
  /** The body, plain words. */
  body: string;
  /** What this line actually handles, plain words. */
  service: string;
  phone: string | null;
  email: string | null;
  requestUrl: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  verification: EverydayVerification;
  /** Anything the reader should know before calling. */
  note: string | null;
}

export interface EverydayMiss {
  topicId: string;
  zip: string;
  /** Why there is no contact — the recorded rung, never silence. */
  reason: string;
}

/** The everyday topic set, stated so the denominator is checkable:
 *  potholes/roads and streetlights ride roads-local (same owner at every
 *  covered zip — the road department is the streetlight department). */
export const EVERYDAY_TOPIC_IDS = [
  "roads-local",
  "trash-recycling",
  "water-sewer",
  "noise",
  "zoning-development",
  "animals",
  "parks",
  "snow-removal",
  "property-taxes",
] as const;

export const EVERYDAY_ZIPS = ["85701", "85641", "07866", "03255"] as const;

export const EVERYDAY_CONTACTS: readonly EverydayContact[] = [
  // ── 85701 — City of Tucson ────────────────────────────────────────────
  {
    topicId: "roads-local",
    zips: ["85701"],
    body: "City of Tucson — Department of Transportation & Mobility",
    service: "Street maintenance: potholes, streetlights, signs, sidewalks",
    phone: "520-791-3154",
    email: "TDOTconcerns@tucsonaz.gov",
    requestUrl: null,
    sourceUrl:
      "https://www.tucsonaz.gov/Departments/Transportation-Mobility/Street-Maintenance",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "The service line is the answer — this crew owns the fix.",
  },
  {
    topicId: "trash-recycling",
    zips: ["85701"],
    body: "City of Tucson — Environmental Services",
    service: "Trash and recycling collection, missed pickups, bulk items",
    phone: "520-791-3171",
    email: null,
    requestUrl: null,
    sourceUrl:
      "https://www.tucsonaz.gov/Shared-Contact-Content/Environmental-Services-Contact",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },
  {
    topicId: "water-sewer",
    zips: ["85701"],
    body: "Tucson Water",
    service: "Water service, bills, leaks",
    phone: "520-791-3242",
    email: null,
    requestUrl: null,
    sourceUrl:
      "https://www.tucsonaz.gov/Departments/Water/Customer-Service/Contact-Tucson-Water",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "For a broken main or emergency leak: 520-791-4133.",
  },
  {
    topicId: "noise",
    zips: ["85701"],
    body: "Tucson Police Department",
    service: "Noise complaints — the non-emergency line",
    phone: "520-791-4444",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.tucsonaz.gov/Departments/Police/Contact-TPD",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },
  {
    topicId: "zoning-development",
    zips: ["85701"],
    body: "City of Tucson — Planning & Development Services",
    service: "Building permits, zoning questions inside city limits",
    phone: "520-791-5550",
    email: "pdsdinquiries@tucsonaz.gov",
    requestUrl: null,
    sourceUrl:
      "https://www.tucsonaz.gov/Departments/Planning-Development-Services",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },
  {
    topicId: "parks",
    zips: ["85701"],
    body: "City of Tucson — Parks and Recreation",
    service: "City parks, pools, programs, reservations",
    phone: "520-791-4873",
    email: null,
    requestUrl: null,
    sourceUrl:
      "https://www.tucsonaz.gov/Departments/Parks-and-Recreation/Contact-Parks-and-Recreation",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },

  // ── Pima County (serves 85701 and 85641) ──────────────────────────────
  {
    topicId: "animals",
    zips: ["85701", "85641"],
    body: "Pima Animal Care Center",
    service: "Strays, animal complaints, licensing — the whole county",
    phone: "520-724-5900",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.pima.gov/2285/Animal-Care-Department-Directory",
    sourceOrg: "Pima County",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "property-taxes",
    zips: ["85701", "85641"],
    body: "Pima County Assessor",
    service: "Valuations, exemptions, assessment questions",
    phone: "520-724-8630",
    email: "asrPC@pima.gov",
    requestUrl: null,
    sourceUrl: "https://www.asr.pima.gov/contact",
    sourceOrg: "Pima County",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },

  // ── 85641 — unincorporated Pima County ────────────────────────────────
  {
    topicId: "roads-local",
    zips: ["85641"],
    body: "Pima County Department of Transportation — Maintenance & Operations",
    service: "Potholes and road problems on county-maintained roads",
    phone: "520-724-6410",
    email: null,
    requestUrl: "https://www.pima.gov/897/Report-a-Problem-Submit-Request",
    sourceUrl: "https://www.pima.gov/1012/Service-Request",
    sourceOrg: "Pima County",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "The service line is the answer — this crew owns the fix.",
  },
  {
    topicId: "water-sewer",
    zips: ["85641"],
    body: "Pima County Regional Wastewater Reclamation",
    service: "Sewer service and sewerage system help",
    phone: "520-724-3400",
    email: null,
    requestUrl: "https://sewerservicerequest.pima.gov/",
    sourceUrl: "https://sewerservicerequest.pima.gov/help",
    sourceOrg: "Pima County",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "Drinking water here comes from private water companies that vary by address — check your water bill for yours.",
  },
  {
    topicId: "noise",
    zips: ["85641"],
    body: "Pima County Sheriff's Department",
    service: "Noise complaints in unincorporated areas — the non-emergency line",
    phone: "520-351-4900",
    email: null,
    requestUrl: null,
    sourceUrl: "https://pimasheriff.org/about-us/contact-us",
    sourceOrg: "Pima County Sheriff's Department",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "zoning-development",
    zips: ["85641"],
    body: "Pima County Development Services",
    service: "Permits and zoning outside city limits",
    phone: "520-724-9000",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.pima.gov/970/Development-Services",
    sourceOrg: "Pima County",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "Zoning and building-code complaints: 520-724-9970.",
  },

  // ── 07866 — Borough of Rockaway ───────────────────────────────────────
  {
    topicId: "roads-local",
    zips: ["07866"],
    body: "Borough of Rockaway — Department of Public Works",
    service: "Borough roads: potholes, storm drains, line painting",
    phone: "973-627-7025",
    email: "dpwdirector@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/publicworks/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "After-hours emergencies: 973-627-1314.",
  },
  {
    topicId: "snow-removal",
    zips: ["07866"],
    body: "Borough of Rockaway — Department of Public Works",
    service: "Snow plowing and sanding on borough roads",
    phone: "973-627-7025",
    email: "dpwdirector@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/publicworks/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "After-hours emergencies: 973-627-1314.",
  },
  {
    topicId: "trash-recycling",
    zips: ["07866"],
    body: "Borough of Rockaway — Sanitation & Recycling",
    service: "Weekly garbage, biweekly recycling, the Union St. depot",
    phone: "973-627-7025",
    email: "dpwsupt@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/sanitation/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "water-sewer",
    zips: ["07866"],
    body: "Borough of Rockaway — Water & Sewer Utility",
    service: "Water service, bills, leaks",
    phone: "973-627-2000 ext 223",
    email: "waterclerk@rockawayborough.org",
    requestUrl: null,
    sourceUrl:
      "https://www.rockawayborough.org/departments/publicworks/water.shtml",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "After-hours emergencies: 973-627-1314.",
  },
  {
    topicId: "noise",
    zips: ["07866"],
    body: "Rockaway Borough Police Department",
    service: "Noise complaints — the non-emergency line",
    phone: "973-627-1314",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/police/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "zoning-development",
    zips: ["07866"],
    body: "Borough of Rockaway — Zoning Officer",
    service: "Zoning compliance, fence/sign/shed permits, code violations",
    phone: "973-627-2000 ext 218",
    email: "zoning@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/zoning/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "animals",
    zips: ["07866"],
    body: "Borough of Rockaway — Animal Control",
    service: "Strays, animal complaints; dog and cat licensing at borough hall",
    phone: "973-989-7050",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/health/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "After hours, call the police non-emergency line: 973-627-1314.",
  },
  {
    topicId: "parks",
    zips: ["07866"],
    body: "Borough of Rockaway — Department of Public Works",
    service: "Borough recreational facilities and fields",
    phone: "973-627-7025",
    email: "dpwdirector@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/publicworks/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "property-taxes",
    zips: ["07866"],
    body: "Borough of Rockaway — Tax Collector",
    service: "Tax bills and payments; the assessor handles valuations",
    phone: "973-627-2000 ext 228",
    email: "taxcollector@rockawayborough.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawayborough.org/departments/tax/",
    sourceOrg: "Borough of Rockaway",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "Assessment questions: the Tax Assessor, 973-627-2000 ext 222.",
  },

  // ── 03255 — Town of Newbury, NH ───────────────────────────────────────
  {
    topicId: "roads-local",
    zips: ["03255"],
    body: "Town of Newbury — Highway Department",
    service: "Town roads: potholes, grading, drainage",
    phone: "603-938-5494",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/highway-department",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },
  {
    topicId: "snow-removal",
    zips: ["03255"],
    body: "Town of Newbury — Highway Department",
    service: "Snow plowing and sanding on town roads",
    phone: "603-938-5494",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/highway-department",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "Route 103 is the state's — NHDOT plows it, not the town crew.",
  },
  {
    topicId: "trash-recycling",
    zips: ["03255"],
    body: "Town of Newbury — Transfer Station",
    service: "Household trash and recycling drop-off (no curbside pickup)",
    phone: "603-763-4940",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/transfer-station",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "The number is the town office — they hold the station's hours and permit rules.",
  },
  {
    topicId: "noise",
    zips: ["03255"],
    body: "Newbury Police Department",
    service: "Noise complaints — the business line, or dispatch after hours",
    phone: "603-763-4104",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/police-department",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: "Dispatch: 603-526-1961.",
  },
  {
    topicId: "property-taxes",
    zips: ["03255"],
    body: "Town of Newbury — Town Clerk / Tax Collector",
    service: "Tax bills, payments, and assessment questions",
    phone: "603-763-4940",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/departments",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PENDING_BROWSER",
    note: null,
  },
];

/**
 * The honest misses — every topics × zips cell with no contact above,
 * with the reason the hunt recorded. Tests assert contacts + misses
 * account for every cell exactly once: an empty cell that says nothing
 * is the failure mode this file exists to prevent.
 */
export const EVERYDAY_MISSES: readonly EverydayMiss[] = [
  {
    topicId: "snow-removal",
    zip: "85701",
    reason:
      "No dedicated snow-removal service exists to name — measurable snow in Tucson is rare enough that the city meets it through street maintenance, not a standing plow operation. Road problems route to roads-local.",
  },
  {
    topicId: "snow-removal",
    zip: "85641",
    reason:
      "Same as 85701 — no standing snow operation in the Sonoran Desert lowlands; county road problems route to roads-local.",
  },
  {
    topicId: "trash-recycling",
    zip: "85641",
    reason:
      "No public collection owner found: unincorporated Pima County appears to rely on private subscription haulers, and no county page naming a collection service was found this session. Rungs: pima.gov searched (no residential-collection page); the claim of private-only service is NOT asserted to readers — the cell is a recorded gap.",
  },
  {
    topicId: "parks",
    zip: "85641",
    reason:
      "Pima County Natural Resources, Parks & Recreation is the owner, but its phone number conflicts between secondary sources (520-877-6000 vs 520-724-5000) and the county page fetched this session carried no number. Refusing to publish a number two sources disagree on — rung recorded, browser phase may resolve.",
  },
  {
    topicId: "water-sewer",
    zip: "03255",
    reason:
      "Most of Newbury is private wells and septic; whether the Blodgett Landing sewer district serves any of 03255 is unverified. Rungs: newbury.nh.gov walls plain clients (403, the known NH-host wall); newburynh.org DNS no longer resolves. Not attempted in a real browser yet.",
  },
  {
    topicId: "zoning-development",
    zip: "03255",
    reason:
      "Newbury's code enforcement / building inspector contact could not be read: newbury.nh.gov walls plain clients (403). The town office (603-763-4940) would route it, but publishing that as the zoning owner without the page is a guess. Browser phase may resolve.",
  },
  {
    topicId: "animals",
    zip: "03255",
    reason:
      "NH towns typically run animal control through the police and license dogs at the town clerk, but Newbury's own pages could not be read (403 wall). Recording the gap rather than asserting the pattern.",
  },
  {
    topicId: "parks",
    zip: "03255",
    reason:
      "Newbury's recreation contact could not be read: newbury.nh.gov walls plain clients (403). Browser phase may resolve.",
  },
];

/** Contacts for a topic at a zip — the everyday answer, or nothing. */
export function everydayContactsFor(
  topicId: string,
  zip: string | null,
): EverydayContact[] {
  if (!zip) return [];
  return EVERYDAY_CONTACTS.filter(
    (c) => c.topicId === topicId && c.zips.includes(zip),
  );
}

/** The denominator, stated: topics × zips, split into covered and missed. */
export function everydayCoverageReport(): {
  topics: number;
  zips: number;
  cells: number;
  covered: number;
  missed: number;
} {
  const covered = new Set<string>();
  for (const c of EVERYDAY_CONTACTS) {
    for (const zip of c.zips) covered.add(`${c.topicId}|${zip}`);
  }
  return {
    topics: EVERYDAY_TOPIC_IDS.length,
    zips: EVERYDAY_ZIPS.length,
    cells: EVERYDAY_TOPIC_IDS.length * EVERYDAY_ZIPS.length,
    covered: covered.size,
    missed: EVERYDAY_MISSES.length,
  };
}
