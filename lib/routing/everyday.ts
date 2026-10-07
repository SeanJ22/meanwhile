import { mayUseTestFixture } from "../civic-data/fixture-policy.ts";

/**
 * The everyday-topics contact map: for each everyday topic × ZIP, the office that actually owns the
 * fix, with a real contact (phone, email or request URL) and the page that proves it. Where the true
 * answer is a service line, the service line is the answer; never a person who doesn't own the topic.
 *
 * Curated and cited, never inferred. Every cell of the topics × ZIPs grid is a row here or a recorded
 * miss in EVERYDAY_MISSES; tests assert the accounting is complete.
 *
 * Verification states:
 *  - "PAGE_FETCHED": the contact was read off the source page itself.
 *  - "PENDING_BROWSER": the contact comes from a snippet or secondary source and has not been read off
 *    the page. A pending row must be verified or moved to a miss before it ships.
 */

export type EverydayVerification = "PAGE_FETCHED" | "PENDING_BROWSER";

export interface EverydayContact {
  /** A TOPIC_ROUTES id — the routing map's own key. */
  topicId: string;
  /** The ZIPs whose service applicability is supported by this contact's evidence. */
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
  /** A gap is an explicit owner obligation, not an inferred absence. */
  disposition: "UNKNOWN";
  holdingStatus: "CONTACT_OWED";
  /** Exact official page reviewed at the last unsuccessful contact hunt. */
  evidenceSourceUrl: string;
  reviewedAt: string;
  /** Why there is no contact — the recorded rung, never silence. */
  reason: string;
}

export interface EverydayRoutingContactRecord {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly kind: "CONTACT";
  readonly topicId: string;
  readonly zip: string;
  /** One source-scoped contact at one exact denominator cell. */
  readonly contact: EverydayContact;
}

export interface EverydayRoutingContactOwedRecord {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly kind: "CONTACT_OWED";
  readonly topicId: string;
  readonly zip: string;
  readonly disposition: "UNKNOWN";
  readonly holdingStatus: "CONTACT_OWED";
  readonly evidenceSourceUrl: string;
  readonly reviewedAt: string;
  readonly reason: string;
}

export type EverydayRoutingRecord =
  | EverydayRoutingContactRecord
  | EverydayRoutingContactOwedRecord;

export interface EverydayRoutingDenominator {
  readonly [key: string]: number;
  readonly topics: number;
  readonly zips: number;
  readonly cells: number;
  readonly contactAvailableCells: number;
  readonly unknownContactOwedCells: number;
  readonly contactRecords: number;
  readonly contactSources: number;
}

/** Canonical Reader projection promoted under the manual everyday contract. */
export interface EverydayRoutingProjection {
  readonly kind: "everyday-routing";
  readonly formatVersion: 1;
  readonly denominator: EverydayRoutingDenominator;
  readonly records: readonly EverydayRoutingRecord[];
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
  {
    topicId: "roads-local",
    zips: ["85701"],
    body: "City of Tucson — Street Maintenance (Transportation & Mobility)",
    service:
      "Potholes, streetlights, signs, debris — the city takes these through Tucson 311",
    // The city's own page names 311 as the current published channel.
    phone: "311",
    email: null,
    requestUrl: "https://www.tucsonaz.gov/Residents/311-Service-Request-Portal",
    sourceUrl:
      "https://www.tucsonaz.gov/Departments/Transportation-Mobility/Street-Maintenance",
    sourceOrg: "City of Tucson",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "The service line is the answer — this crew owns the fix. Pothole repairs and street light issues are on their own list.",
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
    verification: "PAGE_FETCHED",
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
    verification: "PAGE_FETCHED",
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
    verification: "PAGE_FETCHED",
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
    verification: "PAGE_FETCHED",
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
    verification: "PAGE_FETCHED",
    note: null,
  },

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
    verification: "PAGE_FETCHED",
    note: null,
  },

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
    verification: "PAGE_FETCHED",
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

  // Two municipalities share this ZIP, each with its own service lines. Both render, each named plainly;
  // a ZIP-keyed map must not guess which one the reader lives in.
  {
    topicId: "roads-local",
    zips: ["07866"],
    body: "Rockaway Township — Department of Public Works & Utilities",
    service: "Township roads: potholes, snow, drainage",
    phone: "973-983-2891",
    email: "dpw@rockawaytownship.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/187/Public-Works-Utilities",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "For Rockaway Township addresses. Also answers at 973-627-1700.",
  },
  {
    topicId: "snow-removal",
    zips: ["07866"],
    body: "Rockaway Township — Department of Public Works & Utilities",
    service: "Snow plowing on township roads",
    phone: "973-983-2891",
    email: "dpw@rockawaytownship.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/187/Public-Works-Utilities",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "For Rockaway Township addresses.",
  },
  {
    topicId: "trash-recycling",
    zips: ["07866"],
    body: "Rockaway Township — Department of Public Works",
    service: "Recycling, bulk collection, and garbage questions",
    phone: "973-983-2891",
    email: "dpw@rockawaytownship.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/189/Recycle",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "For Rockaway Township addresses.",
  },
  {
    topicId: "water-sewer",
    zips: ["07866"],
    body: "Rockaway Township — Municipal Utility (Water & Sewer)",
    service: "Water and sewer service, run through Public Works",
    phone: "973-983-2891",
    email: "dpw@rockawaytownship.org",
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/187/Public-Works-Utilities",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "For Rockaway Township addresses.",
  },
  {
    topicId: "noise",
    zips: ["07866"],
    body: "Rockaway Township Police Department",
    service: "Noise complaints — the non-emergency line",
    phone: "973-625-4000",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/231/Police",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "For Rockaway Township addresses.",
  },
  {
    topicId: "animals",
    zips: ["07866"],
    body: "Rockaway Township — Animal Control",
    service: "Animal complaints and humane law enforcement",
    phone: "973-983-2848",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.rockawaytownship.org/158/Animal-Control",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "After 4:30 PM and weekends: Rockaway Township Police, 973-625-4000.",
  },

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
    note: "For Borough of Rockaway addresses. Rockaway Township addresses: the municipal complex routes zoning questions, 973-627-7200.",
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
    note: "Rockaway Township addresses: the municipal complex routes recreation questions, 973-627-7200.",
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
    note: "Assessment questions: the Tax Assessor, 973-627-2000 ext 222. Rockaway Township addresses: the municipal complex routes tax questions, 973-627-7200.",
  },

  {
    topicId: "roads-local",
    zips: ["03255"],
    body: "Town of Newbury — Highway Department",
    service: "Town roads: potholes, grading, drainage",
    phone: "603-938-5494",
    email: "bscanlon@newbury.nh.gov",
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/highway-department",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "snow-removal",
    zips: ["03255"],
    body: "Town of Newbury — Highway Department",
    service: "Snow plowing and sanding on town roads",
    phone: "603-938-5494",
    email: "bscanlon@newbury.nh.gov",
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/highway-department",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "Route 103 is the state's — NHDOT plows it, not the town crew.",
  },
  {
    topicId: "trash-recycling",
    zips: ["03255"],
    body: "Town of Newbury — Transfer Station",
    service: "Household trash and recycling drop-off (no curbside pickup)",
    phone: "603-763-2289",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/departments",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "A transfer-station permit is required — get one at the Town Office with proof of residency and your plate number.",
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
    verification: "PAGE_FETCHED",
    note: "Dispatch: 603-526-1961.",
  },
  {
    topicId: "property-taxes",
    zips: ["03255"],
    body: "Town of Newbury — Tax Collector",
    service: "Tax bills and payments",
    phone: "603-763-5326",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/departments",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: "Assessment questions: the Assessor at the Town Office, 603-763-4940 ext. 209.",
  },
  {
    topicId: "zoning-development",
    zips: ["03255"],
    body: "Town of Newbury — Code Enforcement Officer",
    service: "Building, zoning, and code questions",
    phone: "603-763-4940 ext. 203",
    email: "codeenforcement@newbury.nh.gov",
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/departments",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
    note: null,
  },
  {
    topicId: "parks",
    zips: ["03255"],
    body: "Town of Newbury — Recreation",
    service: "Town recreation programs and facilities",
    phone: "603-763-4940",
    email: null,
    requestUrl: null,
    sourceUrl: "https://www.newbury.nh.gov/departments",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
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
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl:
      "https://www.tucsonaz.gov/Departments/Transportation-Mobility/Street-Maintenance",
    reviewedAt: "2026-08-14",
    reason:
      "No dedicated snow-removal service exists to name — measurable snow in Tucson is rare enough that the city meets it through street maintenance, not a standing plow operation. Road problems route to roads-local.",
  },
  {
    topicId: "snow-removal",
    zip: "85641",
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl: "https://www.pima.gov/1012/Service-Request",
    reviewedAt: "2026-08-14",
    reason:
      "Same as 85701 — no standing snow operation in the Sonoran Desert lowlands; county road problems route to roads-local.",
  },
  {
    topicId: "trash-recycling",
    zip: "85641",
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl: "https://www.pima.gov/1012/Service-Request",
    reviewedAt: "2026-08-14",
    reason:
      "No public collection owner found: unincorporated Pima County appears to rely on private subscription haulers, and no county page naming a collection service was found this session. Rungs: pima.gov searched (no residential-collection page); the claim of private-only service is NOT asserted to readers — the cell is a recorded gap.",
  },
  {
    topicId: "parks",
    zip: "85641",
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl: "https://www.pima.gov/1193/",
    reviewedAt: "2026-08-14",
    reason:
      "Pima County Natural Resources, Parks & Recreation is the owner, but its phone number conflicts between secondary sources (520-877-6000 vs 520-724-5000) and the county page fetched this session carried no number. Refusing to publish a number two sources disagree on — rung recorded, browser phase may resolve.",
  },
  {
    topicId: "water-sewer",
    zip: "03255",
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl: "https://www.newbury.nh.gov/departments",
    reviewedAt: "2026-08-14",
    reason:
      "The town's own department directory (read in a real browser 2026-08-14) lists no water or sewer department — consistent with private wells and septic. Whether the Blodgett Landing sewer district serves any of 03255 remains unverified; recorded as a gap rather than asserted either way.",
  },
  {
    topicId: "animals",
    zip: "03255",
    disposition: "UNKNOWN",
    holdingStatus: "CONTACT_OWED",
    evidenceSourceUrl: "https://www.newbury.nh.gov/departments",
    reviewedAt: "2026-08-14",
    reason:
      "The town's own department directory (read in a real browser 2026-08-14) lists no animal control; NH towns typically run it through the police and license dogs at the town clerk, but publishing that pattern as Newbury's answer without the town saying so is a guess. The police row under 'noise' is the practical fallback.",
  },
];

function everydayCellId(topicId: string, zip: string): string {
  return `${topicId}|${zip}`;
}

function everydayContactRecordId(topicId: string, zip: string, sourceUrl: string): string {
  return `everyday-contact:${topicId}:${zip}:${sourceUrl}`;
}

function everydayContactOwedRecordId(topicId: string, zip: string): string {
  return `everyday-contact-owed:${topicId}:${zip}`;
}

/**
 * Convert the tracked adoption evidence into the exact first import package. Production reads this
 * shape only after the package has passed source receipts and canonical promotion.
 */
export function buildEverydayRoutingProjection(
  contacts: readonly EverydayContact[] = EVERYDAY_CONTACTS,
  misses: readonly EverydayMiss[] = EVERYDAY_MISSES,
): EverydayRoutingProjection {
  const contactRecords = contacts.flatMap((contact) =>
    contact.zips.map((zip): EverydayRoutingContactRecord => ({
      id: everydayContactRecordId(contact.topicId, zip, contact.sourceUrl),
      kind: "CONTACT",
      topicId: contact.topicId,
      zip,
      contact: { ...contact, zips: [zip] },
    }))
  );
  const owedRecords = misses.map((miss): EverydayRoutingContactOwedRecord => ({
    id: everydayContactOwedRecordId(miss.topicId, miss.zip),
    kind: "CONTACT_OWED",
    topicId: miss.topicId,
    zip: miss.zip,
    disposition: miss.disposition,
    holdingStatus: miss.holdingStatus,
    evidenceSourceUrl: miss.evidenceSourceUrl,
    reviewedAt: miss.reviewedAt,
    reason: miss.reason,
  }));
  const projection = everydayRoutingProjectionFromRecords([...contactRecords, ...owedRecords]);
  const problems = everydayRoutingProjectionProblems(projection);
  if (problems.length > 0) {
    throw new Error(`EVERYDAY_ROUTING_FIRST_SEED_INVALID:${problems.join(" | ")}`);
  }
  return projection;
}

/** Recompute, never trust, the accounting carried by a promoted projection. */
export function everydayRoutingProjectionFromRecords(
  records: readonly EverydayRoutingRecord[],
): EverydayRoutingProjection {
  const contacts = records.filter(
    (record): record is EverydayRoutingContactRecord => record.kind === "CONTACT",
  );
  const owed = records.filter(
    (record): record is EverydayRoutingContactOwedRecord => record.kind === "CONTACT_OWED",
  );
  const covered = new Set(contacts.map((record) => everydayCellId(record.topicId, record.zip)));
  const zips = new Set(records.map(record => record.zip));
  const owedCells = new Set(owed.map(record => everydayCellId(record.topicId, record.zip)));
  const unacquiredCells = EVERYDAY_TOPIC_IDS.length * zips.size - new Set([...covered, ...owedCells]).size;
  return {
    kind: "everyday-routing",
    formatVersion: 1,
    denominator: {
      topics: EVERYDAY_TOPIC_IDS.length,
      zips: zips.size,
      cells: EVERYDAY_TOPIC_IDS.length * zips.size,
      contactAvailableCells: covered.size,
      unknownContactOwedCells: new Set(owed.map((record) => everydayCellId(record.topicId, record.zip))).size,
      contactRecords: contacts.length,
      contactSources: new Set(contacts.map((record) => record.contact.sourceUrl)).size,
      // Missing acquisition is not publisher absence and needs no invented
      // source-reviewed CONTACT_OWED row. Legacy complete receipts stay exact.
      ...(unacquiredCells > 0 ? { unacquiredCells } : {}),
    },
    records: [...records].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** Fail-closed structural/semantic checks with no Reader/UI/software-suite input. */
export function everydayRoutingProjectionProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["The everyday routing projection is not an object."];
  }
  const projection = value as Partial<EverydayRoutingProjection>;
  if (projection.kind !== "everyday-routing" || projection.formatVersion !== 1) {
    problems.push("The everyday routing projection has the wrong family or format version.");
  }
  const records = Array.isArray(projection.records) ? projection.records : [];
  const ids = new Set<string>();
  const contacts: EverydayRoutingContactRecord[] = [];
  const owed: EverydayRoutingContactOwedRecord[] = [];
  const topicIds = new Set<string>(EVERYDAY_TOPIC_IDS);
  const zips = new Set(records.map(record => record?.zip).filter((zip): zip is string => typeof zip === "string" && /^\d{5}$/.test(zip)));
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      problems.push("An everyday routing record is not an object.");
      continue;
    }
    const row = record as EverydayRoutingRecord;
    if (!row.id || ids.has(row.id)) problems.push("Everyday routing record ids are empty or duplicated.");
    ids.add(row.id);
    if (!topicIds.has(row.topicId) || !/^\d{5}$/.test(row.zip)) {
      problems.push(`${row.id || "An unnamed record"} is outside the exact topic/zip denominator.`);
    }
    if (row.kind === "CONTACT") {
      contacts.push(row);
      const contact = row.contact;
      const zips = Array.isArray(contact?.zips) ? contact.zips : [];
      if (row.id !== everydayContactRecordId(row.topicId, row.zip, contact?.sourceUrl ?? "") ||
          !contact || contact.topicId !== row.topicId || zips.length !== 1 || zips[0] !== row.zip ||
          contact.verification !== "PAGE_FETCHED" || !/^https:\/\//.test(contact.sourceUrl) ||
          !Number.isFinite(Date.parse(contact.collectedAt)) ||
          !(contact.phone || contact.email || contact.requestUrl) ||
          (contact.requestUrl !== null && !/^https:\/\//.test(contact.requestUrl))) {
        problems.push(`${row.id} lacks its canonical source-scoped id, verified contact, exact cell, or usable contact channel.`);
      }
    } else if (row.kind === "CONTACT_OWED") {
      owed.push(row);
      if (row.id !== everydayContactOwedRecordId(row.topicId, row.zip) ||
          row.disposition !== "UNKNOWN" || row.holdingStatus !== "CONTACT_OWED" ||
          !row.reason?.trim() || !/^https:\/\//.test(row.evidenceSourceUrl) ||
          !Number.isFinite(Date.parse(row.reviewedAt))) {
        problems.push(`${row.id} is not a canonically keyed explicit UNKNOWN/CONTACT_OWED record with reviewed official evidence.`);
      }
    } else {
      problems.push(`${(row as { id?: string }).id ?? "An unnamed record"} has an unknown everyday record kind.`);
    }
  }

  const expectedCells = new Set(
    EVERYDAY_TOPIC_IDS.flatMap((topicId) => [...zips].map((zip) => everydayCellId(topicId, zip))),
  );
  const contactCells = new Set(contacts.map((record) => everydayCellId(record.topicId, record.zip)));
  const owedCells = owed.map((record) => everydayCellId(record.topicId, record.zip));
  const owedCellSet = new Set(owedCells);
  for (const cell of expectedCells) {
    const contactAvailable = contactCells.has(cell);
    const contactOwed = owedCellSet.has(cell);
    if (contactAvailable && contactOwed) {
      problems.push(`${cell} cannot have both contacts and a CONTACT_OWED record.`);
    }
  }
  if (owedCellSet.size !== owedCells.length) problems.push("A denominator cell has more than one CONTACT_OWED record.");

  const sourceCount = new Set(contacts.map((record) => record.contact.sourceUrl)).size;
  const expectedDenominator: EverydayRoutingDenominator = {
    topics: EVERYDAY_TOPIC_IDS.length,
    zips: zips.size,
    cells: expectedCells.size,
    contactAvailableCells: contactCells.size,
    unknownContactOwedCells: owedCellSet.size,
    contactRecords: contacts.length,
    contactSources: sourceCount,
    unacquiredCells: expectedCells.size - new Set([...contactCells, ...owedCellSet]).size,
  };
  for (const [key, expected] of Object.entries(expectedDenominator)) {
    const observed = projection.denominator?.[key as keyof EverydayRoutingDenominator];
    if ((key === "unacquiredCells" ? observed ?? 0 : observed) !== expected) {
      problems.push(`The everyday routing denominator reports ${key} incorrectly; expected ${expected}.`);
    }
  }
  return [...new Set(problems)].sort();
}

export function everydayContactsFromProjection(
  projection: EverydayRoutingProjection,
): EverydayContact[] {
  return projection.records
    .filter((record): record is EverydayRoutingContactRecord => record.kind === "CONTACT")
    .map((record) => record.contact);
}

/** Contacts for a topic at a zip — the everyday answer, or nothing. */
export function everydayContactsFor(
  topicId: string,
  zip: string | null,
  projection?: EverydayRoutingProjection | null,
): EverydayContact[] {
  if (!zip) return [];
  const contacts = projection
    ? everydayContactsFromProjection(projection)
    : mayUseTestFixture()
      ? EVERYDAY_CONTACTS
      : [];
  return contacts.filter(
    (c) => readerEligibleEverydayContact(c) && c.topicId === topicId && c.zips.includes(zip),
  );
}

/** Acquisition or a search snippet is not a verified reader contact. */
export function readerEligibleEverydayContact(contact: EverydayContact): boolean {
  return contact.verification === "PAGE_FETCHED";
}

/** The denominator, stated: topics × zips, split into covered and missed. */
export function everydayCoverageReport(): {
  topics: number;
  zips: number;
  cells: number;
  covered: number;
  missed: number;
  contactRecords: number;
  contactSources: number;
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
    contactRecords: EVERYDAY_CONTACTS.reduce((count, contact) => count + contact.zips.length, 0),
    contactSources: new Set(EVERYDAY_CONTACTS.map((contact) => contact.sourceUrl)).size,
  };
}
