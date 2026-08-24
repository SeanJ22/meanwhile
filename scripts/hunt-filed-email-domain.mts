/**
 * **THE FILED EMAIL AS A ROUTE TO THE CAMPAIGN SITE.** A route that did not
 * exist at session start. (Overnight depth hunt, 2026-08-23, item 3 and item 5.)
 *
 * ## How it was conceived — RULING 88 asks, so this answers
 *
 * Not from the manifest. From looking at data this project already held and
 * asking what ELSE it says. Contact at 07866 stands at 272 of 272 because the
 * Morris County Clerk publishes every candidate's filed email in the certified
 * candidate list. Reading eight of those addresses in a row:
 *
 *     tom@tomkean.com                        → tomkean.com
 *     rebecca@rebeccabennettforcongress.com  → rebeccabennettforcongress.com
 *     info@joehathawayforcongress.com        → joehathawayforcongress.com
 *     info@analiliafornj.com                 → analiliafornj.com
 *     bookerteam@corybooker.com              → corybooker.com
 *     info@veronicaforsenate.com             → veronicaforsenate.com
 *     jerseyjustin4senate@gmail.com          → jerseyjustin4senate.org
 *     davidhodas4boe@gmail.com               → davidhodas4boe.org
 *
 * **Seven of the eleven campaign sites this project already holds are sitting
 * inside an email address it has held since the filing was parsed.** Nothing
 * had ever read the right-hand side of the `@`.
 *
 * ## Why this is expansion and not a side quest — RULING 89
 *
 * It ends at `campaignSite`, which the item list owes at 11 of 272. It builds
 * no new surface and no new capability. The test is the DESTINATION.
 *
 * ## Why it is Tier A under RULING 84
 *
 * The cost is one already-committed document for all 272 candidates. Per-entity
 * search — the tier that walled the previous session after six queries — costs
 * once per person and answers for one. This is the shape RULING 84 exists to
 * put first, and it had never been walked at all.
 *
 * ## The two sub-routes
 *
 * **A. The DOMAIN**, where it is not a mailbox provider. 36 of 272 filed on
 * some other domain. That domain is one of four things and the page says which:
 * the campaign's own site, the body's official site (which serves
 * `verifiedPage`, a different field), an employer (which serves `contact`), or
 * something unestablished. **The classification comes from the page, never from
 * the domain's shape** — `chippersonlaw.com` looks like a law firm and is one,
 * and `plastoris.com` looks like a surname and is also a law firm.
 *
 * **B. The LOCAL PART**, where it is campaign-shaped. `jerseyjustin4senate` and
 * `davidhodas4boe` are campaign identities that happen to be sitting in front
 * of a `@gmail.com`, and both resolve to a real site on a different TLD. So a
 * campaign-shaped local part generates `.com`, `.org` and `.net` candidates.
 * These are GUESSED identifiers and are held to RULING 68's bar accordingly.
 *
 * ## RULING 68 — nothing here promotes on a 200
 *
 * Every probe is paired with a control on the same host through the same URL
 * maker, and a response indistinguishable from the control is the host talking
 * about itself. Clearing the control is only the first bar; the page must then
 * NAME the candidate in one of the RULING 110 forms AND carry a word showing it
 * is about standing for office. A guessed identifier that clears both is still
 * only ever recorded with the evidence that got it there.
 *
 * ## RULING 100 — the count is asserted
 *
 * The contact ledger states 272. This walks the ledger, compares what it walked
 * against that stated total, and FAILS on a shortfall.
 *
 *   WTP_STAMP=$(pnpm stamp) pnpm nj:email-domain
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlledProbe, type ProbeOutcome } from "../lib/hunt/control-query.ts";
import {
  FREEMAIL_DOMAINS,
  flattenForEvidence,
  matchNameForms,
  officeEvidenceIn,
  givenSurnamePair,
  partyOrganSelfIdIn,
  verdictFor,
} from "../lib/hunt/candidate-evidence.ts";
import { politeGetText } from "../lib/sources/http.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BALLOT = join(ROOT, "data/ballot/nj-morris-2026.json");
const CONTACTS = join(ROOT, "data/ballot/nj-morris-2026-contacts.json");
const OUT = join(ROOT, "data/hunt/nj-filed-email-domain.json");

const STAMP = process.env.WTP_STAMP ?? "";

/**
 * A local part shaped like a campaign identity rather than a person's mailbox.
 *
 * Word-bounded and office-anchored for the same reason `OFFICE_EVIDENCE` is:
 * a bare `for` matches `crawford`, and a bare `4` matches a house number. Every
 * pattern here has to pair an office or place word with a `for`/`4`, or be an
 * unambiguous campaign word on its own.
 */
const CAMPAIGN_SHAPED_LOCAL =
  /(?:for|4)(?:senate|congress|mayor|council|boe|board|schools?|nj|morris|assembly|committee|township|borough|town)|(?:^|[._-])(?:elect|campaign|vote)(?:$|[._-])|campaign$|\bboe20\d\d/i;

/** TLDs worth trying for a campaign-shaped local part, in order of likelihood. */
const GUESS_TLDS = ["com", "org", "net"] as const;

type Kind =
  /** The page is this candidate's campaign site. Serves `campaignSite`. */
  | "CAMPAIGN_SITE"
  /** A government host. Serves `verifiedPage`, which is a different field. */
  | "OFFICIAL_HOST"
  /**
   * A page about MANY candidates on this ballot — a party organ or a slate.
   *
   * It is not a false NEGATIVE and must never be folded into the misses: a
   * county committee page is a real find for `party-committee-roster` and it
   * often carries links out to the individual campaigns. What it is not is any
   * one candidate's campaign site, and recording it as one would put a party's
   * page behind a named person's name.
   */
  | "SLATE_OR_PARTY"
  /** A live page that is not about this candidacy — usually an employer. */
  | "NOT_A_CANDIDACY"
  /** Nothing usable came back. */
  | "NO_ANSWER";

interface Row {
  candidacyId: string;
  subject: string;
  contestTitle: string;
  subRoute: "domain" | "local-part";
  email: string;
  url: string;
  /** Which scheme answered. A host that refuses HTTPS is not a host that refuses. */
  scheme: string;
  /** Whether the identifier was GUESSED, which decides the control's strictness. */
  guessed: boolean;
  outcome: ProbeOutcome;
  kind: Kind;
  formsSearched: { form: string; kind: string; matched: boolean }[];
  officeEvidence: string[];
  /** Other filed candidates the page names — the slate test. */
  otherCandidatesNamed: string[];
  /** How the page identifies itself as a party organ, if it does. */
  partyOrganSelfId: string[];
  bytes: number;
  /** Prose characters after flattening. Thin prose against many bytes = JS-rendered. */
  proseChars: number;
  control: number;
  detail: string;
  attemptedAt: string;
  /** The ladder rung, in `CLAUDE.md`'s numbering, always. */
  walkedAtRung: number;
}

/** A government host, decided against TLD space rather than a hand-list. */
function isOfficialHost(host: string): boolean {
  return /\.gov$/.test(host) || /\.(?:k12\.)?nj\.us$/.test(host) || /\.mil$/.test(host);
}

/**
 * How many OTHER candidates on this same ballot a page names.
 *
 * **This is the slate test, and it needs no hand-list of party domains — which
 * is the whole reason it is built this way.** A campaign site is about ONE
 * person. A county committee's page is about the whole ticket. The ballot file
 * already holds all 272 filed names, so the corpus that distinguishes them is
 * sitting in the repo and costs nothing.
 *
 * It was written after `morrisdems.org` cleared BOTH of RULING 68's bars for
 * Christopher Russo — the page names him and says *paid for by*, because it is
 * the Morris County Democratic Committee's own site and he filed his contact
 * there. Every test this project had would have recorded a county party organ
 * as one named person's campaign site.
 *
 * Full given-and-surname pairs only. A surname alone is far too common to
 * carry this — `Ward`, `Murphy` and `Young` all sit on the ballot — and a
 * loose match would demote real campaign sites that happen to mention a
 * running mate once.
 */
function otherCandidatesNamedIn(
  flattened: string,
  self: string,
  everyName: { full: string; given: string; family: string }[],
): string[] {
  const selfLower = self.toLowerCase();
  const found: string[] = [];
  for (const n of everyName) {
    if (n.full.toLowerCase() === selfLower) continue;
    const pair = givenSurnamePair(n.given, n.family);
    if (pair.length < 7) continue;
    if (flattened.includes(pair)) found.push(n.full);
  }
  return found;
}

/**
 * How many other candidates a page may name before it stops being one person's
 * campaign site.
 *
 * TWO, because a running mate is normal and a slate of three is not: New Jersey
 * council and school-board tickets routinely run in pairs, and a genuine
 * campaign site naming its partner would be demoted by a threshold of one.
 * Three or more distinct filed candidates on one page is a ticket's page.
 */
const SLATE_THRESHOLD = 3;

async function readBody(url: string): Promise<{ status: number; body: string }> {
  try {
    const r = await politeGetText(url, { profile: "browser" });
    return { status: r.status, body: r.text };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 0, body: "" };
  }
}

/**
 * Whether a host answers at all, and over which SCHEME.
 *
 * **The scheme is part of the route, and treating `https://` as the whole of it
 * cost a real find.** `garykapner.com` refuses HTTPS and serves 533 KB over
 * plain HTTP — a site titled *Gary Kapner for Mendham Township Committee*,
 * carrying *As your candidate for Township Committee*. The first version of
 * this script recorded him as `REFUSED / NO_ANSWER`, which is precisely the
 * shape RULING 52 forbids: one measurement on one route written down as a fact
 * about the subject.
 *
 * A small campaign on old shared hosting is exactly the kind of site that has
 * no certificate, so this is not a rare edge — it correlates with the
 * least-resourced candidates, which is the equal-effort rule's concern pointed
 * at a transport detail.
 */
async function firstAnsweringScheme(host: string): Promise<string | null> {
  for (const scheme of ["https", "http"] as const) {
    const r = await readBody(`${scheme}://${host}`);
    if (r.status >= 200 && r.status < 400 && r.body.length > 0) return `${scheme}://${host}`;
  }
  return null;
}

async function main(): Promise<void> {
  if (STAMP === "") {
    throw new Error(
      "WTP_STAMP is unset. Every date entering a document comes from `pnpm stamp`; " +
        "a plausible date is a fabrication (CLAUDE.md, the date rule).",
    );
  }

  const ballot = JSON.parse(readFileSync(BALLOT, "utf8")) as {
    candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
    contests: { id: string; title: string }[];
  };
  const contacts = JSON.parse(readFileSync(CONTACTS, "utf8")) as {
    contacts: { candidacyId: string; email: string }[];
  };

  const contestTitle = new Map(ballot.contests.map((c) => [c.id, c.title]));
  const byId = new Map(ballot.candidacies.map((c) => [c.id, c]));

  /* RULING 100: the source states a count. Yielding fewer FAILS. */
  const stated = ballot.candidacies.length;
  if (contacts.contacts.length !== stated) {
    throw new Error(
      `count assertion FAILED: the ballot holds ${stated} candidacies and the contact ledger ` +
        `holds ${contacts.contacts.length}. A partial that reconciles is still a wrong answer.`,
    );
  }

  /** Every filed name on this ballot — the corpus the slate test needs. */
  const everyName = ballot.candidacies.map((c) => ({
    full: `${c.givenName} ${c.familyName}`,
    given: c.givenName,
    family: c.familyName,
  }));

  const rows: Row[] = [];
  const probe = new ControlledProbe(async (url: string) => {
    const r = await readBody(url);
    return { status: r.status, length: Buffer.byteLength(r.body, "utf8") };
  });

  let walked = 0;
  let domainTargets = 0;
  let localTargets = 0;

  for (const contact of contacts.contacts) {
    const cand = byId.get(contact.candidacyId);
    if (!cand) continue;
    walked += 1;

    const filed = `${cand.givenName} ${cand.familyName}`;
    const title = contestTitle.get(cand.contestId) ?? "";
    const [local, domain] = contact.email.toLowerCase().split("@");
    if (!domain) continue;

    /** Every URL this candidate's email suggests, with how it was reached. */
    const targets: { url: string; host: string; subRoute: "domain" | "local-part"; guessed: boolean }[] =
      [];

    if (!FREEMAIL_DOMAINS.has(domain)) {
      targets.push({ url: `https://${domain}`, host: domain, subRoute: "domain", guessed: false });
      domainTargets += 1;
    }
    if (CAMPAIGN_SHAPED_LOCAL.test(local)) {
      const slug = local.replace(/[._]/g, "");
      for (const tld of GUESS_TLDS) {
        const host = `${slug}.${tld}`;
        if (host === domain) continue;
        targets.push({ url: `https://${host}`, host, subRoute: "local-part", guessed: true });
      }
      localTargets += 1;
    }

    for (const t of targets) {
      // The scheme is part of the route: try HTTPS, then plain HTTP, and probe
      // whichever answers. See `firstAnsweringScheme`.
      const answering = await firstAnsweringScheme(t.host);
      const url = answering ?? t.url;
      const scheme = url.startsWith("http://") ? "http" : "https";

      /* The control and the real query go through the SAME url-maker, which is
       * what makes the comparison valid — a control fetched from a different
       * path measures a different page. */
      const make = (id: string): string => (id === url ? url : `${scheme}://${t.host}/${id}`);
      const p = await probe.probe(make, url, { guessed: t.guessed });

      const usable = p.outcome === "LEAD" || p.outcome === "HIT";
      const body = usable ? (await readBody(url)).body : "";
      const hay = flattenForEvidence(body);
      const forms = matchNameForms(filed, hay);
      const office = officeEvidenceIn(hay);
      const v = verdictFor(p.outcome, forms, office);
      const others = usable ? otherCandidatesNamedIn(hay, filed, everyName) : [];
      const partyOrgan = usable ? partyOrganSelfIdIn(hay) : [];

      // The classification is read off the PAGE and the host, never off the
      // domain's shape. `plastoris.com` reads like a surname and is a law firm.
      const kind: Kind = !usable
        ? "NO_ANSWER"
        : isOfficialHost(t.host)
          ? "OFFICIAL_HOST"
          : v.outcome === "HIT" && (others.length >= SLATE_THRESHOLD || partyOrgan.length > 0)
            ? "SLATE_OR_PARTY"
            : v.outcome === "HIT"
              ? "CAMPAIGN_SITE"
              : "NOT_A_CANDIDACY";

      const detail =
        kind !== "SLATE_OR_PARTY"
          ? v.detail
          : partyOrgan.length > 0
            ? `${v.detail} — BUT the page identifies ITSELF as a party organisation ` +
              `(${partyOrgan.join(", ")}), so it is the committee's own site and not this ` +
              "person's campaign site. It is a real find for party-committee-roster."
            : `${v.detail} — BUT it also names ${others.length} other filed candidates on this ` +
              `ballot (${others.slice(0, 4).join(", ")}${others.length > 4 ? ", …" : ""}), so it ` +
              "is a slate page and not this person's campaign site";

      rows.push({
        candidacyId: cand.id,
        subject: filed,
        contestTitle: title,
        subRoute: t.subRoute,
        email: contact.email,
        url,
        scheme,
        guessed: t.guessed,
        outcome: v.outcome,
        kind,
        formsSearched: forms,
        officeEvidence: office,
        otherCandidatesNamed: others,
        partyOrganSelfId: partyOrgan,
        bytes: p.length,
        proseChars: hay.length,
        control: p.control,
        detail,
        attemptedAt: STAMP,
        /* Rung 3: a plain fetch carrying the full browser header set. */
        walkedAtRung: 3,
      });

      const flag = kind === "CAMPAIGN_SITE" ? "***" : "   ";
      console.log(`${flag} ${v.outcome.padEnd(8)} ${kind.padEnd(16)} ${filed.padEnd(26)} ${url}`);
      if (kind === "CAMPAIGN_SITE" || kind === "SLATE_OR_PARTY") {
        console.log(`             ${detail}`);
      }
    }
  }

  if (walked !== stated) {
    throw new Error(
      `count assertion FAILED: ${stated} candidacies stated, ${walked} walked (RULING 100).`,
    );
  }

  const hits = rows.filter((r) => r.kind === "CAMPAIGN_SITE");
  const official = rows.filter((r) => r.kind === "OFFICIAL_HOST");
  const slate = rows.filter((r) => r.kind === "SLATE_OR_PARTY");
  const notCand = rows.filter((r) => r.kind === "NOT_A_CANDIDACY");
  const none = rows.filter((r) => r.kind === "NO_ANSWER");
  const peopleHit = new Set(hits.map((r) => r.candidacyId));

  const summary = {
    candidaciesWalked: `${walked} of ${stated}`,
    candidaciesWithANonFreemailDomain: domainTargets,
    candidaciesWithACampaignShapedLocalPart: localTargets,
    urlsProbed: rows.length,
    CAMPAIGN_SITE: hits.length,
    OFFICIAL_HOST: official.length,
    SLATE_OR_PARTY: slate.length,
    NOT_A_CANDIDACY: notCand.length,
    NO_ANSWER: none.length,
    distinctPeopleWithACampaignSite: peopleHit.size,
  };

  console.log("\n──────── summary ────────");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(40)} ${v}`);

  console.log("\nCAMPAIGN SITES found by this route:");
  if (hits.length === 0) {
    // RULING 88: a newly conceived route returning nothing is a reported
    // SUCCESS. The invention is the deliverable, not the yield.
    console.log("  none. The route was conceived, walked and returned zero.");
  }
  for (const h of hits) console.log(`  ${h.subject.padEnd(28)} ${h.url}  [${h.subRoute}]`);

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          "The filed-email-domain route, walked. A route that did not exist before 2026-08-23. " +
          "The Morris County Clerk publishes every candidate's filed email; the right-hand side of " +
          "the @ is frequently the campaign's own domain, and a campaign-shaped left-hand side " +
          "names a domain on another TLD. Written by scripts/hunt-filed-email-domain.mts.",
        route: "filed-email-domain",
        tier: "A",
        walkedAt: STAMP,
        summary,
        rows,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

await main();
