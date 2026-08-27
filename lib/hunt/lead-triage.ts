/**
 * TRIAGE — deciding which leads are worth opening, and saying why about each.
 * (2026-08-26, the descent-resume session. **RULING 183**, **RULING 88**.)
 *
 * `looksLikeBody` in `descent-walk.ts` is recall-first on purpose, and the cost
 * of that choice is visible in canonical state: of 1,672 leads carried into
 * this session, the sample opened before this file was written contained a
 * Motor Vehicle Commission office-hours line, a Power BI dashboard, a court
 * opinion about a borough, six numbered chapters of Pima County's
 * comprehensive plan, and a school-boards association PDF titled "13 things
 * school board members wish the public knew about them".
 *
 * None of those is a government body. All of them contain a body word.
 *
 * **This file does not delete any of them.** A rejection here is a row that
 * keeps its URL, its provenance edge and a written reason, because RULING 88
 * makes a zero-yield route knowledge and RULING 178 requires a conclusion
 * reached under one detector version to be reopenable by the next. Triage
 * moves a lead OUT of the queue to be opened; it never moves it out of the
 * record.
 *
 * ## What triage may and may not decide
 *
 * It may decide **this link is not a governing body** on evidence visible in
 * the link itself — a file extension, a publisher, a sentence shape.
 *
 * It may NOT decide that something IS a body. Nothing in here promotes:
 * promotion needs a page that was fetched and a control that held, and this
 * file makes no requests. A lead this file leaves alone is a lead that has
 * earned the cost of opening it, and nothing more.
 *
 * ## The publisher distinction that mattered most
 *
 * A **government** publishes about itself. An **association of governments**
 * publishes about its members and sells them things. The New Jersey League of
 * Municipalities, the New Jersey School Boards Association, the League of
 * Arizona Cities and Towns, the New Hampshire Municipal Association and the
 * New Hampshire School Boards Association are private membership
 * organisations, and the descent walked all five as though they were tiers of
 * government.
 *
 * That is a genuinely useful thing to have walked — `njlm.org` is where 208 New
 * Jersey municipalities own websites were found, which is a route worth
 * keeping — but the association's OWN pages are its own, and a "Municipal
 * Marketplace" advertising page is not a unit of government. So the rule is
 * about the TARGET's publisher, never about where the link was found: a lead
 * pointing off-host at `aberdeennj.org` survives, and a lead pointing at the
 * association's own PDF does not.
 *
 * A party caucus office is the same shape and is rejected for a second,
 * independent reason: `assemblydems.com` and `njassemblygop.com` are partisan
 * organs, and this product does not render a party's self-description as a
 * governing body.
 */

/** A lead as triage sees it — no more than the walk recorded. */
export interface Lead {
  readonly text: string;
  readonly url: string;
}

export interface TriageVerdict {
  /** `false` means: do not spend a fetch on this. It is not a body. */
  readonly keep: boolean;
  /** The rule that spoke, for calibration. */
  readonly rule: string;
  /** Written for a person deciding whether the detector is right. */
  readonly reason: string;
}

/**
 * Hosts that are membership associations or party organs, not governments.
 *
 * Matched as a HOST SUFFIX, never as a substring of the whole URL: `njlm.org`
 * appearing in a query string is not the publisher, and a substring test on the
 * full URL is the same mistake that made 214 calendar day-numbers into
 * candidates when the slug fallback read the hostname.
 */
const NOT_A_GOVERNMENT_PUBLISHER: readonly { host: string; what: string }[] = [
  { host: "njlm.org", what: "the New Jersey League of Municipalities, a private membership association of municipalities" },
  { host: "njsba.org", what: "the New Jersey School Boards Association, a private membership association of school boards" },
  { host: "azleague.org", what: "the League of Arizona Cities and Towns, a private membership association of cities" },
  { host: "nhmunicipal.org", what: "the New Hampshire Municipal Association, a private membership association of municipalities" },
  { host: "nhsba.org", what: "the New Hampshire School Boards Association, a private membership association of school boards" },
  { host: "nhcounties.org", what: "the New Hampshire Association of Counties, a private membership association of counties" },
  { host: "assemblydems.com", what: "a partisan legislative caucus office, not a body of government" },
  { host: "njassemblygop.com", what: "a partisan legislative caucus office, not a body of government" },
  { host: "azjudges.info", what: "a campaign-style information site, not the commission's own publication" },
];

/** Media and third-party embeds. A picture of a board is not a board. */
const NOT_A_DOCUMENT_HOST: readonly { host: string; what: string }[] = [
  { host: "vimeo.com", what: "a video host" },
  { host: "youtube.com", what: "a video host" },
  { host: "youtu.be", what: "a video host" },
  { host: "powerbi.com", what: "a third-party dashboard embed" },
  { host: "twitter.com", what: "a social network" },
  { host: "x.com", what: "a social network" },
];

/** Extensions that cannot be a body's own page under any reading. */
const ASSET_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".mp4",
  ".mp3",
  ".zip",
  ".xlsx",
  ".csv",
];

/**
 * Link texts that are a site's navigation furniture rather than a body's name.
 *
 * Matched WHOLE, after normalisation, and that is the load-bearing part: a
 * lead reading exactly "departments" is a menu, and a lead reading "department
 * of environmental services" is a department. A substring rule here would
 * reject the second along with the first, which is how a triage pass quietly
 * becomes the thing that loses the water authority.
 */
const NAVIGATION_LABELS: readonly string[] = [
  "agency",
  "agencies",
  "agency directory",
  "agency list",
  "all agencies",
  "departments",
  "departments/agencies",
  "department directory",
  "all departments",
  "divisions",
  "divisions & offices",
  "divisions and offices",
  "boards",
  "boards+",
  "boards & commissions",
  "boards and commissions",
  "authorities, boards and commissions",
  "committees",
  "commissions",
  "about the court",
  "about the department",
  "about the commissioner",
  "about county government",
  "contact a court",
  "contact the department",
  "county maps",
  "county navigation",
  "county college",
  "board members",
  "board governance",
  "board member academy",
  "governing board",
  "our board",
  "meet the board",
  "district 1",
  "district 2",
  "district 3",
  "district 4",
  "district 5",
];

/** Sentence shapes that are notices, hours, or prose — never an entity name. */
const PROSE_SHAPES: readonly { rx: RegExp; what: string }[] = [
  {
    rx: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\d\s*(a\.m\.|p\.m\.|am|pm)/i,
    what: "an opening-hours line",
  },
  { rx: /\b(closures?|delays?|cancell?ations?)\b/i, what: "a service-disruption notice" },
  { rx: /^\d+(\.\d+)+\s/, what: "a numbered section heading from a plan or report, not an entity" },
  { rx: /^\d{4}(-\d{2,4})?\s+\w/, what: "a year-prefixed document title, not an entity" },
  {
    rx: /\b(welcome to|click here|read more|learn more|opens in a new tab|view all|see all)\b/i,
    what: "navigation or marketing copy",
  },
  { rx: /\b(affirmed|reversed|remanded|v\.)\b/i, what: "a case caption or holding, not a body" },
  {
    rx: /\b(calendar|timeline|schedule|agenda|minutes|handbook|guide to|faq|frequently asked)\b/i,
    what: "a document or schedule published BY a body, not the body",
  },
  { rx: /\b(podcast|video|webinar|newsletter|brochure|image|photo)\b/i, what: "a media item" },
  {
    rx: /\b(best practices|code of ethics|things .* wish|academy|training|membership|marketplace|advertising)\b/i,
    what: "association programme or marketing material",
  },
];

/** Court opinions are cases. The court is the body; the opinion is its output. */
const COURT_OPINION = /\/(court-opinions?|opinions?)\//i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function normalise(text: string): string {
  return text
    .replace(/&#x27;|&rsquo;|&#8217;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Judge one lead.
 *
 * Order matters and is deliberate: publisher first, because a correct-looking
 * body name on an association's site is the most convincing false positive in
 * the pool, and shape last, because the prose rules are the broadest and a
 * broad rule that runs first steals cases from a precise one that would have
 * explained them better.
 */
export function triageLead(lead: Lead): TriageVerdict {
  const text = normalise(lead.text);
  const host = hostOf(lead.url);

  if (!host) {
    return {
      keep: false,
      rule: "unparseable-url",
      reason: `"${lead.url}" is not a parseable URL, so no publisher can be established for it`,
    };
  }

  for (const p of NOT_A_DOCUMENT_HOST) {
    if (hostMatches(host, p.host)) {
      return {
        keep: false,
        rule: "not-a-document-host",
        reason: `published on ${host}, ${p.what} — a body's own record does not live here`,
      };
    }
  }

  for (const p of NOT_A_GOVERNMENT_PUBLISHER) {
    if (hostMatches(host, p.host)) {
      return {
        keep: false,
        rule: "not-a-government-publisher",
        reason: `published by ${p.what}; its own pages describe its members, and are not a unit of government`,
      };
    }
  }

  /* The URL is bound before its path is read. `new URL(x).pathname` is banned
   * repo-wide by the RULING 14 guard in `tests/path-separator.test.ts` — a file
   * URL's pathname is `/C:/...` on Windows and joining it produces `C:C:\...`.
   * These URLs are always http(s) and never file, but the guard is deliberately
   * blind to that, and reaching around a guard is worse than obeying one. */
  const parsedUrl = ((): URL | null => {
    try {
      return new URL(lead.url);
    } catch {
      return null;
    }
  })();
  const path = parsedUrl ? parsedUrl.pathname.toLowerCase() : "";

  for (const ext of ASSET_EXTENSIONS) {
    if (path.endsWith(ext)) {
      return {
        keep: false,
        rule: "asset-not-page",
        reason: `a ${ext} file is an asset published by a body, never the body itself`,
      };
    }
  }

  if (COURT_OPINION.test(path)) {
    return {
      keep: false,
      rule: "court-opinion",
      reason: "a court opinion is a case record; the court that issued it is the body, and this is its output",
    };
  }

  if (!text) {
    return {
      keep: false,
      rule: "no-link-text",
      reason: "the link carried no readable text, so nothing in it names an entity",
    };
  }

  if (NAVIGATION_LABELS.includes(text)) {
    return {
      keep: false,
      rule: "navigation-label",
      reason: `"${text}" is a menu label naming a LIST of bodies, not a body — the list is a route and is walked, the label is not an entity`,
    };
  }

  for (const s of PROSE_SHAPES) {
    if (s.rx.test(text)) {
      return { keep: false, rule: "prose-not-entity", reason: `"${lead.text}" reads as ${s.what}` };
    }
  }

  if (text.length < 5) {
    return { keep: false, rule: "too-short-to-name", reason: `"${text}" is too short to name a body` };
  }

  return {
    keep: true,
    rule: "survives-triage",
    reason: "nothing in the link itself rules it out; it is worth the cost of opening",
  };
}
