/**
 * IS THIS STRING THE NAME OF A GOVERNING BODY?
 * (2026-08-26, the descent-resume session. **RULING 183**.)
 *
 * Triage decides what is worth opening. This decides what a fetched page is
 * allowed to be promoted AS, and it is the narrower of the two questions:
 * `triageLead` may leave a lead alone on the grounds that nothing rules it
 * out, and that is not the same as something ruling it in.
 *
 * The distinction the pool made necessary, in its own words:
 *
 * | link text                                   | what it is                |
 * |---------------------------------------------|---------------------------|
 * | `assembly seating chart`                    | a chart                   |
 * | `change a court order`                      | an instruction            |
 * | `civil ecourts access`                      | a service                 |
 * | `artificial intelligence - use in the courts` | a policy page           |
 * | `assembly committees`                       | a LIST of committees      |
 * | `access and fairness committee`             | **a committee**           |
 * | `state board of education`                  | **a board**               |
 *
 * Every row contains a body word. `looksLikeBody` says yes to all seven. Only
 * the last two name a body, and the three tests below are what separate them:
 * a body word must be **present**, the phrase's **head** must not be an
 * artifact the body produced, and the head must not be **plural**, because a
 * plural head is how a directory names the set rather than the member.
 *
 * The plural rule is the one worth stating twice. `assembly committees` is a
 * page listing committees; each committee on it is a body and the page is not.
 * Promoting the list would put one row in the registry where a dozen belong,
 * and it would look like coverage.
 */

/** Singular nouns that can head the name of a unit of government. */
const BODY_NOUNS: readonly string[] = [
  "board",
  "commission",
  "committee",
  "council",
  "authority",
  "district",
  "department",
  "office",
  "bureau",
  "division",
  "agency",
  "court",
  "legislature",
  "assembly",
  "senate",
  "house",
  "trustees",
  "supervisors",
  "selectmen",
  "aldermen",
  "county",
  "city",
  "town",
  "township",
  "borough",
  "village",
  "precinct",
  "plantation",
  "authority",
  "corporation",
];

/**
 * Plural heads. A plural head names the SET, and the set is a directory route,
 * never a registry row.
 */
const PLURAL_HEADS: readonly string[] = [
  "boards",
  "commissions",
  "committees",
  "councils",
  "authorities",
  "districts",
  "departments",
  "offices",
  "bureaus",
  "divisions",
  "agencies",
  "courts",
  "counties",
  "cities",
  "towns",
  "townships",
  "boroughs",
  "villages",
  "legislatures",
  "assemblies",
];

/**
 * Heads that name a thing a body PRODUCED or a service it offers.
 *
 * Every one of these was read off a real lead in canonical state before it was
 * written down. That is the rule for this list: no speculative entries, because
 * a stop-word nobody has seen fire is a rule nobody can argue with.
 */
const ARTIFACT_HEADS: readonly string[] = [
  "chart", "order", "access", "guide", "guides", "schedule", "calendar", "list",
  "directory", "map", "maps", "form", "forms", "report", "reports", "plan",
  "plans", "policy", "policies", "resource", "resources", "information", "info",
  "update", "updates", "notice", "notices", "page", "site", "portal", "search",
  "login", "help", "faq", "faqs", "overview", "history", "mission", "contact",
  "training", "video", "videos", "podcast", "newsletter", "budget", "statistics",
  "data", "dashboard", "hub", "opinion", "opinions", "rules", "rule", "law",
  "laws", "statute", "statutes", "act", "program", "programs",
  "initiative", "initiatives", "project", "projects",
  "meeting", "meetings", "minutes", "agenda", "agendas", "hours",
  "locations", "location", "fees", "fee", "application", "applications",
  "news", "events",
  "event", "survey", "surveys", "toolkit", "handbook", "manual", "glossary",
  /*
   * `records`/`record` go back IN after the removals below were tested against
   * the pool: dropping them let through "Copies of Court Records",
   * "Electronic Access to Court Records" and "Expunging Your Court Record".
   * Unlike `elections` and `services`, no body in any of the three states is
   * named for its records — the office that keeps them is a Register or a
   * Clerk, and neither word is this one.
   */
  "records", "record", "copies", "copy",
  /*
   * REMOVED, and the removal is the point: `elections`, `services`, `records`,
   * `archives` and `library` were all in this list until a probe ran the real
   * names past it. They rejected **Board of Elections**, **Department of Human
   * Services**, **Division of Revenue and Enterprise Services** and **State
   * Archives** — four bodies, one of which runs the ballot this product
   * exists to show. An over-broad stop word here does not produce a wrong
   * count; it produces a government nobody can find, which is the failure the
   * transparency mandate names first.
   */
  /* Added after reading the first pass's own output rather than its count —
   * every one of these headed a lead the name test had just waved through. */
  "recesses", "livestreams", "links", "holidays", "appeals", "collection",
  /* Second calibration pass, read off the promotions the first one produced. */
  "documents", "document", "webcast", "webcasts", "nominations", "nomination",
  "self-help", "directories", "instructions", "instruction", "packet",
  "participants", "filing", "filings", "submission", "submissions", "correction",
];

/**
 * Words that, appearing FIRST, make the phrase a document or an instruction
 * however governmental its head noun is.
 *
 * "Rules of Court" heads on "court". So does "Represent Yourself in Court".
 * Neither is a court. The head-noun test cannot see this because English puts
 * the governing noun of an of-phrase at the end, so the front of the phrase is
 * where the giveaway is.
 */
const DOCUMENT_LEADS: readonly string[] = [
  "rules", "rule", "directory", "directories", "instructions", "guide", "guides",
  "list", "overview", "summary", "index", "map", "calendar", "schedule",
  "represent", "submit", "find", "search", "apply", "file", "pay", "request",
  "view", "download", "learn", "get", "make", "start", "check", "visit", "join",
  "become", "understand", "prepare", "how", "what", "why", "when", "where",
  "our", "your", "my",
];

/**
 * Plural nouns for PEOPLE. A page listing people is a roster, not a body.
 *
 * `commissioners`, `supervisors`, `selectmen`, `trustees` and `aldermen` are
 * deliberately NOT here: "Board of County Commissioners" and "Board of
 * Selectmen" are the actual names of actual bodies, and a rule that rejected
 * plural people would delete the governing board of every New England town.
 *
 * The rest are rescued the same way — by an ORGAN noun elsewhere in the name.
 * "County Coordinators" is a roster; "Office of County Coordinators" is an
 * office. The geography nouns do not rescue, because "county" says where a
 * thing is and never what it is.
 */
const PERSON_ROLE_PLURALS: readonly string[] = [
  "coordinators", "surrogates", "managers", "leaders", "members", "officials",
  "officers", "judges", "justices", "clerks", "staff", "representatives",
  "employees", "contacts", "attorneys", "administrators", "directors",
];

/** Nouns that name an organ of government, as opposed to a place. */
const ORGAN_NOUNS: readonly string[] = [
  "board", "commission", "committee", "council", "court", "department",
  "office", "bureau", "division", "agency", "authority",
  "legislature", "assembly", "senate",
];
/* `district` is NOT a rescuer even though it is an organ elsewhere: it is used
 * adjectivally more often than not — "district leaders", "district spending",
 * "district office hours" — and letting it rescue promoted
 * "School and District Leaders", a topic page, as a body. */

/**
 * A plural organ noun ANYWHERE in a name means the name is a set.
 *
 * Found by reading the first dry run's promotions: "County Offices of
 * Education" was promoted as one body. It is New Jersey's twenty-one county
 * offices of education — twenty-one bodies, listed on one page, and the page
 * is a directory route. The plural HEAD rule missed it because the phrase
 * heads on "education".
 *
 * A real single body almost never carries a plural organ in its name, and the
 * ones that look like they might — "Board of Supervisors", "Board of County
 * Commissioners" — are plural PEOPLE, which is a different list.
 */
const PLURAL_ORGANS: readonly string[] = [
  "offices", "boards", "commissions", "committees", "councils", "courts",
  "departments", "divisions", "districts", "agencies", "authorities", "bureaus",
];

/** Leading phrases that describe a page about a body rather than the body. */
const LEADING_NOISE = /^(about the|about|welcome to the|welcome to|the|contact the|contact|meet the|meet|visit the|visit|inside the|inside)\s+/i;

export interface EntityNameVerdict {
  readonly isBody: boolean;
  /** The name as it should be recorded, once the noise is off the front. */
  readonly name: string;
  readonly basis: string;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&#x27;|&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[^a-z0-9'&\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Judge a name.
 *
 * The input is the link text the walk recorded, and the output name is what a
 * reader should see — so the trailing acronym gloss (`nj motor vehicle
 * commission - njmvc`) and the leading `about the` both come off here rather
 * than in the caller, where each caller would do it slightly differently.
 */
export function readsAsBodyName(raw: string): EntityNameVerdict {
  let name = raw
    .replace(/&#x27;|&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  /* A trailing " - ACRONYM" or " (ACRONYM)" is a gloss on the name, not part
   * of it. Removed before the head is read, or the head would be the acronym. */
  /* The spaces around the dash are MANDATORY. Written `\s*` the first time,
   * this matched the hyphen inside a compound word: "Municipal Court
   * Self-Help" lost "-Help" and was promoted as the body "Municipal Court
   * Self". A gloss is a separate token — " - NJMVC" — and a hyphenated word is
   * not. */
  name = name.replace(/\s+[-–—]\s+[A-Za-z]{2,8}$/, "").replace(/\s*\([^)]{1,40}\)\s*$/, "").trim();
  name = name.replace(LEADING_NOISE, "").trim();
  /* Trailing possessive/colon fragments: "commissioner's office:" */
  name = name.replace(/[:;,.]+$/, "").trim();

  const t = tokens(name);
  if (t.length === 0) return { isBody: false, name, basis: "nothing left once the page-furniture words came off" };
  if (t.length > 12) {
    return { isBody: false, name, basis: `${t.length} words is a sentence, not the name of a body` };
  }

  const head = t[t.length - 1];

  if (PLURAL_HEADS.includes(head)) {
    return {
      isBody: false,
      name,
      basis: `heads on the plural "${head}" — this names the SET of bodies, which is a directory route, and each member of it is the body`,
    };
  }

  if (ARTIFACT_HEADS.includes(head)) {
    return {
      isBody: false,
      name,
      basis: `heads on "${head}", which is something a body publishes or does, not a body`,
    };
  }

  /* `court rule 1:38-3(16)` tokenises to a trailing number. A citation is not
   * a name, and no body in any of the three states is called a numeral. */
  /* Not `^\d+$`: "court rule 1:38-3(16)" tokenises to a head of "38-3", which
   * is a citation and is not a number by that test. Any head that STARTS with
   * a digit and carries only digits and citation punctuation is one. */
  if (/^\d[\d\-.:]*$/.test(head)) {
    return { isBody: false, name, basis: `heads on the number "${head}" — this is a citation or a section, not a name` };
  }

  if (PERSON_ROLE_PLURALS.includes(head) && !t.some((x) => ORGAN_NOUNS.includes(x))) {
    return {
      isBody: false,
      name,
      basis: `heads on "${head}" with no organ of government named — this is a roster of people, and the body they serve is what belongs in the registry`,
    };
  }

  if (DOCUMENT_LEADS.includes(t[0])) {
    return {
      isBody: false,
      name,
      basis: `opens on "${t[0]}", which makes the phrase a document or an instruction about a body rather than the body`,
    };
  }

  const setOrgan = PLURAL_ORGANS.find((n) => t.includes(n));
  if (setOrgan) {
    return {
      isBody: false,
      name,
      basis: `contains the plural organ "${setOrgan}" — this names a SET of bodies and the page is a directory route; each member of it is what belongs in the registry`,
    };
  }

  const found = BODY_NOUNS.find((n) => t.includes(n));
  if (!found) {
    return { isBody: false, name, basis: "no word in it names a unit of government" };
  }

  return { isBody: true, name, basis: `contains "${found}" and heads on "${head}", which is neither a plural nor an artifact` };
}
