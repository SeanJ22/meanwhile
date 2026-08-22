/**
 * **RULING 61 — THE BRANCH MANIFEST, AND WHAT EXHAUSTION MEANS**
 * (Adopted 2026-08-21, the author's ruling, NH Hunt 6. Supersedes RULING 58's
 * two-branch bar, which was too low.)
 *
 * `docs/branch-manifest.md` is the document, with the reasoning and the
 * per-route detail. This is the same list made CHECKABLE, because a bar that
 * lives only in prose is a bar each session re-decides on the fly, which is
 * exactly what RULING 61 was adopted to stop.
 *
 * ## What changed, and why two was not enough
 *
 * RULING 52 set the bar at two independent branches. That was a large
 * improvement over the ladder's `unreachable` verdict, and it is still far too
 * low to support the sentence it authorises — *this public person has no
 * campaign site* — which is a claim about a named person under the transparency
 * mandate's evidence standard.
 *
 * Two branches proves almost nothing. Trying thirty-seven routes and stopping
 * does not tell you the forty-third would have failed either; what it tells you
 * is that thirty-seven returned nothing on one date. So exhaustion stops being
 * a COUNT and becomes a NAMED LIST — the same list every time, written down in
 * advance, so no session gets to decide mid-hunt what "we tried everything"
 * meant for the field it happens to be tired of.
 *
 * ## The manifest is a living document that only grows
 *
 * It is never complete, never final, and **being at the end of it is not proof
 * of absence** — only proof that these routes returned nothing on this date. A
 * session that finds a new route ADDS it and applies it retroactively to
 * everything already marked absent, which is why `manifestVersion` is stamped
 * into every absence record: a record earned under `v1` is re-openable the
 * moment `v2` exists.
 *
 * A route is never REMOVED. A route that stops working grows a `retiredOn` and
 * a reason and stays in the list, because the next jurisdiction may hit the
 * same wall from a different side, and because deleting it would let a later
 * session rediscover it as new (RULING 63's duplication defect).
 *
 * ## RULING 60's caveat is built into the shape
 *
 * A branch proven in one place is proven for that SHAPE, not for everywhere.
 * `expectedToTravel` records what this project actually believes about a
 * route's portability, and `subBranches` is where a route that failed somewhere
 * new grows a limb rather than being discarded. A route that stops working is
 * evidence the tree needs another limb, never evidence the fact is
 * unobtainable.
 */

import { type Branch, independentBranchCount, isValidBranch } from "./discovery.ts";

/**
 * The Kelly fields a manifest walk is defined over.
 *
 * **Five, and the fifth needs a word.** RULING 45's Kelly standard names five
 * things — a photo, a phone, a working contact, a specific verified page, and a
 * campaign site. `KELLY_FIELDS` in `lib/ballot/hunt-state.ts` carries FOUR,
 * because phone and working contact are one field on a candidate card
 * (`contact`) and the fifth, the specific verified page, is an OFFICIALS-side
 * field: the page on a body's own site that identifies this person as its
 * member. Both are real and both need a manifest, so this list is the union and
 * the reconciliation is stated rather than left for a later session to trip
 * over.
 */
export const MANIFEST_FIELDS = [
  "photo",
  "blurb",
  "contact",
  "campaignSite",
  "verifiedPage",
] as const;

export type ManifestField = (typeof MANIFEST_FIELDS)[number];

/** One named route to a fact. */
export interface ManifestRoute {
  /** Stable id. Written into absence records, so it never changes meaning. */
  id: string;
  /** What the route IS, in one line. */
  what: string;
  /** How it is reached — the concrete step a session takes. */
  how: string;
  /** What it typically yields when it hits. */
  yields: string;
  /** The canonical retrieval rung from `CLAUDE.md` this route is walked at. */
  rung: string;
  /**
   * What the route depends on — a host, a vendor, a publisher class. This is
   * `Branch.through`, and it is how independence is counted. Two routes sharing
   * one of these are ONE route for independence purposes.
   */
  through: string;
  /** Which fields this route can produce. */
  fields: readonly ManifestField[];
  /**
   * What this project believes about whether the route travels to other
   * jurisdictions — RULING 60. Honest uncertainty is the usual answer.
   */
  expectedToTravel: string;
  /**
   * Limbs grown where the route failed somewhere new. RULING 60: a branch that
   * fails in a new jurisdiction grows a sub-branch rather than being discarded.
   */
  subBranches?: readonly { where: string; on: string; instead: string }[];
  /**
   * A route that stopped working keeps its place with a dated note. It is never
   * deleted, and it is never counted toward exhaustion once retired.
   */
  retiredOn?: string;
  retiredBecause?: string;
  /**
   * Where a route is forbidden for a field it could otherwise supply. The photo
   * doors are the live case: a newspaper is an excellent route to a blurb and a
   * phone number, and its photographs are the demand-letter class no door
   * reaches.
   */
  forbiddenFor?: readonly ManifestField[];
}

/**
 * **THE MANIFEST, v1.** Append-only. Ids are permanent.
 *
 * Ordering is by family, not by priority — a manifest walk has no priority,
 * because the whole point is that all of it gets walked. Where a session wants
 * an order for its own convenience, cheapest-first is fine and changes nothing.
 */
export const MANIFEST_VERSION = "v1";

export const MANIFEST_ROUTES: readonly ManifestRoute[] = [
  /* ── The filed record ─────────────────────────────────────────────────── */
  {
    id: "filing-state",
    what: "The state's own candidate filing — the Secretary of State or state election division",
    how: "The state filing list for the cycle, per office. NH: sos.nh.gov's 2026 filing list (walled at rung 2 and 3 as of 2026-08-21 — rung 5 reaches it).",
    yields: "Filed name, filed mailing address, party, office, town of residence; occasionally a phone",
    rung: "5 (a different egress; rung 2 refuses)",
    through: "state election authority",
    fields: ["contact"],
    expectedToTravel:
      "The INSTITUTION travels — every state has one. The route does not: fifty different sites, formats and access postures, and NJ/AZ each need their own walk.",
  },
  {
    id: "filing-county",
    what: "The county's own filing or election office record",
    how: "County clerk / county election office candidate list for the cycle",
    yields: "The same fields as the state filing, sometimes with a contact the state list omits",
    rung: "2",
    through: "county government",
    fields: ["contact", "campaignSite"],
    expectedToTravel:
      "Uneven. New England counties are thin; NJ and AZ counties run their own elections and publish more.",
  },
  {
    id: "filing-town-clerk",
    what: "The town or city clerk's record",
    how: "The clerk's page, the posted filing period notice, the checklist supervisors' notice, or the clerk by phone",
    yields:
      "Local-office candidates the county and state never list at all, plus addresses and often a phone",
    rung: "2, escalating to 13 (the body's own records request path)",
    through: "municipal clerk",
    fields: ["contact", "campaignSite"],
    expectedToTravel:
      "Strong in New England town government, where the clerk is the record. Weaker where a county runs everything.",
  },
  {
    id: "filing-campaign-finance-state",
    what: "State campaign-finance filings — receipts and expenditures reports",
    how: "The state's finance portal, by candidate or committee name",
    yields:
      "A committee address, a treasurer's name, frequently a phone and an email that appear nowhere else",
    rung: "2",
    through: "state campaign finance authority",
    fields: ["contact"],
    expectedToTravel:
      "The institution is universal; thresholds are not — a small local candidate may file nothing.",
  },
  {
    id: "filing-fec",
    what: "FEC filings for a federal candidate — Form 2 Statement of Candidacy, Form 1 Statement of Organization",
    how: "docquery.fec.gov / the FEC API by candidate id",
    yields: "Committee street address, phone and email, and the treasurer",
    rung: "2 (wired — see lib/sources)",
    through: "fec.gov",
    fields: ["contact"],
    expectedToTravel: "Nationally, exactly. Federal candidates only.",
  },
  {
    id: "filing-ethics-disclosure",
    what: "State ethics or financial-disclosure filings",
    how: "The state ethics commission's public filing search",
    yields: "An employer, a business address, sometimes a professional listing that leads onward",
    rung: "2",
    through: "state ethics authority",
    fields: ["contact"],
    expectedToTravel: "Varies sharply — some states publish these, some make them request-only.",
  },
  {
    id: "filing-prior-candidacy",
    what: "The same person's records from an EARLIER cycle",
    how: "Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11",
    yields:
      "A campaign site that has since lapsed, an email still in use, a portrait published under a door",
    rung: "2 and 11",
    through: "prior-cycle records",
    fields: ["photo", "blurb", "contact", "campaignSite"],
    expectedToTravel:
      "Everywhere, and it is systematically under-used. A first-time candidate has none, which is itself information.",
  },
  {
    id: "voter-file-extract",
    what: "The public voter file or checklist extract",
    how: "The state's public voter-list request, or a town's posted checklist",
    yields: "Confirms a residence and a district; never a phone, and never published wholesale here",
    rung: "13",
    through: "state voter registration authority",
    fields: ["contact"],
    expectedToTravel:
      "Legally uneven and slow. It is a named route because it exists, not because it is often the right one.",
  },

  /* ── The body's own publication ───────────────────────────────────────── */
  {
    id: "body-roster-page",
    what: "The body's own roster or membership page, where the person holds or held office",
    how: "The body's site, its members page, its department page",
    yields:
      "An official portrait (door 2), a term, an official email and phone, and the specific verified page itself",
    rung: "2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup",
    through: "the body's own host",
    fields: ["photo", "contact", "verifiedPage"],
    expectedToTravel:
      "Universal in principle. The CMS families change everything in practice — see the playbook's VTS, Apptegy, CivicPlus and TownCloud entries.",
    subBranches: [
      {
        where: "Kearsarge Regional School District, 2026-08-21",
        on: "the roster page's visible cells carry no email",
        instead: "read the cell's own href — nine board emails were in mailto: links (rung 4)",
      },
    ],
  },
  {
    id: "legislative-directory",
    what: "The state legislature's own member directory",
    how: "NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21.",
    yields: "An official portrait, a district, a committee list, a legislative email and phone",
    rung: "2",
    through: "state legislature",
    fields: ["photo", "contact", "verifiedPage"],
    expectedToTravel:
      "Every state has one. NH publishes NO House portrait and a Senate portrait per SEAT rather than per person — see the playbook.",
  },
  {
    id: "town-report",
    what: "The town's annual report",
    how: "The town site's reports archive, as a PDF — rung 9, text layer first, OCR when scanned",
    yields:
      "Every officer and committee member the town has, with terms; acknowledgements naming people no roster does; occasionally addresses",
    rung: "9",
    through: "municipal publication",
    fields: ["contact", "verifiedPage", "blurb"],
    expectedToTravel:
      "A New England institution above all. A township elsewhere may publish nothing like it; a county may publish an annual report that serves the same purpose.",
  },
  {
    id: "minutes-naming-them",
    what: "Minutes of the body, or of another body, that name the person",
    how: "The minutes archive, searched for the name — rung 9 for PDFs, rung 12 for a vendor portal",
    yields:
      "Confirms a seat and a term; a school board's minutes name the parents who later run; sometimes an address read into the record",
    rung: "9 and 12",
    through: "the body's own minutes",
    fields: ["verifiedPage", "contact"],
    expectedToTravel: "Universal, and slow. It is the route that finds people nothing else names.",
  },
  {
    id: "gov-staff-directory",
    what: "Any .gov staff or official directory the person appears in",
    how: "The municipal, county or state directory page",
    yields: "A portrait shippable at door 2 or door 4, a work phone, an official email",
    rung: "2",
    through: "government directory",
    fields: ["photo", "contact", "verifiedPage"],
    expectedToTravel:
      "Wide. Anything on a .gov site is official by the author's ruling, which makes door 4 unusually reachable here.",
  },

  /* ── The campaign's own presence ──────────────────────────────────────── */
  {
    id: "campaign-site",
    what: "The campaign's own domain",
    how: "Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate",
    yields:
      "A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself",
    rung: "2, then 6 where the site is a JavaScript build",
    through: "the campaign's own domain",
    fields: ["photo", "blurb", "contact", "campaignSite"],
    expectedToTravel: "Everywhere a candidate has bought a domain, which in small races is a minority.",
  },
  {
    id: "campaign-social",
    what: "The campaign's social presence — Facebook, X, Instagram, LinkedIn, Bluesky, YouTube, TikTok",
    how: "Opened in a LIVE BROWSER at rung 6 and read, never trusted from a search snippet",
    yields:
      "The candidate's own words; an email and phone in the page's own contact block; the link field naming a site nothing else names",
    rung: "6",
    through: "the social platform",
    fields: ["blurb", "contact", "campaignSite"],
    forbiddenFor: ["photo"],
    expectedToTravel:
      "Everywhere, and it MATTERS MOST in the smallest races — a campaign that lives on Facebook still has a campaign site, and recording that as nothing penalises exactly the candidates least able to buy a domain.",
    subBranches: [
      {
        where: "Merrimack County Attorney, 2026-08-21",
        on: "a search snippet carried a plausible-looking bio",
        instead:
          "open the page in a live browser and read it — the snippet is not the source, and a snippet-sourced blurb is a generated claim",
      },
    ],
  },
  {
    id: "donation-platform",
    what: "The donation page — ActBlue, WinRed, Anedot, or the committee's own",
    how: "The platform's candidate page, and the committee disclosure block on it",
    yields: "A committee mailing address, a contact email, and confirmation the campaign is live",
    rung: "2",
    through: "the donation platform",
    fields: ["contact", "campaignSite"],
    expectedToTravel: "Nationally. Absent in races too small to raise money.",
  },
  {
    id: "domain-search",
    what: "A direct search for a campaign domain by candidate name",
    how: "Name-plus-office and name-plus-year domain guesses, plus the search index at rung 10",
    yields: "A site nothing links to",
    rung: "2 and 10",
    through: "the search index",
    fields: ["campaignSite"],
    expectedToTravel: "Everywhere. Cheap, and the one route that finds an unlinked site.",
  },

  /* ── Press ────────────────────────────────────────────────────────────── */
  {
    id: "local-newspaper",
    what: "The local newspaper's coverage",
    how: "The town or county paper's site, searched by name; rung 11 where the archive is paywalled or gone",
    yields:
      "The candidate quoted in their own words; the announcement piece; a campaign contact the paper prints",
    rung: "2 and 11",
    through: "the local press",
    fields: ["blurb", "contact", "campaignSite"],
    forbiddenFor: ["photo"],
    expectedToTravel:
      "Everywhere there is still a paper, which is the shrinking part. Where the paper is dead, rung 11 is the route.",
  },
  {
    id: "candidate-interview",
    what: "A candidate interview or Q&A feature",
    how: "The paper, the local radio or TV station, a community podcast, a chamber forum recording",
    yields:
      "Long-form words of their own, and FREQUENTLY a contact detail a filing does not carry — the interview footer prints an email",
    rung: "2 and 6",
    through: "the interviewing outlet",
    fields: ["blurb", "contact"],
    forbiddenFor: ["photo"],
    expectedToTravel: "Everywhere, and systematically under-used relative to what it yields.",
  },
  {
    id: "lwv-questionnaire",
    what: "A League of Women Voters / Vote411 candidate questionnaire",
    how: "Vote411 by address, or the state LWV's own guide",
    yields:
      "The candidate's own written answers, with a contact block the League collects as a matter of course",
    rung: "2",
    through: "vote411.org",
    fields: ["blurb", "contact", "campaignSite"],
    forbiddenFor: ["photo"],
    expectedToTravel:
      "Nationally, unevenly. It is a QUESTIONNAIRE RESPONSE — an evidenced source class — and not an endorsement, so the advocacy-source prohibition does not reach it.",
  },
  {
    id: "announcement-archive",
    what: "The announcement — the 'X announces a run' item, wherever it landed",
    how: "The paper, the party's own release, the candidate's first social post, rung 11 for a dead page",
    yields: "The campaign's opening self-description, a launch contact, the site as first published",
    rung: "2 and 11",
    through: "the announcement publisher",
    fields: ["blurb", "contact", "campaignSite"],
    forbiddenFor: ["photo"],
    expectedToTravel: "Everywhere. Every campaign starts once.",
  },

  /* ── Organisational and professional ──────────────────────────────────── */
  {
    id: "party-committee-roster",
    what: "The party committee's own roster — town, county or state",
    how: "The committee's site and its officers page",
    yields: "A contact for a candidate who holds a committee office, and the campaign site it links",
    rung: "2",
    through: "the party committee",
    fields: ["contact", "campaignSite"],
    expectedToTravel:
      "Everywhere. A ROSTER is a record; an endorsement LIST is somebody's judgement and is never a position source.",
  },
  {
    id: "employer-listing",
    what: "The employer or professional listing, where public",
    how: "A law-firm bio page, a faculty page, a business site's team page",
    yields: "A work email and a direct phone; a portrait that is NOT shippable under any door",
    rung: "2",
    through: "the employer",
    fields: ["contact"],
    forbiddenFor: ["photo"],
    expectedToTravel: "Everywhere somebody is employed publicly. Silent on the retired and the self-employed.",
  },
  {
    id: "licensing-board",
    what: "A professional licensing board — bar, real estate, medical, insurance, engineering",
    how: "The board's public licensee lookup by name",
    yields: "A business address and phone of record, and a licence status that dates it",
    rung: "2",
    through: "the licensing authority",
    fields: ["contact"],
    expectedToTravel:
      "Nationally, per profession. It is a PUBLIC REGISTER and the address on it is the one the licensee published.",
  },
  {
    id: "bar-directory",
    what: "The state or county bar directory, for an attorney candidate",
    how: "The bar association's member lookup",
    yields: "An office address, a direct phone, an email of record",
    rung: "2",
    through: "the bar association",
    fields: ["contact"],
    expectedToTravel:
      "Every state has a bar. It reaches only lawyers — but county-attorney and judicial races are full of them, which is where it earns its place.",
  },
  {
    id: "business-registry",
    what: "The Secretary of State's corporate registry",
    how: "Business-entity search by the person's name as officer, agent or incorporator",
    yields: "A registered address and a phone, and the business that leads to an employer listing",
    rung: "2",
    through: "state corporate registry",
    fields: ["contact"],
    expectedToTravel: "All fifty states run one. Formats differ; the institution does not.",
  },
  {
    id: "nonprofit-filing",
    what: "IRS Form 990 and state charity filings where the person is an officer or director",
    how: "ProPublica Nonprofit Explorer or the state charities registry, by name",
    yields: "An organisation address, and a role that a bio never mentions",
    rung: "2",
    through: "irs 990 filings",
    fields: ["contact"],
    expectedToTravel: "Nationally, exactly — it is federal.",
  },
  {
    id: "civic-organisation",
    what: "A civic, fraternal or service organisation listing — Rotary, Lions, Grange, VFW, historical society, library trustees",
    how: "The organisation's officers page or newsletter",
    yields: "A contact, and confirmation of a name that a small town knows and no register does",
    rung: "2",
    through: "the civic organisation",
    fields: ["contact"],
    expectedToTravel:
      "Small-town America broadly. It is the route RULING 57's twigs are actually reachable through.",
  },
  {
    id: "congregation-listing",
    what: "A church or congregation listing naming the person",
    how: "The congregation's own site, its officers or council page",
    yields: "A contact, occasionally the only published one",
    rung: "2",
    through: "the congregation",
    fields: ["contact"],
    expectedToTravel:
      "Broad but shallow. Named because it exists and has yielded elsewhere; walked with care, since a person's congregation is not a fact this product publishes.",
  },
  {
    id: "chamber-directory",
    what: "A chamber of commerce or local business directory",
    how: "The chamber's member directory by name and by business",
    yields: "A business phone and address",
    rung: "2",
    through: "the chamber of commerce",
    fields: ["contact"],
    expectedToTravel: "Everywhere there is a chamber, which is most places.",
  },
  {
    id: "professional-directory",
    what: "LinkedIn and general professional directories",
    how: "The public profile, read at rung 6",
    yields: "An employer, a history, occasionally a site link; rarely a direct contact",
    rung: "6",
    through: "the professional directory",
    fields: ["campaignSite", "contact"],
    forbiddenFor: ["photo", "blurb"],
    expectedToTravel:
      "Everywhere, weakly. Login walls are named, not defeated, and a profile is not the person's words about their candidacy.",
  },
  {
    id: "alumni-obituary-archive",
    what: "Alumni notes, announcement and obituary archives naming the person or their family",
    how: "The institution's class notes, the paper's announcements archive, rung 11 where it is gone",
    yields: "A hometown, a maiden name, an employer, a family connection that unlocks another route",
    rung: "2 and 11",
    through: "the archive publisher",
    fields: ["contact"],
    forbiddenFor: ["photo", "blurb"],
    expectedToTravel:
      "Everywhere, as a BRIDGE route. It rarely produces a Kelly field directly and often produces the key to one.",
  },
  {
    id: "prior-employer-release",
    what: "A prior employer's press release naming the person",
    how: "The employer's newsroom, searched by name; rung 11 where the release is gone",
    yields:
      "A described role in the employer's words (never the candidate's), and a media contact that sometimes reaches them",
    rung: "2 and 11",
    through: "the prior employer",
    fields: ["contact"],
    forbiddenFor: ["photo", "blurb"],
    expectedToTravel: "Everywhere somebody has worked somewhere that publishes.",
  },

  /* ── Retrieval-shaped routes that are genuinely separate branches ─────── */
  {
    id: "search-index",
    what: "The search index itself, worked as a route rather than as a reflex",
    how: "Quoted name plus office, plus town, plus `site:` against each candidate host in turn",
    yields: "A page no other route names",
    rung: "10",
    through: "the search index",
    fields: ["photo", "blurb", "contact", "campaignSite", "verifiedPage"],
    expectedToTravel: "Everywhere. Cheapest route in the manifest, and never sufficient on its own.",
  },
  {
    id: "web-archive",
    what: "The Internet Archive, of any route above that is now dead",
    how: "Snapshot URLs at rung 11, against the exact dead path",
    yields:
      "A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait",
    rung: "11",
    through: "web.archive.org",
    fields: ["photo", "blurb", "contact", "campaignSite", "verifiedPage"],
    expectedToTravel:
      "Everywhere. It has already produced a shipped portrait here (Harold French's Senate portrait, from a 2022 capture).",
  },
  {
    id: "records-request",
    what: "The body's own public-records request path, walked as a named route",
    how: "The statutory request, filed and recorded with its date",
    yields: "What the body holds and has not published",
    rung: "13",
    through: "the body's records officer",
    fields: ["contact", "verifiedPage"],
    expectedToTravel:
      "Every state has a records law. It is SLOW, which is a reason to file it early in a hunt and never a reason to skip it.",
  },
] as const;

/* ────────────────────────── Reading the manifest ─────────────────────────── */

/** Every route that is live (not retired) and can produce this field. */
export function routesFor(field: ManifestField): ManifestRoute[] {
  return MANIFEST_ROUTES.filter(
    (r) =>
      r.retiredOn === undefined &&
      r.fields.includes(field) &&
      !(r.forbiddenFor ?? []).includes(field),
  );
}

/** The route ids a full manifest walk of this field must carry. */
export function requiredRouteIds(field: ManifestField): string[] {
  return routesFor(field)
    .map((r) => r.id)
    .sort();
}

/** How many routes each field's manifest names. Reported, never assumed. */
export function routeCounts(): Record<ManifestField, number> {
  const out = {} as Record<ManifestField, number>;
  for (const f of MANIFEST_FIELDS) out[f] = routesFor(f).length;
  return out;
}

/**
 * A branch record carrying the manifest route it walked.
 *
 * `route` is a `ManifestRoute.id`. A branch with no `route` is still a valid
 * branch — a session may walk something the manifest has not named yet, and
 * that is how the manifest grows — but it cannot count toward exhaustion,
 * because exhaustion is defined against the NAMED list.
 */
export interface ManifestBranch extends Branch {
  route?: string;
}

export interface ManifestWalk {
  field: ManifestField;
  branches: readonly ManifestBranch[];
  checkedAt: string;
  /** The manifest version this walk was judged against. */
  manifestVersion: string;
}

export interface ManifestVerdict {
  exhausted: boolean;
  required: string[];
  walked: string[];
  missing: string[];
  /** Routes walked that the manifest does not name — candidates for v-next. */
  unnamed: string[];
  independent: number;
  /** Set when a branch FOUND the thing: an absence claim is not available. */
  found: boolean;
  /** Set when the walk was judged against an older manifest than the live one. */
  staleManifest: boolean;
  reason: string;
}

/**
 * **Has this field's manifest been walked to the end?**
 *
 * RULING 61 in one function. Every live route for the field, walked, named and
 * dated, every one returning nothing. Not a count.
 *
 * The verdict is deliberately verbose rather than boolean: a session that comes
 * up short needs to be told WHICH routes it has not walked, because the useful
 * output of a failed exhaustion check is a work list.
 */
export function judgeManifestWalk(walk: ManifestWalk): ManifestVerdict {
  const required = requiredRouteIds(walk.field);
  const valid = walk.branches.filter(isValidBranch);
  const found = valid.some((b) => b.found);

  const walked: string[] = [];
  const unnamed: string[] = [];
  for (const b of valid as ManifestBranch[]) {
    if (typeof b.route !== "string" || b.route.trim() === "") continue;
    if (required.includes(b.route)) walked.push(b.route);
    else if (!MANIFEST_ROUTES.some((r) => r.id === b.route)) unnamed.push(b.route);
  }
  const walkedSet = [...new Set(walked)].sort();
  const missing = required.filter((id) => !walkedSet.includes(id));
  const independent = independentBranchCount(valid);
  const staleManifest = walk.manifestVersion !== MANIFEST_VERSION;

  let reason: string;
  if (found) {
    reason = "a branch found the thing — an absence claim is not available here";
  } else if (staleManifest) {
    reason = `walked against manifest ${walk.manifestVersion}; the live manifest is ${MANIFEST_VERSION}, so this is re-openable`;
  } else if (missing.length > 0) {
    reason = `${missing.length} of ${required.length} manifest routes not yet walked: ${missing.join(", ")}`;
  } else {
    reason = `every one of the ${required.length} routes named by manifest ${MANIFEST_VERSION} returned nothing on ${walk.checkedAt} — which is what these routes measured on that date, and is never proof the fact does not exist`;
  }

  return {
    exhausted: !found && !staleManifest && missing.length === 0 && valid.length > 0,
    required,
    walked: walkedSet,
    missing,
    unnamed: [...new Set(unnamed)].sort(),
    independent,
    found,
    staleManifest,
    reason,
  };
}

/**
 * **The manifest is incomplete, and that sentence ships with every verdict.**
 *
 * RULING 61 item 4. Being at the end of the manifest is not proof of absence —
 * only proof that these routes returned nothing on this date. This string is
 * the standing wording, kept in one place so no surface has to re-say it and no
 * session can quietly say something stronger.
 */
export const MANIFEST_INCOMPLETENESS_NOTE =
  "This manifest is incomplete and always will be. Reaching the end of it is " +
  "not proof that a fact does not exist — it is proof that these named routes " +
  "returned nothing on this date. We do not know what we do not know; there " +
  "are always more ways.";
