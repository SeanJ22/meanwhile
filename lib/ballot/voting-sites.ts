/**
 * **Where a reader can actually vote** — tracker **B19**, and the row's own
 * spec had to change before a line of this could be written.
 *
 * ## The spec that was wrong, and why it matters more than a bug
 *
 * B19 said: the reader enters an address, and *their polling place* drops a
 * pin. That sentence assumes one model of voting, and the three covered
 * states use two of them.
 *
 * * **New Hampshire** and **New Jersey** ASSIGN a voter to a place — NH by
 *   town and ward, NJ by municipal voting district. There is a their.
 * * **Arizona's Pima County** runs **VOTE CENTERS**: any registered voter in
 *   the county may vote at any published site. There is no their. Pinning one
 *   would be a specific false claim about where a named person must go —
 *   exactly the wrong-by-one-street failure the row was written to avoid.
 *
 * So the pin is SITES, plural, and the card names the model. The author's
 * ruling, 2026-08-19: *"the reader learning that their county works
 * differently is the feature, not a caveat."* That is the stranger test doing
 * its job — a person in Tucson and a person in Newbury each get the truth
 * about their own place rather than one of them getting the other's.
 *
 * ## Sourcing law, unmoved
 *
 * Every site comes from the jurisdiction's OWN election authority, cited with
 * a read date. Where the authority publishes no machine-readable answer, the
 * jurisdiction carries a REFUSAL record naming every ladder rung walked and
 * what each returned — never a guess, never a nearest-guess pin. A wall never
 * renders as an emptiness.
 *
 * ## The address is orientation, not identity
 *
 * Resolution runs through `/api/geocode`, which stores nothing and logs
 * nothing (M80). Nothing on this path writes a row. The copy beside the input
 * says so where the reader can read it.
 */

/** How a jurisdiction decides where a voter votes. */
export type VotingModel =
  /** Any registered voter may use any site in the jurisdiction. */
  | "VOTE_CENTER"
  /** The voter is assigned to one site by ward, district or town. */
  | "ASSIGNED";

/** What a site is for. A drop box is not a place to cast a ballot in person. */
export type SiteKind = "ELECTION_DAY" | "EARLY_VOTING" | "MOBILE";

export interface VotingSite {
  /** Stable within a jurisdiction; the join key for the marker pool. */
  id: string;
  name: string;
  /** One line, as the authority publishes it. */
  address: string;
  /** Where in the building, when the authority says. Often the useful half. */
  room: string | null;
  /**
   * NULLABLE, and that is the point. The authority publishes an address; a
   * geocoder either places it or does not. The first cut of the retrieval
   * DROPPED any site it could not place, and 25 real published locations
   * disappeared from a county's list because a cross-street address
   * ("21 Blue Mill Road & Sand Spring Rd") is not something the Census
   * one-line geocoder resolves. A retrieval failure on OUR side may not be
   * written into the data as the authority not having published — that is the
   * refresh corollary, one layer up. So the site stays, with its address, and
   * the card says we could not place it on the map.
   */
  lat: number | null;
  lng: number | null;
  kind: SiteKind;
  /**
   * The election this site is published FOR, in the authority own words, or
   * null where the authority did not label the row. NEVER filled in with the
   * jurisdiction current election: an unlabeled row is not evidence that a
   * location is open for the next election, and a default that supplied one
   * would manufacture exactly the claim a reader would act on.
   */
  election: string | null;
  /**
   * For an ASSIGNED jurisdiction: which wards/districts this site serves, in
   * the authority's own words. Null where the authority does not say, and
   * never inferred — an assignment we guessed is the wrong-by-one-street
   * failure wearing a data model.
   */
  serves: string | null;
}

/** Every rung walked against one jurisdiction, and what it returned. */
export interface SiteRung {
  /** Ladder rung number, `ladder vH-start`. */
  rung: number;
  what: string;
  result: string;
  attemptedAt: string;
}

export interface VotingJurisdiction {
  /** `ocd-division/...` for the jurisdiction whose authority publishes this. */
  ocdId: string;
  /** Reader-facing name. Plain words — never an OCD-ID, never a slug. */
  name: string;
  /** Two-letter postal code, upper case. */
  state: string;
  model: VotingModel;
  /** The election these sites are published for, in the authority's words. */
  election: string | null;
  sites: VotingSite[];
  /** The authority itself. The public body, never a vendor. */
  sourceOrg: string;
  sourceUrl: string;
  /** Saved official page linking a government or vendor site outside .gov (§3). */
  sourceLinkingPage?: import("../civic-data/source-authority.ts").OfficialLinkingPage;
  /** Exact official source bytes for a source-scoped PDF acquisition, when held. */
  sourceRawSha256?: string;
  /** ISO date the retrieval ran. Never a plausible date; always the clock. */
  collectedAt: string;
  /**
   * Present when the retrieval did NOT land a site list. Absence is never
   * asserted: this names the wall and lists every rung with its result.
   */
  refusal: {
    /** What blocked it, named. */
    wall: string;
    rungs: SiteRung[];
  } | null;
}

export interface VotingSitesFile {
  generatedAt: string;
  jurisdictions: VotingJurisdiction[];
}

export const votingSiteAddressKey = (address: string): string => address.toLowerCase().replace(/\s+/g, " ").trim();

/** Reuse a held point only for the same published address; unresolved points retry. */
export function heldVotingSiteCoordinates(file: VotingSitesFile | null): Map<string, { lat: number; lng: number }> {
  const points = new Map<string, { lat: number; lng: number }>();
  const ambiguous = new Set<string>();
  for (const jurisdiction of file?.jurisdictions ?? []) for (const site of jurisdiction.sites) {
    if (site.lat === null || site.lng === null || !Number.isFinite(site.lat) || !Number.isFinite(site.lng)) continue;
    const key = votingSiteAddressKey(site.address);
    if (!key || ambiguous.has(key)) continue;
    const prior = points.get(key);
    if (prior && (prior.lat !== site.lat || prior.lng !== site.lng)) { points.delete(key); ambiguous.add(key); }
    else points.set(key, { lat: site.lat, lng: site.lng });
  }
  return points;
}

/**
 * Counts for the report and for the guard, because an operation that can
 * return nothing must be asked what it returned.
 */
export interface VotingSitesCensus {
  jurisdictions: number;
  withSites: number;
  withRefusal: number;
  sites: number;
  /** Sites the reader can see listed but that carry no point to pin. */
  sitesWithoutPoint: number;
}

/** True when the site can be drawn. Kept in one place so nothing forgets. */
export function isPinnable(
  site: VotingSite,
): site is VotingSite & { lat: number; lng: number } {
  return site.lat !== null && site.lng !== null;
}

export function censusOf(file: VotingSitesFile): VotingSitesCensus {
  return {
    jurisdictions: file.jurisdictions.length,
    withSites: file.jurisdictions.filter((j) => j.sites.length > 0).length,
    withRefusal: file.jurisdictions.filter((j) => j.refusal !== null).length,
    sites: file.jurisdictions.reduce((n, j) => n + j.sites.length, 0),
    sitesWithoutPoint: file.jurisdictions.reduce(
      (n, j) => n + j.sites.filter((s) => !isPinnable(s)).length,
      0,
    ),
  };
}

/**
 * What `/api/voting-sites` answers with.
 *
 * Declared HERE rather than in the route, because the panel renders it and a
 * panel importing a route module drags the route's server graph into the
 * client bundle — the same hazard that put `node:fs` in the browser once
 * already. A shared shape belongs in the shared module.
 */
export interface VotingSitesAnswer {
  match: boolean;
  /** Only ever the resolved POINT, never the address that produced it. */
  point: { lat: number; lng: number } | null;
  jurisdictions: (Omit<VotingJurisdiction, "refusal"> & {
    modelSentence: string;
    refusal: VotingJurisdiction["refusal"];
    refusalLine: string | null;
    /** B16: which of these is the reader's own, or why we will not say. */
    narrowing: Narrowing;
  })[];
  /**
   * True when the point resolved but no covered jurisdiction contains it —
   * a fact about our coverage, not about the reader's county.
   */
  outsideCoverage: boolean;
  /** Canonical official handoff routes, returned by the server data plane. */
  pollingPlaceLinks: readonly import("./polling-place-links.ts").PollingPlaceLink[];
  /** Whether that independent optional link family reached this answer. */
  ballotNavigationDataState?: "PROMOTED" | "FIRST_SEED" | "STORE_UNREACHABLE";
}

/**
 * The sentence for a site the authority published and we could not place.
 *
 * A named gap, in the gap's own register: this is a fact about US. It never
 * reads as "this location does not exist" and it never renders as a missing
 * row — the address is right there for the reader to use.
 */
export const UNPLACED_SITE_LINE =
  "We could not place this address on the map, so it has no pin. The address above is what the county published.";

/**
 * The reader-facing sentence that names the model.
 *
 * LEVEL register — this is a claim surface, and a claim about where a real
 * person may lawfully vote is not a place to be cute. Plain words, no
 * identifiers, no county jargon a stranger would not know.
 */
export function modelSentence(j: VotingJurisdiction): string {
  /*
   * "these locations" when there are none is a render default manufacturing a
   * claim: it points at a list the reader has not been shown. Caught in the
   * page, not in a test — Newbury rendered "Newbury assigns you to one of
   * these locations" above an empty list and a refusal. The model is still
   * worth stating (it is what a stranger needs to know about the place), but
   * it is stated WITHOUT pointing at anything.
   */
  if (j.sites.length === 0) {
    return j.model === "VOTE_CENTER"
      ? `${j.name} runs vote centers: any registered voter may use any site the county opens.`
      : `${j.name} assigns each voter to one location, decided by where they live.`;
  }
  return j.model === "VOTE_CENTER"
    ? `${j.name} lets any registered voter vote at any of these locations. There is no one place you are assigned to.`
    : `${j.name} assigns you to one of these locations. Which one depends on where you live, so check the location that names your ward or district.`;
}

/**
 * The honest line for a jurisdiction whose sites we could not retrieve.
 *
 * A failed retrieval reports as a failed retrieval. This never says "no
 * polling places" and it never renders as an empty list — the sentence is
 * about US, not about them.
 */
export function refusalLine(j: VotingJurisdiction): string {
  return `We could not retrieve ${j.name}'s voting locations from ${j.sourceOrg}. `;
}

/**
 * **B16 — narrowing to the reader's OWN assigned location, or refusing to.**
 *
 * B19 answers "where can I vote". B16 is the deeper question: in a
 * jurisdiction that ASSIGNS you, which one is yours? The row's own reasoning
 * is why this function exists rather than a resolver: *a polling place wrong
 * by one street is worse than a link*, so the honest-refusal path is what
 * makes the feature shippable at all.
 *
 * Three answers, and each one is a fact about a real jurisdiction:
 *
 * * **NOT_NEEDED** — a vote-center county. There is no assignment to narrow.
 *   Pima is not a gap; it is a different model, and saying "we could not find
 *   your polling place" there would be false.
 * * **EXACT** — the jurisdiction publishes exactly one place. A New Hampshire
 *   town with a single polling place has already answered the question, and
 *   no geometry is needed to say so.
 * * **REFUSED** — the jurisdiction assigns among several and we cannot prove
 *   which is the reader's. The rungs say why. **New Jersey is the case**: the
 *   state's own Office of GIS publishes statewide election districts, and the
 *   layer's data was last edited in November 2021 — five years before the
 *   election these polling places are published for, and marked "MATURE
 *   SUPPORT" by its publisher. Districts get redrawn. Computing an assignment
 *   from it would produce a confident, checkable, possibly false claim about
 *   where a named person must go, which is precisely what this row refuses.
 */
export type Narrowing =
  | { kind: "NOT_NEEDED"; sentence: string }
  | { kind: "EXACT"; sentence: string; siteId: string }
  | { kind: "REFUSED"; sentence: string; rungs: SiteRung[] };

/** The rungs walked for New Jersey's precinct geometry, recorded once. */
export const NJ_DISTRICT_RUNGS: SiteRung[] = [
  {
    rung: 12,
    what: "The state's own GIS organisation (NJOGIS) on ArcGIS Online",
    result:
      "HIT — 'Election Districts for New Jersey' and 'Ward Boundaries for New Jersey', statewide polygons with county, municipality, ward and district codes",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 7,
    what: "The layer's own metadata: when was this data last edited",
    result:
      "2021-11-24, and the publisher labels it MATURE SUPPORT. Five years older than the election these polling places are for",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 12,
    what: "Morris County's own GIS for current voting-district geometry",
    result: "No published election-district layer found under the county",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 13,
    what: "The county Board of Elections' public-records request path",
    result:
      "NOT YET WALKED — named so the next session starts here rather than at rung 2",
    attemptedAt: "2026-08-19",
  },
];

export function narrowingFor(j: VotingJurisdiction): Narrowing {
  if (j.model === "VOTE_CENTER") {
    return {
      kind: "NOT_NEEDED",
      sentence:
        "There is no one location assigned to you here, so there is nothing to narrow down. Any of these will do.",
    };
  }
  if (j.sites.length === 0) {
    // Nothing was retrieved, so there is nothing to narrow AMONG. Saying
    // "we cannot tell you which of these is yours" beside an empty list
    // would describe a choice the reader has not been offered — the refusal
    // that belongs here is the retrieval's own, and it is already rendered.
    return {
      kind: "REFUSED",
      sentence: `We have not retrieved any voting location for ${j.name} yet, so there is nothing here to narrow down. What we tried is below.`,
      rungs: [],
    };
  }
  if (j.sites.length === 1) {
    return {
      kind: "EXACT",
      sentence: `${j.name} has one voting location, so this is yours.`,
      siteId: j.sites[0].id,
    };
  }
  return {
    kind: "REFUSED",
    sentence:
      "We cannot yet tell you which of these is yours. The boundaries we would need are older than this election, and a polling place that is wrong by one street is worse than none — so we are showing you all of them instead of guessing. Your sample ballot names your ward and district.",
    rungs: j.state === "NJ" ? NJ_DISTRICT_RUNGS : [],
  };
}

/**
 * An external maps handoff, built from the site's own address.
 *
 * **The one link allowed to leave the app** (B19's spec), because turn-by-turn
 * directions are not something this product does and pretending otherwise
 * would be worse than handing the reader off honestly. Everything else about
 * a site renders here.
 */
export function directionsUrl(site: VotingSite): string {
  const query = `${site.name}, ${site.address}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

/**
 * **VOT-1 (2026-08-25) — NEAREST FIRST, AND NOTHING IS REMOVED.**
 *
 * Sean: *"Where can I vote? returns everywhere in the county — that is correct
 * and stays. The defect is ordering: the top result sits several miles from the
 * entered address."*
 *
 * Both halves matter and they pull in opposite directions, which is why this is
 * a SORT and never a filter. Returning the whole county is the honest answer —
 * a reader may vote at a site across it, and quietly hiding the far ones would
 * be this product deciding on their behalf. But a list whose first row is six
 * miles away when there is one three streets over is a list that answers the
 * question badly while containing the right answer.
 *
 * **This is not an ordering by fit.** The never-rank rule governs CANDIDATES —
 * ordering people by anything but a neutral criterion. Distance from a point
 * the reader typed is as neutral a criterion as ballot order: it is a fact
 * about geography, it is the same for everyone who types that address, and it
 * expresses no judgement about the sites.
 *
 * **An unplaced site keeps its place rather than sinking.** A site the
 * geocoder could not resolve has `lat`/`lng` of null (see `VotingSite`), and
 * sorting it to the bottom would be a retrieval failure on OUR side quietly
 * demoting a location the authority genuinely published — the refresh
 * corollary, one layer up. They hold their published order after the placed
 * ones, with their own named gap already rendered beside them.
 */

/** Great-circle miles between two points. */
export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613; // mean Earth radius, statute miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The ring Sean asked for, in miles.
 *
 * *"Draw a roughly 10-mile radius on the map around the entered address."* His
 * word is *roughly*, and it is recorded as his rather than presented as a
 * derived number — nothing about polling-place law makes ten miles a
 * threshold, and a comment claiming otherwise would be a manufactured basis.
 */
export const NEARBY_RADIUS_MILES = 10;

export interface SiteWithDistance {
  site: VotingSite;
  /** Null where the site could not be placed, or no address point resolved. */
  miles: number | null;
}

/**
 * Order one jurisdiction's sites nearest-first. **Every site comes back.**
 */
export function sitesNearestFirst(
  sites: readonly VotingSite[],
  point: { lat: number; lng: number } | null,
): SiteWithDistance[] {
  const measured = sites.map((site) => ({
    site,
    miles:
      point && typeof site.lat === "number" && typeof site.lng === "number"
        ? milesBetween(point, { lat: site.lat, lng: site.lng })
        : null,
  }));

  // No point resolved: nothing to sort by, so the authority's own published
  // order stands. A sort with no basis would shuffle a list for no reason and
  // read as an ordering the reader could not account for.
  if (!point) return measured;

  const placed = measured
    .filter((m) => m.miles !== null)
    .sort((a, b) => (a.miles as number) - (b.miles as number));
  const unplaced = measured.filter((m) => m.miles === null);
  return [...placed, ...unplaced];
}

/** How a distance reads on a card. One decimal under ten miles, else whole. */
export function milesLabel(miles: number): string {
  const rounded = miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
  return `${rounded} ${rounded === 1 ? "mile" : "miles"} away`;
}
