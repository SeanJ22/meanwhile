/**
 * **WHAT COUNTS AS EVIDENCE THAT A PAGE IS A NAMED CANDIDATE'S CAMPAIGN SITE.**
 *
 * Extracted 2026-08-23 (overnight depth hunt, item 3) from
 * `scripts/promote-leads-0823.mts`, which built all of it and was about to have
 * it copied into a second hunt script. RULING 103 is explicit that the sweep
 * predicate covers duplicate IMPLEMENTATIONS and not only named instances, and
 * that the existing rule's own wording — *fix at the SHARED code path* —
 * assumes there is one. This is that shared path, made before the second copy
 * existed rather than after a sweep found it.
 *
 * Nothing here changed in the move. The name forms, the diminutive list, the
 * suffix set, the word-bounded office evidence and the two-bar verdict are the
 * NH106 session's, with its reasoning kept attached, because a stripped rule
 * reads as guidance.
 *
 * ## The two bars, and why one of them is not enough
 *
 * RULING 68. A session once reported `HIT` on 16 of 16 people across two routes
 * because every host answered 200 — an SPA shell, a login wall, and a search
 * page that echoed the query into its own HTML so a substring test for the
 * surname passed. A 100% hit rate on guessed identifiers across sixteen
 * different people is a measurement of the instrument.
 *
 * 1. **The control** (`lib/hunt/control-query.ts`) proves the response is
 *    DISTINGUISHABLE from what the host says about anything.
 * 2. **Self-identification** proves WHOSE page it is. Clearing the control says
 *    nothing about that, and the gap between the two is exactly the gap between
 *    `LEAD` and `HIT`.
 *
 * ## RULING 110 — the FORMS, not just the terms
 *
 * A search that returns nothing must show it looked in the right FORM. A
 * candidate filed as `Thomas H. Kean` runs a site that says **Tom Kean**, and a
 * sweep for the filed string finds nothing and would report an absence. So the
 * name is expanded into a named set of forms, every form is recorded on every
 * row whether it matched or not, and the report states the forms used.
 */
import type { ProbeOutcome } from "./control-query.ts";

/**
 * Diminutives that appear on campaign material for a filed legal name.
 *
 * Short, and short on purpose: every entry is one this project has actually
 * needed. `Thomas H. Kean` files as Thomas and campaigns as **Tom Kean**, which
 * was a live row in the lead set this list was written for. A speculative list
 * would be a guess dressed as coverage, and a miss caused by a name not on it
 * is reported as a miss with the forms shown, so the gap is visible rather than
 * silent.
 */
export const DIMINUTIVES = new Map<string, string[]>([
  ["thomas", ["tom", "tommy"]],
  ["robert", ["bob", "rob", "bobby"]],
  ["william", ["will", "bill", "billy"]],
  ["richard", ["rick", "dick", "rich"]],
  ["michael", ["mike"]],
  ["joseph", ["joe", "joey"]],
  ["james", ["jim", "jimmy"]],
  ["charles", ["charlie", "chuck"]],
  ["edward", ["ed", "eddie", "ted"]],
  ["anthony", ["tony"]],
  ["christopher", ["chris"]],
  ["daniel", ["dan", "danny"]],
  ["matthew", ["matt"]],
  ["nicholas", ["nick"]],
  ["patrick", ["pat"]],
  ["stephen", ["steve"]],
  ["steven", ["steve"]],
  ["kenneth", ["ken"]],
  ["donald", ["don"]],
  ["ronald", ["ron"]],
  ["gerald", ["jerry"]],
  ["lawrence", ["larry"]],
  ["frederick", ["fred"]],
  ["benjamin", ["ben"]],
  ["samuel", ["sam"]],
  ["elizabeth", ["liz", "beth", "betsy"]],
  ["katherine", ["kate", "kathy", "katie"]],
  ["catherine", ["cate", "kathy", "katie"]],
  ["margaret", ["maggie", "peggy", "meg"]],
  ["deborah", ["deb", "debbie"]],
  ["patricia", ["pat", "patty", "tricia"]],
  ["jennifer", ["jen", "jenny"]],
  ["rebecca", ["becca", "becky"]],
  ["susan", ["sue", "susie"]],
  ["barbara", ["barb"]],
  ["theresa", ["terry", "teri"]],
  ["andrew", ["andy", "drew"]],
]);

/**
 * The generational suffixes that are NOT part of a surname.
 *
 * RULING 103's initials defect came from treating `III` as the last name; the
 * same tokens have to be stripped before a surname is extracted here, or the
 * surname searched for `Thomas J. Haynes III` would be `iii`.
 */
export const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

export interface NameForm {
  /** What was searched for. Printed on every row, matched or not. */
  form: string;
  /** Why this form exists — read by a human looking at a miss. */
  kind: "filed" | "given-surname" | "diminutive-surname" | "surname";
}

/** Every form of a filed name worth searching a page for, each labelled. */
export function nameForms(filed: string): NameForm[] {
  const cleaned = filed.replace(/["']/g, "").trim();
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0 && !SUFFIXES.has(t.toLowerCase().replace(/[.,]/g, "")));
  /* A single-token name has no given/surname split to make, and inventing one
   * would search for a form the person does not have. */
  const forms: NameForm[] = [{ form: cleaned.toLowerCase(), kind: "filed" }];
  if (tokens.length < 2) return forms;

  const given = tokens[0].toLowerCase().replace(/[.,]/g, "");
  const surname = tokens[tokens.length - 1].toLowerCase().replace(/[.,]/g, "");
  forms.push({ form: `${given} ${surname}`, kind: "given-surname" });
  for (const d of DIMINUTIVES.get(given) ?? []) {
    forms.push({ form: `${d} ${surname}`, kind: "diminutive-surname" });
  }
  /* The surname alone is the weakest form and is never sufficient by itself —
   * see `verdictFor`, which requires office or cycle evidence alongside it. */
  forms.push({ form: surname, kind: "surname" });

  const seen = new Set<string>();
  return forms.filter((f) => (seen.has(f.form) ? false : (seen.add(f.form), true)));
}

/**
 * Evidence that a page is about STANDING FOR OFFICE rather than merely
 * mentioning a person.
 *
 * **WORD-BOUNDED, AND THE FIRST VERSION WAS NOT — which manufactured two
 * findings before anything shipped.**
 *
 * The first list was bare substrings including `elect`, `vote`, `campaign` and
 * `2026`. `elect` is inside *selected* and *electronic*; `2026` is inside a
 * copyright line. Measured against ten pages, that list promoted **Rita C.
 * Chipperson** on `chippersonlaw.com` — titled *"Morristown Law Firm,
 * Chipperson Law Group, P.C."* — and **Clifford D. Dawkins** on a page titled
 * *"D&W Law Group"*. Both are law-firm attorney bios. Neither is a campaign
 * site, and labelling one as this candidate's campaign site would be a claim
 * about a named person that the page does not support.
 *
 * A law-firm bio is not worthless — the manifest's `bar-directory` route exists
 * precisely because a lawyer's firm page carries an office address and a direct
 * line. It serves the **contact** field. It is not evidence of a candidacy, and
 * the two fields are not interchangeable.
 *
 * So a page must carry at least one of these to be promoted. `paid for by` is
 * the strongest of them by a distance: it is the campaign-finance disclaimer, a
 * legal obligation on campaign material, and no law firm carries it.
 */
/**
 * The office nouns a campaign says it is standing for.
 *
 * Shared by the two `for <office>` patterns below so the list cannot drift into
 * two versions of itself.
 */
const OFFICE_NOUNS =
  "congress|senate|mayor|council|assembly|commissioner|sheriff|school board|township committee|" +
  "borough council|town council|freeholder|board of education|board of ed|committee|surrogate|" +
  "county clerk|board of chosen freeholders";

export const OFFICE_EVIDENCE: [string, RegExp][] = [
  ["paid-for-by disclaimer", /paid for by/],
  [
    "for <office>",
    new RegExp(`\\bfor (?:${OFFICE_NOUNS})\\b`),
  ],
  /**
   * `for <place> <office>` — and this one is not a nicety.
   *
   * **Local campaigns almost never say "for Council". They say "for Mendham
   * Township Committee", "for Rockaway Township Council", "for the Parsippany
   * Board of Education"** — the place sits between the preposition and the
   * office, and the bare pattern above misses every one of them.
   *
   * Found on `garykapner.com`, whose entire prose content is its title:
   * *Gary Kapner for Mendham Township Committee*. The bare pattern read that
   * page as carrying NO evidence of a candidacy and the site was recorded as a
   * `LEAD` — a real campaign site, correctly fetched, demoted by the shape of
   * one regular expression.
   *
   * It is a class-wide defect rather than one page: the intervening place name
   * is the NORM in municipal and school races and its absence is the exception,
   * so the pattern was under-detecting exactly the small local campaigns this
   * product exists to reach.
   *
   * Bounded to three intervening words, all lower-case letters or hyphens, so
   * it cannot span a sentence and manufacture evidence out of unrelated prose.
   */
  [
    "for <place> <office>",
    new RegExp(`\\bfor (?:the )?(?:[a-zà-ÿ][a-zà-ÿ-]+ ){1,3}(?:${OFFICE_NOUNS})\\b`),
  ],
  ["candidate for", /\bcandidate for\b/],
  ["elect / re-elect", /\bre-?elect\b/],
  ["vote for", /\bvote for\b/],
  ["running for", /\brunning for\b/],
  ["on the ballot", /\bon the ballot\b/],
  ["this campaign", /\b(my|our|the|this) campaign\b/],
];

/**
 * A page that says it is a PARTY ORGAN rather than one person's campaign.
 *
 * **Deliberately symmetric across parties, and that is a rule rather than a
 * courtesy.** An instrument that recognised one party's committees and not the
 * other's would systematically mislabel one side's county sites as individual
 * campaign sites, which is the equal-effort concern pointed at parties instead
 * of at candidates. Every pattern here is party-agnostic or is paired.
 *
 * Written after `morrisdems.org` cleared both of RULING 68's bars for
 * Christopher Russo: the page names him, it carries a paid-for-by disclaimer,
 * and he filed `info@morrisdems.org` as his contact because the county
 * committee handles his mail. Its own title is *Home | Morris County Democratic
 * Committee* and its own first line is *We are the Morris County Democratic
 * Committee*. It is a real find — for `party-committee-roster` — and it is not
 * any one candidate's campaign site.
 *
 * The slate test (counting other filed candidates named on the page) does not
 * catch this one, because a county committee's HOMEPAGE need not list the
 * ticket. Both tests are kept: they fail in different directions.
 */
export const PARTY_ORGAN_SELF_ID: [string, RegExp][] = [
  ["names itself a county committee", /\b(county|municipal|city|town|township|borough) (democratic|republican|green|libertarian|conservative|working families) committee\b/],
  ["names itself a party committee", /\b(democratic|republican|green|libertarian|conservative|working families) (county|municipal|state|city|town) committee\b/],
  ["names itself the party organisation", /\b(we are|welcome to) the [a-z .'-]{0,40}(democratic|republican|green|libertarian) (party|committee|organization|organisation)\b/],
  ["names itself a party club or association", /\b(democratic|republican) (club|association|organization|organisation) of\b/],
];

/** Which `PARTY_ORGAN_SELF_ID` labels a page's flattened text carries. */
export function partyOrganSelfIdIn(flattened: string): string[] {
  return PARTY_ORGAN_SELF_ID.filter(([, re]) => re.test(flattened)).map(([label]) => label);
}

/** Which `OFFICE_EVIDENCE` labels a page's flattened text carries. */
export function officeEvidenceIn(flattened: string): string[] {
  return OFFICE_EVIDENCE.filter(([, re]) => re.test(flattened)).map(([label]) => label);
}

/** Flatten HTML to the lower-cased prose the evidence tests read. */
export function flattenForEvidence(html: string): string {
  return html
    .toLowerCase()
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * The `<given> <surname>` pair for a filed name, cleaned for matching.
 *
 * A filed name carries things a web page does not: a parenthesised nickname
 * (`Christopher (Chris) RUSSO`), a quoted one (`Arthur J. "Art" BRUHN`), a
 * middle initial, and a generational suffix. Pairing the raw fields produces
 * `christopher (chris) russo`, which matches no page ever written — and a
 * corpus test built on it silently finds nothing and reports that as a fact
 * about the pages.
 */
export function givenSurnamePair(givenName: string, familyName: string): string {
  const given = givenName
    .replace(/\([^)]*\)/g, " ")
    .replace(/"[^"]*"/g, " ")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[.,]/g, "")
    .toLowerCase();
  const family = familyName
    .replace(/,\s*(?:JR|SR|II|III|IV|V)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return given && family ? `${given} ${family}` : "";
}

/** Every name form, with whether the page carried it. RULING 110. */
export function matchNameForms(
  filed: string,
  flattened: string,
): { form: string; kind: string; matched: boolean }[] {
  return nameForms(filed).map((f) => ({
    form: f.form,
    kind: f.kind,
    matched: flattened.includes(f.form),
  }));
}

/**
 * The promotion decision, and the two bars it applies in order.
 *
 * Kept as its own function so the rule is readable in one place rather than
 * spread through a loop, and so a later session can see exactly what `HIT` was
 * allowed to mean on this date.
 */
export function verdictFor(
  probeOutcome: ProbeOutcome,
  forms: { form: string; kind: string; matched: boolean }[],
  office: string[],
): { outcome: ProbeOutcome; detail: string } {
  if (probeOutcome !== "LEAD" && probeOutcome !== "HIT") {
    return { outcome: probeOutcome, detail: "did not clear the control" };
  }
  const strong = forms.some((f) => f.matched && f.kind !== "surname");
  const surnameOnly = forms.some((f) => f.matched && f.kind === "surname");
  if (strong && office.length > 0) {
    return {
      outcome: "HIT",
      detail:
        `the page names the candidate (${forms
          .filter((f) => f.matched)
          .map((f) => f.form)
          .join(", ")}) ` + `and identifies itself as a campaign (${office.join(", ")})`,
    };
  }
  if (strong) {
    return {
      outcome: "LEAD",
      detail:
        "the page names the candidate but carries no word showing it is about standing for office — " +
        "whose page it is remains unestablished",
    };
  }
  if (surnameOnly) {
    return {
      outcome: "LEAD",
      detail:
        "only the SURNAME matched, which a page about any relative or namesake would also do. " +
        "A surname alone never promotes.",
    };
  }
  return {
    outcome: "LEAD",
    detail:
      `the page cleared the control but carries NONE of the ${forms.length} name forms searched ` +
      `(${forms.map((f) => f.form).join(", ")}) — it is a live host, not this person's site`,
  };
}

/**
 * Mailbox providers whose domain says nothing about the account holder.
 *
 * This list decides whether a filed email's DOMAIN is worth walking as a route,
 * so a provider missing from it costs one wasted probe and a provider wrongly
 * ON it costs a whole candidate's site. It errs toward being short: an unknown
 * domain is walked and classified by what the page says, which is the safe
 * direction.
 */
export const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "fastmail.com",
  "mail.com",
  "email.com",
  "gmx.com",
  "juno.com",
  "comcast.net",
  "optonline.net",
  "optimum.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "earthlink.net",
  "rcn.com",
  "cox.net",
  "charter.net",
  "frontier.com",
  "windstream.net",
  "embarqmail.com",
]);

/* ========================================================================== *
 *  WHAT KIND OF PAGE IS THIS — the final pass, 2026-08-25
 * ========================================================================== */

/** The three things a page carrying a candidate's name can be. */
export type CampaignPageKind =
  /** The candidate's own campaign site. Fills the campaign-site field. */
  | "CAMPAIGN_SITE"
  /** A party publishes it about them. RULING 122 — the HOST IS LABELLED. */
  | "PARTY_HOSTED_PAGE"
  /** Something else names them. Whose page it is remains unestablished. */
  | "LEAD";

/**
 * Which of the three, decided by a RULE rather than by a list of hosts.
 *
 * ## Why this exists, and what the list was costing
 *
 * The lead adjudication of 2026-08-25 inverted the campaign-site question — every
 * host in the corpus tested against every candidate on the ballot — and returned
 * ten promotions. Six were real, and three of the other four were `huffpost.com`
 * promoted as **William Maher's** campaign site (the page names Bill Maher, the
 * comedian) and `wpgtalkradio.com` promoted as **Thomas H. Kean, Jr.'s** (a radio
 * station that had covered him).
 *
 * The reflex is to add those two hosts to an exclusion list. **That is RULING
 * 90's failure exactly: every fix so far has been a list, and lists are
 * finite.** The next false positive would be a host nobody had thought of, and
 * the one after that another.
 *
 * ## The rule, and it comes from statute rather than from taste
 *
 * New Jersey requires a candidate committee to carry a **"paid for by"**
 * disclaimer on the communications it pays for (N.J.S.A. 19:44A-22.3). A news
 * organisation writing ABOUT a candidate does not carry one, because it is not a
 * campaign communication. So the disclaimer separates *a page the campaign
 * published* from *a page somebody published about the campaign* — structurally,
 * on every host, including the ones nobody has met yet.
 *
 * Measured against the ten: all six genuine campaign sites carried it; the two
 * news hosts carried only `running for` and `this campaign`, the vocabulary of
 * writing about a race rather than standing in one.
 *
 * ## And a party organ is a THIRD thing, not a campaign site
 *
 * `morrisdems.org` and `morrisgop.org` both carry the disclaimer and both name
 * candidates — and neither is anybody's campaign site. They are the case RULING
 * 122 governs: the page a party publishes about its candidate, which fills the
 * verified-page field **with the host named in plain words** and never renders
 * under a bare "Campaign site" label. Presenting a county party's website as a
 * candidate's own site would blur the exact line the
 * organisations-render-as-filed rule draws.
 *
 * ## What this deliberately does NOT decide
 *
 * Identity. A strong name form is still required by the caller and a surname
 * alone still promotes nothing — this answers *what kind of page*, never *whose
 * page*, and both questions have to be answered before anything renders.
 */
export function classifyCampaignPage(input: {
  /** From `officeEvidenceIn`. */
  officeEvidence: readonly string[];
  /** From `partyOrganSelfIdIn`. */
  partyOrganSelfId: readonly string[];
}): { kind: CampaignPageKind; why: string } {
  const paidFor = input.officeEvidence.includes("paid-for-by disclaimer");
  const organ = input.partyOrganSelfId.length > 0;
  if (!paidFor) {
    return {
      kind: "LEAD",
      why:
        "the page carries no paid-for-by disclaimer, which a campaign committee's own " +
        "communications are required to carry and a page written ABOUT a campaign is not. " +
        `What it does carry (${input.officeEvidence.join(", ") || "nothing"}) is the vocabulary of ` +
        "writing about a race rather than standing in one.",
    };
  }
  if (organ) {
    return {
      kind: "PARTY_HOSTED_PAGE",
      why:
        `the page identifies itself as a party organisation (${input.partyOrganSelfId.join(", ")}) ` +
        "and carries a paid-for-by disclaimer. RULING 122: it is the page the party publishes about " +
        "them, it renders with the HOST NAMED, and it is never dressed as their own site.",
    };
  }
  return {
    kind: "CAMPAIGN_SITE",
    why:
      "the page carries a paid-for-by disclaimer and does not identify itself as a party " +
      "organisation — a campaign committee's own communication, which is what a campaign site is.",
  };
}
