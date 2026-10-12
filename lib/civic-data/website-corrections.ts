/** Establishes which site is a government's; it never attributes a calendar on that site to a board. */

/** Byte-identical to the citation already stored on corrected rows. */
export const WEBSITE_CORRECTION_AUTHORIZATION =
  "Owner decision C15, recorded 2026-09-24T22:43Z in the session closeout list: authorize the additional evidence for the website field only; the official homepage and federal .gov registry must identify the same government; record the evidence and the actual reviewer.";

export const WEBSITE_CORRECTION_CITATION = "C15: owner decision recorded 2026-09-24T22:43Z (website field only)" as const;

export const WEBSITE_CORRECTION_REVIEWER = "RouteTask agent session (Claude Code, claude-opus-5-5)";

export const DOTGOV_REGISTRY_URL = "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv";

export interface RegistryEvidence {
  readonly domain: string;
  readonly domainType: string;
  readonly organization: string;
  readonly city: string;
  readonly state: string;
  readonly source: { readonly url: string; readonly sha256: string; readonly readAt: string };
}

export interface HomepageEvidence {
  readonly url: string;
  readonly title: string;
  readonly selfName: string;
  readonly sha256: string;
  readonly readAt: string;
}

export interface OtherEvidence {
  readonly kind: "STATE_LISTING" | "STATE_PUBLICATION" | "COUNTY_PAGE" | "MEMBER_TOWN_PAGE" | "FEDERAL_LISTING" | "RECORDED_HOST_REDIRECT";
  readonly publisher: string;
  readonly url: string;
  readonly quote: string;
  readonly sha256: string;
  readonly readAt: string;
}

export interface WebsiteCorrection {
  readonly jurisdictionId: string;
  readonly governmentName: string;
  readonly recorded: string;
  readonly corrected: string;
  /** Null when the site is not .gov. */
  readonly registry: RegistryEvidence | null;
  readonly homepage: HomepageEvidence | null;
  readonly other: readonly OtherEvidence[];
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

/** Case, punctuation and spacing aside; the registry's inverted form ("Town of X" as "X, Town of") reads the same. */
export function normalizedGovernmentName(name: string): string {
  const flat = name.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9, ]/g, " ").replace(/\s+/g, " ").trim();
  const inverted = /^(.+?),\s*(CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|COUNTY)\s+OF$/.exec(flat);
  return (inverted ? `${inverted[2]} OF ${inverted[1]}` : flat).replace(/,/g, "").replace(/\s+/g, " ").trim();
}

export function governmentNamesMatch(a: string, b: string): boolean {
  return normalizedGovernmentName(a) !== "" && normalizedGovernmentName(a) === normalizedGovernmentName(b);
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const bareHost = (host: string): string => host.replace(/^www\./, "");

export function registryIsTheSitesOwn(correction: Pick<WebsiteCorrection, "corrected" | "registry">): boolean {
  const host = hostOf(correction.corrected);
  return host !== null && correction.registry !== null && bareHost(host) === correction.registry.domain.toLowerCase();
}

/** Why a correction does not meet the rule, one sentence each; empty when it does. */
export function websiteCorrectionIssues(c: WebsiteCorrection): readonly string[] {
  const issues: string[] = [];
  const who = c.jurisdictionId;
  const host = hostOf(c.corrected);
  if (host === null || !/^https:\/\/[^/]+$/.test(c.corrected)) issues.push(`${who}: the corrected site ${c.corrected} is not a bare https origin`);
  const recordedHost = hostOf(/^[a-z]+:\/\//i.test(c.recorded) ? c.recorded : `http://${c.recorded}`);
  if (host !== null && recordedHost !== null && bareHost(host) === bareHost(recordedHost)) issues.push(`${who}: the corrected site is the recorded one`);
  if (c.reviewedBy.trim() === "" || !Number.isFinite(Date.parse(c.reviewedAt))) issues.push(`${who}: no reviewer and review time recorded`);

  const homepageNames = c.homepage !== null && governmentNamesMatch(c.homepage.selfName, c.governmentName);
  if (c.homepage !== null && !homepageNames) issues.push(`${who}: the homepage names "${c.homepage.selfName}", not ${c.governmentName}`);
  const registryNames = c.registry !== null && registryIsTheSitesOwn(c) && governmentNamesMatch(c.registry.organization, c.governmentName);
  if (c.registry !== null && registryIsTheSitesOwn(c) && !registryNames) {
    issues.push(`${who}: the registry lists ${c.registry.domain} for "${c.registry.organization}", not ${c.governmentName}`);
  }
  /* A source that names a different government is a conflict, and no other evidence outweighs it. */
  if (issues.length > 0) return issues;
  if (homepageNames && registryNames) return issues;
  const otherHolds = c.other.some((o) => o.kind !== "RECORDED_HOST_REDIRECT" && o.quote.trim() !== "" && /^[0-9a-f]{64}$/.test(o.sha256));
  if (!otherHolds) {
    issues.push(
      `${who}: UNRESOLVED — ${c.registry === null ? "the site is not .gov" : registryIsTheSitesOwn(c) ? "its homepage could not be read to confirm the registry" : `the registry row is ${c.registry.domain} (${c.registry.organization}), a parent, not the government`}` +
        `${c.homepage === null && !registryIsTheSitesOwn(c) ? ", its homepage could not be read" : ""}, and no other government's publication names the site as ${c.governmentName}'s`,
    );
  }
  return issues;
}

export function websiteCorrectionListIssues(list: readonly WebsiteCorrection[]): readonly string[] {
  const issues = list.flatMap(websiteCorrectionIssues);
  const ids = list.map((c) => c.jurisdictionId);
  if (new Set(ids).size !== ids.length) issues.push("a jurisdiction is corrected twice");
  return issues;
}

export function applicableWebsiteCorrections(list: readonly WebsiteCorrection[]): ReadonlyMap<string, WebsiteCorrection> {
  return new Map(list.filter((c) => websiteCorrectionIssues(c).length === 0).map((c) => [c.jurisdictionId, c] as const));
}

export interface WebsiteAddressCorrectionNote {
  readonly recorded: string;
  readonly corrected: string;
  readonly basis: "HOMEPAGE_AND_REGISTRY" | "OTHER_GOVERNMENT_PUBLICATION";
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reading: "REVIEWED" | "APPLIED_VERIFIED" | "APPLIED_ON_REVIEWED_EVIDENCE" | "REFUSED";
  readonly detail?: string;
  readonly authorization: typeof WEBSITE_CORRECTION_CITATION;
}

function addressKey(address: string): string {
  const raw = /^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`;
  try {
    const url = new URL(raw);
    return `${bareHost(url.hostname.toLowerCase())}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return address.trim().toLowerCase();
  }
}

/** Applied only while the address on record is still the one it replaces. */
export function websiteCorrectionFor(
  jurisdictionId: string,
  recorded: string | null,
  list: readonly WebsiteCorrection[] = WEBSITE_CORRECTIONS,
): WebsiteCorrection | null {
  if (recorded === null) return null;
  const c = applicableWebsiteCorrections(list).get(jurisdictionId);
  return c !== undefined && addressKey(c.recorded) === addressKey(recorded) ? c : null;
}

export function websiteCorrectionNote(
  c: WebsiteCorrection,
  reading: WebsiteAddressCorrectionNote["reading"],
  detail?: string,
): WebsiteAddressCorrectionNote {
  return {
    recorded: c.recorded,
    corrected: c.corrected,
    basis: c.homepage !== null && c.registry !== null && registryIsTheSitesOwn(c) ? "HOMEPAGE_AND_REGISTRY" : "OTHER_GOVERNMENT_PUBLICATION",
    reviewedBy: c.reviewedBy,
    reviewedAt: c.reviewedAt,
    reading,
    ...(detail === undefined ? {} : { detail }),
    authorization: WEBSITE_CORRECTION_CITATION,
  };
}

export function websiteCorrectionRowIssue(
  row: { readonly id: string; readonly ownWebAddress: string | null; readonly ownWebAddressCorrection?: WebsiteAddressCorrectionNote },
  list: readonly WebsiteCorrection[] = WEBSITE_CORRECTIONS,
): string | null {
  const note = row.ownWebAddressCorrection;
  if (note === undefined) return null;
  const c = applicableWebsiteCorrections(list).get(row.id);
  if (c === undefined) return `${row.id}: carries a website correction the reviewed list does not hold`;
  if (note.recorded !== c.recorded || note.corrected !== c.corrected || note.reviewedBy !== c.reviewedBy || note.reviewedAt !== c.reviewedAt) {
    return `${row.id}: its website correction does not match the reviewed one`;
  }
  const expected = note.reading === "REFUSED" ? c.recorded : c.corrected;
  return row.ownWebAddress === expected ? null : `${row.id}: records ${row.ownWebAddress ?? "no address"} under a ${note.reading} correction`;
}

export function websiteCorrectionReceiptIssue(
  receipt: { readonly sourceId: string; readonly requestedUrl: string; readonly finalUrl: string; readonly httpStatus: number; readonly retrievedAt: string; readonly rawHash: string; readonly byteCount: number },
  list: readonly WebsiteCorrection[] = WEBSITE_CORRECTIONS,
): string | null {
  const id = receipt.sourceId;
  let expectedUrl: string | null = null;
  let expectedHost: string | null = null;
  if (id === "website-correction:dotgov-registry") {
    expectedUrl = DOTGOV_REGISTRY_URL;
    expectedHost = hostOf(DOTGOV_REGISTRY_URL);
  } else {
    const m = /^website-correction:(.+):(homepage|evidence-(\d+))$/.exec(id);
    const c = m === null ? undefined : applicableWebsiteCorrections(list).get(m[1]);
    if (m !== null && c !== undefined) {
      if (m[2] === "homepage" && c.homepage !== null) {
        expectedUrl = c.homepage.url;
        expectedHost = hostOf(c.corrected);
      } else if (m[3] !== undefined) {
        const o = c.other[Number(m[3])];
        if (o !== undefined && o.kind !== "RECORDED_HOST_REDIRECT") {
          expectedUrl = o.url;
          expectedHost = hostOf(o.url);
        }
      }
    }
  }
  if (expectedUrl === null || expectedHost === null) return `WEBSITE_CORRECTION_RECEIPT_UNKNOWN:${id}`;
  if (receipt.requestedUrl !== expectedUrl) return `WEBSITE_CORRECTION_RECEIPT_REQUEST_MISMATCH:${id}`;
  const final = /^https:\/\//.test(receipt.finalUrl) ? hostOf(receipt.finalUrl) : null;
  if (final === null || bareHost(final) !== bareHost(expectedHost)) return `WEBSITE_CORRECTION_RECEIPT_FINAL_AUTHORITY_MISMATCH:${id}`;
  if (receipt.httpStatus < 200 || receipt.httpStatus >= 300) return `WEBSITE_CORRECTION_RECEIPT_HTTP_STATUS:${id}`;
  if (!/^[a-f0-9]{64}$/.test(receipt.rawHash)) return `WEBSITE_CORRECTION_RECEIPT_RAW_HASH_INVALID:${id}`;
  if (!Number.isInteger(receipt.byteCount) || receipt.byteCount <= 0) return `WEBSITE_CORRECTION_RECEIPT_BYTE_COUNT_INVALID:${id}`;
  if (!Number.isFinite(Date.parse(receipt.retrievedAt))) return `WEBSITE_CORRECTION_RECEIPT_RETRIEVED_AT_INVALID:${id}`;
  return null;
}

export function homepageStillNamesGovernment(html: string, selfName: string): boolean {
  const flat = (s: string): string =>
    s.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;|&#38;/gi, "&").replace(/\s+/g, " ").toLowerCase();
  const name = flat(selfName).trim();
  return name !== "" && flat(html).includes(name);
}

const CSV_ROW = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else if (ch === "\"") quoted = false;
      else cur += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

export function registryRowFor(csv: string, domain: string): { domainType: string; organization: string; city: string; state: string } | null {
  const lines = csv.split(/\r?\n/);
  const header = CSV_ROW(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const [d, t, o, c, s] = ["domain name", "domain type", "organization name", "city", "state"].map(col);
  if ([d, t, o, c, s].some((i) => i < 0)) return null;
  const want = domain.toLowerCase();
  for (const line of lines.slice(1)) {
    if (!line.toLowerCase().startsWith(want)) continue;
    const row = CSV_ROW(line);
    if ((row[d] ?? "").toLowerCase() === want) return { domainType: row[t] ?? "", organization: row[o] ?? "", city: row[c] ?? "", state: row[s] ?? "" };
  }
  return null;
}

const CISA_READ = {
  url: DOTGOV_REGISTRY_URL,
  sha256: "62de2f534687bced651562d765cb128a4ea1651ba8e7a3d56c43977c48707e4f",
  readAt: "2026-09-24T18:03:54Z",
} as const;

export const WEBSITE_CORRECTIONS: readonly WebsiteCorrection[] = [
  {
    jurisdictionId: "az:city:city-of-cottonwood",
    governmentName: "City of Cottonwood",
    recorded: "http://www.ci.cottonwood.az.us",
    corrected: "https://cottonwoodaz.gov",
    registry: {
      domain: "cottonwoodaz.gov", domainType: "City", organization: "City of Cottonwood", city: "Cottonwood", state: "AZ",
      source: CISA_READ,
    },
    homepage: { url: "https://cottonwoodaz.gov/", title: "Cottonwood, AZ | Official Website", selfName: "City of Cottonwood", sha256: "5356e026e34e97245f13437c8bb5259e0f710625b8fd7c95e1010530fcb62244", readAt: "2026-09-24T18:07:56Z" },
    other: [],
    reviewedBy: WEBSITE_CORRECTION_REVIEWER,
    reviewedAt: "2026-09-24T18:07:56Z",
  },
  {
    jurisdictionId: "az:city:city-of-douglas",
    governmentName: "City of Douglas",
    recorded: "http://www.douglasaz.org",
    corrected: "https://douglasaz.gov",
    registry: {
      domain: "douglasaz.gov", domainType: "City", organization: "City of Douglas", city: "Douglas", state: "AZ",
      source: CISA_READ,
    },
    homepage: { url: "https://douglasaz.gov/", title: "Douglas, AZ | Official Website", selfName: "City of Douglas", sha256: "67c05148743aa126ead48e9d0d038e4378b0d01d14e3b1e80dfbbbbdfeec8c6f", readAt: "2026-09-24T18:08:01Z" },
    other: [],
    reviewedBy: WEBSITE_CORRECTION_REVIEWER,
    reviewedAt: "2026-09-24T18:08:01Z",
  },
  {
    jurisdictionId: "az:city:city-of-eloy",
    governmentName: "City of Eloy",
    recorded: "http://www.ci.eloy.az.us",
    corrected: "https://eloyaz.gov",
    registry: {
      domain: "eloyaz.gov", domainType: "City", organization: "City of Eloy", city: "Eloy", state: "AZ",
      source: CISA_READ,
    },
    homepage: { url: "https://eloyaz.gov/", title: "Eloy, AZ - Official Website | Official Website", selfName: "City of Eloy", sha256: "95606adff5a9f8338b07def65b8564d30076f02ade04aa665bfa29a95c0e19ff", readAt: "2026-09-24T18:08:12Z" },
    other: [],
    reviewedBy: WEBSITE_CORRECTION_REVIEWER,
    reviewedAt: "2026-09-24T18:08:12Z",
  },
  {
    jurisdictionId: "az:city:city-of-holbrook",
    governmentName: "City of Holbrook",
    recorded: "http://www.ci.holbrook.az.us/",
    corrected: "https://holbrookaz.gov",
    registry: {
      domain: "holbrookaz.gov", domainType: "City", organization: "Holbrook, City of", city: "Holbrook", state: "AZ",
      source: CISA_READ,
    },
    homepage: { url: "https://holbrookaz.gov/", title: "City Website - City of Holbrook", selfName: "City of Holbrook", sha256: "7287e9f586e7aff90afc8607ce30ff567b22bb6a821823850de7b5d82109ac78", readAt: "2026-09-24T18:08:23Z" },
    other: [],
    reviewedBy: WEBSITE_CORRECTION_REVIEWER,
    reviewedAt: "2026-09-24T18:08:23Z",
  },
  {
    jurisdictionId: "az:city:city-of-el-mirage",
    governmentName: "City of El Mirage",
    recorded: "http://www.cityofelmirage.org",
    corrected: "https://elmirageaz.gov",
    registry: {
      domain: "elmirageaz.gov", domainType: "City", organization: "City of El Mirage", city: "El Mirage", state: "AZ",
      source: CISA_READ,
    },
    homepage: { url: "https://elmirageaz.gov/", title: "El Mirage, AZ - Official Website | Official Website", selfName: "City of El Mirage", sha256: "f17d17d5166afee4e0d9803c3820af0cbc47f7432a353090ce1f11c99eeeffdf", readAt: "2026-09-24T18:08:06Z" },
    other: [{ kind: "RECORDED_HOST_REDIRECT", publisher: "City of El Mirage", url: "http://www.cityofelmirage.org", quote: "http://www.cityofelmirage.org/ -> 301 -> https://elmirageaz.gov/ (https://www.cityofelmirage.org/ also 301s to the same target)", sha256: "f17d17d5166afee4e0d9803c3820af0cbc47f7432a353090ce1f11c99eeeffdf", readAt: "2026-09-24T18:08:06Z" }],
    reviewedBy: WEBSITE_CORRECTION_REVIEWER,
    reviewedAt: "2026-09-24T18:08:06Z",
  },
  {
    jurisdictionId: "az:city:city-of-flagstaff",
    governmentName: "City of Flagstaff",
    recorded: "http://www.flagstaffaz.gov",
    corrected: "https://www.flagstaff.az.gov",
    registry: {
      domain: "az.gov", domainType: "State or territory", organization: "State of Arizona, Executive Branch", city: "Phoenix", state: "AZ",
      source: { ...CISA_READ, readAt: "2026-09-24T22:56:24Z" },
    },
    homepage: { url: "https://www.flagstaff.az.gov/", title: "City of Flagstaff Official Website | Official Website", selfName: "City of Flagstaff", sha256: "5828ea09673bb6b15cf8b1902be67d198eb6e0a0dca76a5578685c01a42d289d", readAt: "2026-09-24T22:53:59Z" },
    other: [
      {
        kind: "STATE_LISTING",
        publisher: "Superior Court of Arizona in Maricopa County, Law Library Resource Center (the Judicial Branch of Arizona), 'Arizona Cities': links to city government websites",
        url: "https://superiorcourt.maricopa.gov/llrc/arizona-cities/",
        quote: "<li><a href=\"http://www.flagstaff.az.gov/\">Flagstaff</a></li>",
        sha256: "8d561a43212742f8e544d6d10486ec55f9d722c626f10ddeb509890f13a5da5f",
        readAt: "2026-09-24T22:54:23Z",
      },
      {
        kind: "STATE_PUBLICATION",
        publisher: "Arizona Secretary of State, news release of 2025-05-07 on the May Hicks Curtis House",
        url: "https://azsos.gov/news/942",
        quote: "please visit Flagstaff.az.gov/HicksHouse or contact City of Flagstaff Senior Planner Lauren Clementino",
        sha256: "8c9bd7bac823beee04f8fc8783cb14764ea0ac261de2f8b529236e249c1ad67a",
        readAt: "2026-09-24T22:55:35Z",
      },
    ],
    reviewedBy: `${WEBSITE_CORRECTION_REVIEWER}; evidence gathered by its research subagent`,
    reviewedAt: "2026-09-24T23:18:43Z",
  },
  {
    jurisdictionId: "nh:city:town-of-newbury",
    governmentName: "Town of Newbury",
    recorded: "http://www.newburyh.org",
    corrected: "https://www.newbury.nh.gov",
    registry: {
      domain: "nh.gov", domainType: "State or territory", organization: "State of New Hampshire", city: "Concord", state: "NH",
      source: { ...CISA_READ, readAt: "2026-09-24T22:56:24Z" },
    },
    homepage: null,
    other: [
      {
        kind: "STATE_LISTING",
        publisher: "State of New Hampshire, Department of Business and Economic Affairs, Office of Planning and Development, 'Municipalities, Counties and Regions' (links to municipal websites; the State portal's Cities & Towns list)",
        url: "https://www.nheconomy.com/office-of-planning-and-development/what-we-do/state-data-center-(census-data)/municipalities,-counties-and-regions",
        quote: "<td><a href=\"https://www.newbury.nh.gov/\" target=\"_blank\">Newbury</a></td>",
        sha256: "0119595111e5a9453c1aaf16b4eebe911795edbe0bdb005937d8a270a92d4d28",
        readAt: "2026-09-24T22:59:25Z",
      },
    ],
    reviewedBy: `${WEBSITE_CORRECTION_REVIEWER}; evidence gathered by its research subagent`,
    reviewedAt: "2026-09-24T23:18:43Z",
  },
  {
    jurisdictionId: "nh:school:kearsarge-regional-school-dist",
    governmentName: "Kearsarge Regional School District",
    recorded: "http://www.kearsarge.k12.nh.us/",
    corrected: "https://www.kearsarge.org",
    registry: null,
    homepage: null,
    other: [
      {
        kind: "MEMBER_TOWN_PAGE",
        publisher: "Town of Warner, NH (warnernh.gov, registered to the Town of Warner), 'Links of Interest'",
        url: "https://warnernh.gov/links/",
        quote: "href=\"http://www.kearsarge.org/\" >Kearsarge Regional School District SAU #65</a>",
        sha256: "d797103e914466ff606214e7b95a0037a8642c082d4374c2b71c312356d90d40",
        readAt: "2026-09-24T23:07:09Z",
      },
      {
        kind: "MEMBER_TOWN_PAGE",
        publisher: "Town of Bradford, NH (bradfordnh.gov, registered to the Town of Bradford, NH), 'Helpful Links'",
        url: "https://bradfordnh.gov/pages/helpful-links",
        quote: "<a href=\"http://www.kearsarge.org/\" rel=\"nofollow\" target=\"_blank\">Kearsarge Regional School District</a>",
        sha256: "bcb05248e190512433d945d5adbec7d7785009ac80091b5a72af8d775e3c3bf5",
        readAt: "2026-09-24T23:07:13Z",
      },
    ],
    reviewedBy: `${WEBSITE_CORRECTION_REVIEWER}; evidence gathered by its research subagent`,
    reviewedAt: "2026-09-24T23:18:43Z",
  },
];

export interface UnresolvedWebsiteCase {
  readonly jurisdictionId: string;
  readonly governmentName: string;
  readonly recorded: string;
  readonly candidate: string;
  readonly why: string;
  readonly wouldResolve: readonly string[];
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export const UNRESOLVED_WEBSITE_CASES: readonly UnresolvedWebsiteCase[] = [
  {
    jurisdictionId: "nh:city:town-of-sutton",
    governmentName: "Town of Sutton",
    recorded: "http://www.sutton-nh.gov",
    candidate: "https://www.suttonnh.gov",
    why:
      "The .gov registry lists suttonnh.gov for the Town of Sutton (its own row), but the homepage answered a Cloudflare " +
      "challenge (HTTP 403) to the robots-first read, so the homepage cannot confirm the registry. No government's own page " +
      "names suttonnh.gov: the State's planning office table, the NH DOT officials directory (September 2025), Merrimack " +
      "County and the Town of Warner all link the town's former sutton-nh.org.",
    wouldResolve: [
      "a readable homepage at www.suttonnh.gov that names the Town of Sutton",
      "any government's own page naming suttonnh.gov",
      "the owner deciding whether a government listing of sutton-nh.org, that address's redirect to www.suttonnh.gov, and the registry row together suffice",
    ],
    reviewedBy: `${WEBSITE_CORRECTION_REVIEWER}; evidence gathered by its research subagent`,
    reviewedAt: "2026-09-24T23:18:43Z",
  },
];
