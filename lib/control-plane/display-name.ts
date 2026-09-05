/**
 * **A KEY IS FOR THE MACHINE; THE OWNER READS A NAME.** (ADM-12, the 9.4.26
 * evening admin feedback.)
 *
 * The owner's words, reading `nj:county:county-of-atlantic` on a fleet card:
 * *"I can parse it out slightly but … that's the kind of stuff that needs to
 * be changed for sure."* Every console surface rendered the control plane's
 * subject keys, OCD ids, unit ids and record ids as the thing itself — fleet
 * cards, attempt tables, obligation pills, incidents, deployments. One class,
 * many instances.
 *
 * This module is the ONE projection from a key to what the owner reads:
 *
 *   `nj:county:county-of-atlantic`                          Atlantic County, New Jersey
 *   `az:city:city-of-avondale`                              City of Avondale, Arizona
 *   `ocd-division/country:us/state:nh/county:sullivan/
 *      place:springfield_town#select-board`                 Springfield Town — Select Board, Sullivan County, New Hampshire
 *   `ballot-az-pima:prop-423`                               Pima County Prop 423, Arizona
 *   `ballot-az-pima:us-house-6`                             Pima County U.S. House District 6, Arizona
 *   `az:2026:state-az-sldl-19:state-representative-
 *      district-19:anderson-jackie-o-donnell`               Jackie O'Donnell Anderson — State Representative District 19, Arizona
 *   `curated:az/corona-de-tucson-fire-district#governing`   Corona de Tucson Fire District (governing body), Arizona
 *   `at-4da7d91e090a1497b3bff5ff`                           Attempt 4da7d91e
 *
 * ## What it never does
 *
 * It never invents a person's name. A candidate key ends in a slug of the
 * filed name in last-first-middle order, and a slug cannot give back an
 * apostrophe or a capital inside a name. So a person is named ONLY from the
 * candidate record the publisher carries (`candidateNames`, keyed by slug);
 * with no record the office is rendered in words and the slug stays a slug.
 * A wrong name on a real candidate is exactly the false claim this product
 * cannot survive (RULING 273), so the fallback is honest rather than pretty.
 *
 * The raw key is never lost: `DisplayName.raw` is what the page puts in the
 * hover title and the disclosure, for debugging.
 *
 * The LEVEL is derived alongside, because the owner wants colour wherever a
 * jurisdiction level shows (ADM-21): the consumer legend's four — school,
 * local, state, federal — and null when the key names no level.
 *
 * PURE. The state catalogue is the only table it reads.
 */
import { US_STATES } from "./readiness/catalog.ts";

export type JurisdictionLevel = "federal" | "state" | "local" | "school";

export interface DisplayName {
  /** What the owner reads. */
  readonly name: string;
  /** A shorter form for a pill: the name without the trailing state. */
  readonly short: string;
  /** The key exactly as recorded. */
  readonly raw: string;
  readonly level: JurisdictionLevel | null;
  /** The state the key belongs to, as its name, when it names one. */
  readonly state: string | null;
  /** True when the key was recognised by a pattern; false when it is rendered as words from its own segments. */
  readonly recognised: boolean;
}

const STATE_NAME: ReadonlyMap<string, string> = new Map(US_STATES.map((s) => [s.code.toLowerCase(), s.name]));
const STATE_CODES = new Set(STATE_NAME.keys());

/** Acronyms and codes that read as themselves in words. */
const UPPER = new Set([
  "sos", "cfs", "fec", "ftp", "api", "us", "cd", "sldl", "sldu", "lda", "pdf", "csv", "json", "html", "url", "id", "ocd",
  "zip", "acs", "nces", "ccd", "fips", "http", "https", "nh", "nj", "az", "dc", "usa", "gis", "eo", "ph", "tv",
]);
const SMALL = new Set(["of", "de", "the", "and", "for", "at", "in", "on", "la", "del", "da", "di", "y"]);

/** "corona-de-tucson-fire-district" → "Corona de Tucson Fire District". */
export function words(slug: string): string {
  return slug
    .replace(/(^|[-_])u-s(?=[-_]|$)/g, "$1us")
    .split(/[-_\s]+/)
    .filter((w) => w !== "")
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (UPPER.has(lower)) return lower === "us" ? "U.S." : lower.toUpperCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_NAME.get(code.toLowerCase()) ?? null;
}

/** "state-representative-district-19" → "State Representative District 19"; "us-house-6" → "U.S. House District 6". */
function officeWords(slug: string): string {
  const m = /^(.*?)-(\d+)$/.exec(slug.replace(/^u-s-/, "us-"));
  if (m && !/district$/.test(m[1])) return `${words(m[1])} District ${m[2]}`;
  return words(slug);
}

/** "prop-423" → "Prop 423"; "us-house-6" → "U.S. House District 6"; "state-house-19" → "State House District 19". */
function contestWords(slug: string): string {
  if (/^prop(osition)?-\d+/i.test(slug)) return words(slug);
  return officeWords(slug);
}

function contestLevel(slug: string): JurisdictionLevel {
  if (/^(us-|u-s-|congress|president|senate-us|us-senate)/.test(slug)) return "federal";
  if (/^(state-|governor|attorney-general|secretary-of-state|treasurer|superintendent)/.test(slug)) return "state";
  if (/school/.test(slug)) return "school";
  return "local";
}

function done(
  raw: string,
  name: string,
  level: JurisdictionLevel | null,
  state: string | null,
  recognised = true,
  short?: string,
): DisplayName {
  return { name, short: short ?? name, raw, level, state, recognised };
}

/* ----------------------------------------------------------------- OCD ids */

function ocdName(raw: string): DisplayName | null {
  const m = /^ocd-division\/(.+?)(?:#(.+))?$/.exec(raw);
  if (!m) return null;
  const segments = m[1].split("/").map((s) => {
    const at = s.indexOf(":");
    return at < 0 ? { type: s, value: "" } : { type: s.slice(0, at), value: s.slice(at + 1) };
  });
  const get = (type: string) => segments.find((s) => s.type === type)?.value ?? null;
  const state = stateName(get("state"));
  const county = get("county");
  const place = get("place");
  const school = get("school_district");
  const cd = get("cd");
  const sldl = get("sldl");
  const sldu = get("sldu");
  const body = m[2] ? words(m[2]) : null;

  let subject: string;
  let level: JurisdictionLevel;
  if (school) {
    subject = words(school);
    level = "school";
  } else if (place) {
    subject = words(place);
    level = "local";
  } else if (cd) {
    subject = `Congressional District ${cd.replace(/^0+/, "") || cd}`;
    level = "federal";
  } else if (sldl || sldu) {
    subject = `State ${sldl ? "House" : "Senate"} District ${(sldl ?? sldu ?? "").replace(/^0+/, "")}`;
    level = "state";
  } else if (county) {
    subject = `${words(county)} County`;
    level = "local";
  } else if (state) {
    subject = state;
    level = "state";
  } else {
    subject = "United States";
    level = "federal";
  }
  const parts: string[] = [];
  if (body) parts.push(`${subject} — ${body}`);
  else parts.push(subject);
  if (county && (place || school)) parts.push(`${words(county)} County`);
  if (state && subject !== state) parts.push(state);
  const short = body ? `${subject} — ${body}` : subject;
  return done(raw, parts.join(", "), level, state, true, short);
}

/* ------------------------------------------------------------ colon keys */

/** `<st>:county:county-of-<x>`, `<st>:city:city-of-<x>`, `<st>:town:<x>`, `<st>:school:<x>` … */
function jurisdictionKey(raw: string): DisplayName | null {
  const m = /^([a-z]{2}):(county|city|town|township|borough|village|place|school|school-district|special|district):([a-z0-9-]+)$/i.exec(raw);
  if (!m) return null;
  const state = stateName(m[1]);
  const kind = m[2].toLowerCase();
  const slug = m[3].toLowerCase();
  let subject: string;
  let level: JurisdictionLevel = "local";
  if (kind === "county") {
    const bare = slug.replace(/^county-of-/, "").replace(/-county$/, "");
    subject = `${words(bare)} County`;
  } else if (kind === "school" || kind === "school-district") {
    subject = words(slug);
    level = "school";
  } else if (/^(city|town|township|borough|village)-of-/.test(slug)) {
    subject = words(slug);
  } else {
    subject = kind === "place" || kind === "special" || kind === "district" ? words(slug) : `${words(kind)} of ${words(slug)}`;
  }
  return done(raw, state ? `${subject}, ${state}` : subject, level, state, true, subject);
}

/** `<st>:<year>:<contest-key>:<office-slug>:<person-slug>` — a candidacy. */
function candidacyKey(raw: string, candidateNames: Readonly<Record<string, string>> | undefined): DisplayName | null {
  const m = /^([a-z]{2}):(\d{4}):([a-z0-9-]+):([a-z0-9-]+):([a-z0-9-]+)$/i.exec(raw);
  if (!m) return null;
  const state = stateName(m[1]);
  const contestKey = m[3].toLowerCase();
  const office = officeWords(m[4].toLowerCase());
  const slug = m[5].toLowerCase();
  const person = candidateNames?.[slug] ?? null;
  const level: JurisdictionLevel = /-cd-|-us-|congress/.test(contestKey)
    ? "federal"
    : /-sld[lu]-|state-|governor|statewide/.test(contestKey)
      ? "state"
      : /school/.test(contestKey)
        ? "school"
        : "local";
  const who = person ?? `candidate ${slug}`;
  const short = `${who} — ${office}`;
  return done(raw, `${short}${state ? `, ${state}` : ""} (${m[2]})`, level, state, true, short);
}

/** `ballot-<st>-<county>:<contest>` and `ballot-<st>-<county>:<contest>:<person>`. */
function ballotKey(raw: string, candidateNames: Readonly<Record<string, string>> | undefined): DisplayName | null {
  const m = /^ballot-([a-z]{2})-([a-z0-9-]+):([a-z0-9-]+)(?::([a-z0-9-]+))?$/i.exec(raw);
  if (!m) return null;
  const state = stateName(m[1]);
  const county = `${words(m[2])} County`;
  const contest = contestWords(m[3].toLowerCase());
  const level = contestLevel(m[3].toLowerCase());
  const person = m[4] ? (candidateNames?.[m[4].toLowerCase()] ?? `candidate ${m[4].toLowerCase()}`) : null;
  const short = person ? `${person} — ${contest}` : `${county} ${contest}`;
  const name = person ? `${short}, ${county}${state ? `, ${state}` : ""}` : `${short}${state ? `, ${state}` : ""}`;
  return done(raw, name, level, state, true, short);
}

/** `curated:<st>/<slug>#<role>` — a curated governing body. */
function curatedKey(raw: string): DisplayName | null {
  const m = /^curated:([a-z]{2})\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/i.exec(raw);
  if (!m) return null;
  const state = stateName(m[1]);
  const subject = words(m[2].toLowerCase());
  const role = m[3] ? (m[3] === "governing" ? "governing body" : words(m[3])) : null;
  const level: JurisdictionLevel = /school/.test(m[2]) ? "school" : "local";
  const short = role ? `${subject} (${role})` : subject;
  return done(raw, state ? `${short}, ${state}` : short, level, state, true, short);
}

/** Record ids: `at-…` Attempt, `wi-…` work item, `rt-…` route task, `ls-…` lease, `nw-…` window, `proof-…`. */
function recordId(raw: string): DisplayName | null {
  const m = /^(at|wi|rt|ls|nw|art|rq|proof|wf)-([a-z0-9-]+)$/i.exec(raw);
  if (!m) return null;
  const kind: Record<string, string> = { at: "Attempt", wi: "Work item", rt: "Route task", ls: "Lease", nw: "Window", art: "Artifact", rq: "Reader question", proof: "Proof run", wf: "Workflow" };
  const label = kind[m[1].toLowerCase()] ?? words(m[1]);
  const tail = m[2].length > 8 ? m[2].slice(0, 8) : m[2];
  return done(raw, `${label} ${tail}`, null, null, true);
}

/** `nh-sos-records-request`, `az-sos-cfs-bulk-ftp`, `meetings:1` — unit and route ids. */
function unitId(raw: string): DisplayName | null {
  const m = /^([a-z]{2})-([a-z0-9-]+)$/i.exec(raw);
  if (m && STATE_CODES.has(m[1].toLowerCase())) {
    const state = stateName(m[1]);
    return done(raw, `${words(m[2])}${state ? `, ${state}` : ""}`, "state", state, true, words(m[2]));
  }
  return null;
}

/* -------------------------------------------------------------- the API */

/**
 * The display name for one key. `candidateNames` is the publisher's
 * slug → filed-name map; without it a candidate is rendered by office and slug.
 */
export function displayNameOf(
  raw: string | null | undefined,
  options: { readonly candidateNames?: Readonly<Record<string, string>> } = {},
): DisplayName {
  const key = (raw ?? "").trim();
  if (key === "") return done("", "no subject recorded", null, null, false);
  const state = STATE_CODES.has(key.toLowerCase()) ? stateName(key) : null;
  if (state) return done(key, state, "state", state, true);
  if (STATE_NAME.size > 0 && [...STATE_NAME.values()].includes(key)) return done(key, key, "state", key, true);
  return (
    ocdName(key) ??
    candidacyKey(key, options.candidateNames) ??
    ballotKey(key, options.candidateNames) ??
    jurisdictionKey(key) ??
    curatedKey(key) ??
    recordId(key) ??
    unitId(key) ??
    // Unrecognised: its own segments as words, level unknown, and flagged so.
    done(key, words(key.replace(/[:/#]+/g, " ")), null, null, false)
  );
}

/** The consumer legend's four levels, with the CSS class the console colours them by. */
export const LEVEL_CLASS: Record<JurisdictionLevel, string> = {
  federal: "lvl-federal",
  state: "lvl-state",
  local: "lvl-local",
  school: "lvl-school",
};

export const LEVEL_LABEL: Record<JurisdictionLevel, string> = {
  federal: "Federal",
  state: "State",
  local: "Local",
  school: "School",
};

/** The level a display label names when it is a bare state name (the fleet's "Deployed in" pills). */
export function levelOfLabel(label: string): JurisdictionLevel | null {
  return displayNameOf(label).level;
}
