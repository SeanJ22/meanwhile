/**
 * **WIRE THE MORRIS COUNTY GOVERNING BODIES — NJ Hunt 6 item 1.**
 * (2026-08-22. The step NJ Hunt 5 named as the next session's first job.)
 *
 * ```
 * pnpm nj:wire            # regenerate both outputs
 * pnpm nj:wire --dry      # print the gate decision per body and write nothing
 * ```
 *
 * ## What this closes
 *
 * NJ Hunt 5 collected 261 officials and rendered none of them. The gap was never
 * the collection — it was that a name only becomes renderable once its citation
 * has been read (RULING 87), and the wiring step that turns a confirmed name into
 * a `BodyRoster` had never been built.
 *
 * ## The two sources, and which one wins
 *
 * | | Names | Ward / term | Phone | Email |
 * | --- | --- | --- | --- | --- |
 * | Wikipedia + confirmed citation (Tier A) | all seats | usually | no | no |
 * | The body's own roster page (Tier B) | what the page lists | yes | **yes** | **yes** |
 *
 * **The body's own page wins where it is complete**, because it is the government
 * publishing its own membership and it carries contact the encyclopedia never
 * has. Wikipedia fills in where the page could not be parsed, and only for rows
 * whose citation was FETCHED and CONFIRMED against a primary source.
 *
 * ## The completeness gate, and why a partial roster does not ship
 *
 * A roster is a claim about WHO SITS on a body. Rendering four of a six-member
 * council does not under-state a field — it states a false composition, and the
 * two members it drops are invisible rather than marked missing. That is the
 * render-default rule (a null may never manufacture a claim) and the equal-effort
 * rule at once.
 *
 * **This is NOT RULING 26 suppression.** RULING 26 forbids withholding what we
 * hold because something else is missing. Every member found is still held,
 * still in the hunt artifacts, and still hunted on its RULING 53 clock. What the
 * gate refuses is publishing an INCOMPLETE LIST AS A COMPLETE BODY. A body that
 * fails the gate is named in the run's output as owed work, never dropped
 * silently.
 *
 * The gate: the body maps to a registry `#governing` row, at least three members,
 * and the member count reaches the seat count the municipality's own form of
 * government declares.
 *
 * ## Party — from the certified result, and from nothing else
 *
 * M62: a member's party is read from the certified result of the election that
 * put them in the seat. Never an encyclopedia, never a roster page, never a
 * party's own site. `pnpm nj:winners` reads the Morris County Clerk's certified
 * "Winners of the General Election" — 263 winners across three cycles, each with
 * a party, a filed address and usually an email — and this attaches it by
 * surname WITHIN a municipality, refusing a match where two people there share
 * one.
 *
 * The same document settles `partisanship` for the BODY. A body the certified
 * record does not reach is NOT WIRED rather than shipped `UNDETERMINED`: an
 * unsettled partisanship is a gap in the hunt, not a fact about the office.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { heldConfirmation, readCitationLedger } from "../lib/hunt/citation-ledger.ts";
import { join } from "node:path";

import { topOfficesFor } from "../lib/officials/top-offices.ts";
import { declaredSourceStamp } from "../lib/ops/source-stamp.ts";

const ROOT = process.cwd();

/**
 * Every input here is a COMMITTED file, so the stamp is CARRIED from them
 * rather than read off the clock — see `lib/ops/source-stamp.ts` for the class
 * this closes and why a clock call here was two defects, not one.
 */
const SOURCE_FILES = [
  "data/hunt/wikipedia-nj-morris.json",
  "data/hunt/roster-pages-muni-sites-nj-morris.json",
  "data/hunt/nj-morris-certified-winners.json",
  "lib/registry/registry.json",
] as const;
const AS_OF = declaredSourceStamp({
  /*
   * DECLARED, not derived — see `lib/ops/source-stamp.ts`. A clock call here
   * made the artifact unreproducible; asking git made it depend on clone depth,
   * which CI does not have. The newest of these four inputs last changed on
   * 2026-08-22, and this line changes in the same commit as the next one that
   * does.
   *
   * Moved to 2026-08-24 by the NJ depth session: `roster-pages-muni-sites-nj-morris.json`
   * was rewritten that day when `pnpm roster:hunt` grew its sitemap branch, and
   * the artifact was regenerated in the same commit — 19 bodies to 21, 126
   * members to 145.
   *
   * Moved to 2026-08-26 by the descent-resume session, and the input that moved
   * is `lib/registry/registry.json`: 723 bodies were added to it that day — 666
   * promoted from adjudicated descent leads and 57 from the 2022 Census of
   * Governments — so the newest of these four inputs is now that file. The
   * artifact is regenerated in this same commit, which is the half of
   * RULING 102 that a stamp bump on its own would skip.
   *
   * Moved to 2026-08-28 by the finish-aug28 session, and the input that moved is
   * `data/hunt/wikipedia-nj-morris.json`: WGH-16 made the parser multi-capture
   * (one municipality may lie across several legislative districts), so the walk
   * artifact was regenerated from the live sources that day. The rosters are
   * regenerated in this same commit for the same reason the line above gives.
   */
  readOn: "2026-08-28",
  sources: SOURCE_FILES,
});
const DRY = process.argv.includes("--dry");

const WIKI = "data/hunt/wikipedia-nj-morris.json";
/* Read ONCE: a per-municipality read would open the same file 39 times. */
const ledger = readCitationLedger(ROOT);
const PAGES = "data/hunt/roster-pages-muni-sites-nj-morris.json";
const LEDGER = "docs/evidence/njhunt6-morris-rosters.jsonl";
const OUT_TS = "lib/registry/rosters-nj-morris.ts";

interface WikiOfficial {
  name: string;
  title: string | null;
  party: string | null;
  termEnds: number | null;
  seat: string | null;
  body: string | null;
  citationUrls: string[];
}
interface CitationCheck {
  person: string;
  verdict: string;
  confirmedBy: string | null;
  checkedAt: string;
}
interface Municipality {
  title: string | null;
  governingBody: { seats: number | null; bodyName: string | null; form: string | null; plan: string | null } | null;
  mayor: WikiOfficial | null;
  council: WikiOfficial[];
  citationChecks: CitationCheck[];
}
interface PageMember {
  name: string;
  officeTitle: string | null;
  seat: string | null;
  termNote: string | null;
  phone: string | null;
  email: string | null;
  emailHrefMismatch: string | null;
  contactPageUrl?: string | null;
}
interface PageSite {
  municipality: string;
  siteUrl: string;
  rosterUrl: string | null;
  bodyEvidence: string | null;
  bodyConfirmed: boolean;
  personNamesOnPage: string[];
  members: PageMember[];
  attempts: { url: string; status: number; rows: number; strategy: string | null; note: string | null }[];
  walkedAt: string;
  failure: string | null;
}

const wiki = JSON.parse(readFileSync(join(ROOT, WIKI), "utf8")) as {
  municipalities: Municipality[];
};
const pages = JSON.parse(readFileSync(join(ROOT, PAGES), "utf8")) as { sites: PageSite[] };
const registry = JSON.parse(readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8")) as {
  bodies: { id: string }[];
  divisions: { ocdId: string; label: string }[];
};
const bodyIds = new Set(registry.bodies.map((b) => b.id));
const labelFor = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));

const slugOf = (title: string): string =>
  title
    .replace(/,\s*New Jersey$/i, "")
    .replace(/,\s*Morris County$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const surnameOf = (n: string): string => {
  const parts = n
    .replace(/["'“”].*?["'“”]/g, " ")
    .replace(/\b(?:Jr|Sr|II|III|IV)\.?$/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
};

/**
 * **The name a reader sees**, and it is a reader-facing string, so the plain-
 * language rule governs it. Wikipedia writes the body's name mid-sentence and
 * in whatever case the sentence needed — `township council`, `Township
 * Committee`, `borough council` — and the division label already carries the
 * municipality. Concatenating them raw produced *Boonton township Township
 * Committee* and *Rockaway township township council*.
 *
 * So: title-case the body's own words, and prefix the municipality only where
 * the body name does not already contain it.
 */
function bodyNameFor(divisionLabel: string, bodyName: string | null): string {
  const label = divisionLabel.replace(/,\s*New Jersey$/i, "").trim();
  if (bodyName === null) return `${label} governing body`;
  const words = bodyName
    .replace(/^(?:the\s+)/i, "")
    .trim()
    .split(/\s+/)
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  /*
   * The Census label carries the type word in whatever case the boundary file
   * used — "Boonton township". Title-case it, and where the body's own name
   * already opens with that same type word, do not say it twice: "Boonton
   * township" + "Township Committee" is "Boonton Township Committee", not
   * "Boonton township Township Committee".
   */
  const typeInLabel = /\s+(Township|Borough|Town|City)$/i.exec(label)?.[1] ?? null;
  const bare = label.replace(/\s+(?:Township|Borough|Town|City)$/i, "").trim();
  const titledLabel =
    typeInLabel === null
      ? label
      : `${bare} ${typeInLabel[0].toUpperCase()}${typeInLabel.slice(1).toLowerCase()}`;
  if (words.toLowerCase().includes(bare.toLowerCase())) return words;
  if (typeInLabel !== null && new RegExp(`^${typeInLabel}\\b`, "i").test(words)) {
    return `${bare} ${words}`;
  }
  return `${titledLabel} ${words}`;
}

/**
 * **The bodies already curated by hand, which this generator must never
 * duplicate.**
 *
 * `rosterForBody` returns the FIRST match, so a second roster on one bodyId
 * renders nowhere and drifts from the one that does — the guard in
 * `tests/body-rosters.test.ts` exists for exactly that.
 *
 * And the hand-curated row is the BETTER one where both exist. Rockaway
 * Township's council has been wired since 2026-08-14 carrying each member's
 * party read from the Morris County Clerk's certified winners (M62), which no
 * roster page or encyclopedia states. Regenerating over it would have replaced
 * a certified-source fact with silence.
 *
 * Read out of the file rather than hardcoded, so adding a hand-curated roster
 * cannot silently start colliding with a generated one. The pattern tolerates
 * the id sitting on a continuation line — it does for Rockaway Township, and a
 * one-line-only pattern reported that roster as absent when it was not.
 */
const alreadyCurated = (() => {
  const src = readFileSync(join(ROOT, "lib/registry/body-rosters.ts"), "utf8");
  const head = src.split("...NJ_MORRIS_ROSTERS")[0] ?? src;
  return new Set([...head.matchAll(/bodyId:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]));
})();

/**
 * **M62's rung — the county clerk's certified election winners.**
 *
 * `pnpm nj:winners` writes it. A local seat's party is read from the certified
 * result of the election that put the person in it, and from nothing else:
 * never an encyclopedia, never a roster page, never a party's own site.
 *
 * The same document settles `partisanship` for the BODY. A municipality whose
 * council seats appear in a certified winners list under party labels holds
 * partisan seats, and that is the election authority's own record saying so.
 */
interface CertifiedWinner {
  cycle: string;
  municipality: string | null;
  office: string | null;
  name: string;
  party: string;
  email: string | null;
  sourceUrl: string;
}
const certified = JSON.parse(
  readFileSync(join(ROOT, "data/hunt/nj-morris-certified-winners.json"), "utf8"),
) as { winners: CertifiedWinner[]; walkedAt: string };

/** `Rockaway Township` in the clerk's document -> `rockaway_township` here. */
const certifiedBySlug = new Map<string, CertifiedWinner[]>();
for (const w of certified.winners) {
  if (w.municipality === null || w.municipality === "Morris County") continue;
  const slug = w.municipality
    .toLowerCase()
    .replace(/\s*-\s*/g, "_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  certifiedBySlug.set(slug, [...(certifiedBySlug.get(slug) ?? []), w]);
}

/**
 * The party the certified record gives this person, most recent cycle first.
 * Matched on surname WITHIN one municipality, so two people sharing a surname
 * in different towns can never be confused. A surname shared inside one
 * municipality is refused rather than guessed.
 */
function certifiedParty(
  slug: string,
  name: string,
): { party: string; sourceUrl: string; cycle: string } | null {
  const rows = certifiedRowsFor(slug);
  const sn = surnameOf(name);
  const matches = rows.filter((r) => surnameOf(r.name) === sn);
  if (matches.length === 0) return null;
  const distinct = new Set(matches.map((m) => m.name.toLowerCase()));
  if (distinct.size > 1) return null;
  const newest = [...matches].sort((a, b) => b.cycle.localeCompare(a.cycle))[0];
  const label =
    newest.party === "Democrat" ? "Democratic" : newest.party;
  return { party: label, sourceUrl: newest.sourceUrl, cycle: newest.cycle };
}

/** The certified email, used only where the body's own page publishes none. */
function certifiedEmail(slug: string, name: string): string | null {
  const rows = certifiedRowsFor(slug);
  const sn = surnameOf(name);
  const matches = rows.filter((r) => surnameOf(r.name) === sn && r.email !== null);
  if (matches.length === 0) return null;
  if (new Set(matches.map((m) => m.name.toLowerCase())).size > 1) return null;
  return [...matches].sort((a, b) => b.cycle.localeCompare(a.cycle))[0].email;
}

/**
 * **Find the certified rows for a municipality, tolerating the type word.**
 *
 * The clerk writes `Rockaway Borough` and `Wharton Borough`; the encyclopedia
 * titles them `Rockaway, New Jersey` and `Wharton, New Jersey`, so the slugs are
 * `rockaway` and `wharton`. Keying on the exact slug silently found nothing for
 * eight municipalities, and each one then reported as *the certified record does
 * not reach this municipality* — a wrong finding about a public document, caused
 * by a naming convention.
 *
 * The type word may never CROSS, exactly as in the division lookup: a borough
 * may fall back to the untyped form, never to the township of the same name.
 */
function certifiedRowsFor(slug: string): CertifiedWinner[] {
  const bare = slug.replace(/_(?:township|borough|town|city)$/, "");
  const declared = /_(township|borough|town|city)$/.exec(slug)?.[1] ?? null;
  const variants =
    declared === null
      ? [slug, `${slug}_borough`, `${slug}_town`]
      : [slug, `${bare}_${declared}`, bare];
  for (const v of variants) {
    const rows = certifiedBySlug.get(v);
    if (rows !== undefined && rows.length > 0) return rows;
  }
  return [];
}

const MORRIS_CLERK_ORG = "Morris County Clerk (certified general election winners)";

const pageBy = new Map<string, PageSite>();
for (const s of pages.sites) pageBy.set(s.municipality, s);

/* ── The retrieval ledger ───────────────────────────────────────────────── */

/**
 * One line per page fetched: the bytes a public body actually sent, with the
 * URL, the date, the status, the rung and the rows. `tests/body-rosters.test.ts`
 * reads these to decide whether an address was PUBLISHED or merely asserted —
 * proof beats pattern, so an email on an unfamiliar municipal domain no longer
 * has to be dropped to keep a guard green.
 */
const ledgerLines: string[] = [];
for (const site of pages.sites) {
  for (const attempt of site.attempts) {
    const isRoster = attempt.url === site.rosterUrl;
    ledgerLines.push(
      JSON.stringify({
        url: attempt.url,
        label: site.municipality,
        attemptedAt: site.walkedAt,
        finalUrl: attempt.url,
        status: attempt.status,
        rung: 2,
        retrieval: attempt.status === 200 ? "OK" : "REFUSED",
        outcome: attempt.rows > 0 ? "EXTRACTED" : "NO_ROWS",
        rows: attempt.rows,
        strategy: attempt.strategy,
        bodyEvidence: isRoster ? site.bodyEvidence : null,
        reason: attempt.note ?? "",
        people: isRoster
          ? site.members.map((m) => ({
              name: m.name,
              title: m.officeTitle,
              seat: m.seat,
              phone: m.phone,
              email: m.email,
              emailHrefMismatch: m.emailHrefMismatch,
              termText: m.termNote,
            }))
          : [],
      }),
    );
  }
}

/*
 * The certified winners belong in the ledger too. Their addresses are FILED
 * WITH THE ELECTION AUTHORITY and printed in a certified public document — the
 * strongest publication claim available for a contact — but they sit on
 * gmail.com and optonline.net as often as on a municipal domain, so the
 * own-domain fast path cannot see them. Recording the bytes is the stronger of
 * the two ways to pass, and it is the honest one: proof beats pattern.
 */
for (const doc of new Set(certified.winners.map((w) => w.sourceUrl))) {
  const rows = certified.winners.filter((w) => w.sourceUrl === doc);
  ledgerLines.push(
    JSON.stringify({
      url: doc,
      label: "Morris County Clerk — certified winners of the general election",
      attemptedAt: certified.walkedAt,
      finalUrl: doc,
      status: 200,
      rung: 9,
      retrieval: "OK",
      outcome: "EXTRACTED",
      rows: rows.length,
      strategy: "pdf-text-layer",
      reason: "",
      people: rows.map((w) => ({
        name: w.name,
        title: w.office,
        municipality: w.municipality,
        party: w.party,
        email: w.email,
        cycle: w.cycle,
      })),
    }),
  );
}

/* ── The gate ───────────────────────────────────────────────────────────── */

interface Member {
  id: string;
  name: string;
  officeTitle: string;
  termNote: string | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  partyLabel?: string | null;
  partySourceUrl?: string;
  partySourceOrg?: string;
  partyCollectedAt?: string;
}
interface Wired {
  bodyId: string;
  bodyName: string;
  partisanship: "PARTISAN" | "NONPARTISAN" | "UNDETERMINED";
  partisanshipSourceUrl: string | null;
  divisionLabel: string;
  members: Member[];
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  origin: string;
}

/**
 * The four party fields travel together or not at all. A party with no record,
 * no publisher and no read date is exactly the unsourced claim M62 forbids.
 */
function partyFields(slug: string, name: string): Partial<Member> {
  const found = certifiedParty(slug, name);
  if (found === null) return {};
  return {
    partyLabel: found.party,
    partySourceUrl: found.sourceUrl,
    partySourceOrg: MORRIS_CLERK_ORG,
    partyCollectedAt: certified.walkedAt,
  };
}

const wired: Wired[] = [];
const refused: { slug: string; why: string }[] = [];

for (const m of wiki.municipalities) {
  if (m.title === null) continue;
  const slug = slugOf(m.title);
  /*
   * **The slug is not one string.** The registry's divisions come from Census
   * boundary files and carry the municipal type inconsistently — `chatham`,
   * `randolph_township`, `parsippany_troy_hills_township` — while the article
   * title carries whatever Wikipedia disambiguated with. Trying one form left
   * SEVEN municipalities reading "no registry division", which is a naming
   * mismatch reported as a missing government.
   *
   * **The type word may never cross.** `chatham_borough` may fall back to the
   * untyped `chatham`, but it must NEVER be allowed to match `chatham_township`
   * — that is a different government, and generating both variants from one
   * name is how a borough council would be rendered as a township's. So the
   * variants a name generates are only ever its own type and the untyped form.
   */
  const bare = slug.replace(/_(?:township|borough|town|city)$/, "");
  const declaredType = /_(township|borough|town|city)$/.exec(slug)?.[1] ?? null;
  const variants =
    declaredType === null
      ? // An untyped New Jersey municipality is a borough or a town; it is never
        // a township, because a township article always says so.
        [slug, `${slug}_borough`, `${slug}_town`]
      : [slug, `${bare}_${declaredType}`, bare];
  const division =
    variants
      .flatMap((v) => [
        `ocd-division/country:us/state:nj/county:morris/place:${v}`,
        `ocd-division/country:us/state:nj/place:${v}`,
      ])
      .find((d) => bodyIds.has(`${d}#governing`)) ?? null;

  if (division === null) {
    refused.push({ slug, why: "no registry division carries a #governing body for this slug" });
    continue;
  }
  const bodyId = `${division}#governing`;
  if (alreadyCurated.has(bodyId)) {
    refused.push({
      slug,
      why: "already wired by hand in body-rosters.ts — the curated row carries party from a certified result and is the better one. Not a gap.",
    });
    continue;
  }
  if (wired.some((w) => w.bodyId === bodyId)) {
    refused.push({ slug, why: `${bodyId} already wired by another slug — two rosters may not share a body` });
    continue;
  }

  const seats = m.governingBody?.seats ?? null;
  const bodyName = m.governingBody?.bodyName ?? null;
  const page = pageBy.get(slug);

  const checks = new Map((m.citationChecks ?? []).map((c) => [c.person, c] as const));
  const wikiRows = [m.mayor, ...(m.council ?? [])].filter((r): r is WikiOfficial => r !== null);
  /**
   * **The body's own page NAMING someone is a confirmation.**
   *
   * RULING 87 says the encyclopedia names and the citation proves. A citation
   * check that could not reach a page leaves a real officeholder ineligible —
   * Chester Borough's mayor came back `NO_CITATION` while her name, address and
   * phone extension sat on the borough's own Mayor & Council page, behind a
   * Joomla mailto obfuscation the row parser could not read. The body then
   * rendered with no presiding officer.
   *
   * So a name the body's OWN confirmed governing-body page carries counts as
   * confirmed BY THAT PAGE. It is used only to confirm a name the encyclopedia
   * already proposed, never to invent one, and the page it was confirmed
   * against is what the member cites.
   */
  const namedOnOwnPage = new Set(
    (page?.personNamesOnPage ?? []).map((n) => surnameOf(n)),
  );
  const confirmedByPage = (name: string): boolean =>
    namedOnOwnPage.size > 0 && namedOnOwnPage.has(surnameOf(name));

  /**
   * **A HOST THAT IS DOWN TODAY DOES NOT UNMAKE A PROOF TAKEN BEFORE.**
   * (2026-09-01.)
   *
   * This read `verdict === "CONFIRMED"` off TODAY'S walk and nothing else. The
   * walk artifact is overwritten every run, so a citation confirmed last month
   * and unreachable this morning arrived here indistinguishable from one that
   * was never proved — and the member was dropped.
   *
   * It happened. Re-walking on the permitted Wikipedia route returned every
   * Wikipedia-derived number identically and moved 8 citations to UNREACHABLE,
   * and this line deleted **David A. Runfeldt, Mayor of Lincoln Park Borough**,
   * from the reader's page. His citation host was `www.lincolnpark.org`, which
   * had stopped resolving while `lincolnpark.org` answered 200. A borough
   * dropped a `www` and a sitting mayor left this product.
   *
   * `UNREACHABLE` is a fact about a host on a date. It is not evidence that the
   * proof was never taken, and it is not evidence about who governs Lincoln
   * Park. RULING 53 puts a clock on an ABSENCE so it can be re-walked; a
   * CONFIRMATION runs the other way — it was taken, against a named URL, on a
   * named date, and nothing that happens to the host afterwards unmakes it.
   *
   * The held confirmation is scoped to the URL the encyclopedia STILL cites for
   * that person, so a receipt never travels to a source nobody read.
   */
  const heldFor = (r: WikiOfficial) => heldConfirmation(ledger, r.name, r.citationUrls);
  const wikiConfirmed = wikiRows.filter(
    (r) =>
      checks.get(r.name)?.verdict === "CONFIRMED" ||
      confirmedByPage(r.name) ||
      heldFor(r) !== null,
  );
  const wikiCouncilConfirmed = wikiConfirmed.filter((r) => r.body !== "Mayor");

  // Contact from the body's own page, matched by surname.
  const contact = new Map<string, PageMember>();
  if (page?.bodyConfirmed) for (const pm of page.members) contact.set(surnameOf(pm.name), pm);

  /*
   * **Which source states the membership.** The body's own page when it is
   * confirmed as the governing body's page AND lists at least as many people as
   * the form of government declares seats. Otherwise the confirmed Wikipedia
   * rows, which carry a fetched primary-source citation each.
   */
  const pageComplete =
    page?.bodyConfirmed === true &&
    page.rosterUrl !== null &&
    page.members.length >= 3 &&
    (seats === null ? false : page.members.length >= seats);

  const wikiComplete = seats !== null && wikiCouncilConfirmed.length >= seats && wikiConfirmed.length >= 3;

  let members: Member[] = [];
  let sourceUrl: string | null = null;
  let origin = "";

  if (pageComplete && page !== undefined && page.rosterUrl !== null) {
    origin = "the body's own roster page";
    sourceUrl = page.rosterUrl;
    members = page.members.map((pm, i) => ({
      id: `roster:nj-morris-${slug}#${i + 1}`,
      name: pm.name,
      officeTitle: pm.officeTitle && pm.officeTitle.length >= 4 ? pm.officeTitle : (pm.seat ?? "Council Member"),
      termNote: pm.termNote,
      email: pm.email ?? certifiedEmail(slug, pm.name),
      phone: pm.phone,
      websiteUrl: pm.contactPageUrl ?? page.rosterUrl,
      ...partyFields(slug, pm.name),
    }));

    /*
     * **The mayor is ON the governing body, and often on a different page.**
     *
     * New Jersey's Faulkner Act Mayor-Council forms say it outright: *the
     * governing body is comprised of the mayor and the township council*. But a
     * municipal site usually gives the mayor a page of their own, so a council
     * page parsed alone produces a governing body with no mayor — and then no
     * presiding officer at all, which is how Denville Township wired with seven
     * council members and nobody chairing them.
     *
     * The mayor is taken only where the OTHER source confirmed them against a
     * primary source, so this adds a sourced person to a sourced roster and
     * never invents a chair from row order.
     */
    const mayor = wikiConfirmed.find((r) => r.body === "Mayor" || r.title === "Mayor");
    if (mayor !== undefined && !members.some((m) => surnameOf(m.name) === surnameOf(mayor.name))) {
      const c = contact.get(surnameOf(mayor.name));
      members.unshift({
        id: `roster:nj-morris-${slug}#0`,
        name: mayor.name,
        officeTitle: "Mayor",
        termNote: mayor.termEnds === null ? null : `Term ends ${mayor.termEnds}`,
        email: c?.email ?? certifiedEmail(slug, mayor.name),
        phone: c?.phone ?? null,
        websiteUrl: checks.get(mayor.name)?.confirmedBy ?? page.rosterUrl,
        ...partyFields(slug, mayor.name),
      });
    }
  } else if (wikiComplete) {
    origin = "the citation each name was confirmed against";
    // One sourceUrl per roster: the primary-source page that confirmed the most
    // members. Every member also carries its own confirming page.
    const tally = new Map<string, number>();
    for (const r of wikiConfirmed) {
      const url = checks.get(r.name)?.confirmedBy;
      if (url) tally.set(url, (tally.get(url) ?? 0) + 1);
    }
    sourceUrl = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    members = wikiConfirmed.map((r, i) => {
      const c = contact.get(surnameOf(r.name));
      const title =
        r.title && r.title.length >= 4
          ? r.title
          : r.body === "Mayor"
            ? "Mayor"
            : r.seat && r.seat.length >= 4
              ? r.seat
              : "Council Member";
      return {
        id: `roster:nj-morris-${slug}#${i + 1}`,
        name: r.name,
        officeTitle: title,
        termNote: r.termEnds === null ? (c?.termNote ?? null) : `Term ends ${r.termEnds}`,
        email: c?.email ?? certifiedEmail(slug, r.name),
        phone: c?.phone ?? null,
        websiteUrl: checks.get(r.name)?.confirmedBy ?? (confirmedByPage(r.name) ? page?.rosterUrl ?? null : null),
        ...partyFields(slug, r.name),
      };
    });
  }

  if (members.length < 3 || sourceUrl === null) {
    refused.push({
      slug,
      why:
        seats === null
          ? `the form of government states no seat count, so completeness cannot be checked — ` +
            `page ${page?.members.length ?? 0}, wiki-confirmed ${wikiConfirmed.length}. OWED, not absent.`
          : `incomplete: ${seats} seat(s) declared, page listed ${page?.members.length ?? 0}, ` +
            `wiki confirmed ${wikiCouncilConfirmed.length} council. A partial list may not render as a body. OWED.`,
    });
    continue;
  }

  if (!/^https:\/\//.test(sourceUrl)) sourceUrl = sourceUrl.replace(/^http:/, "https:");

  /*
   * **The BODY's partisanship, from the same certified document.** A
   * municipality whose seats appear in a certified winners list under party
   * labels holds partisan seats — the election authority's own record saying
   * so, which is a far better answer than a roster page that mentions no party.
   * Where the record does not reach this municipality the body is not wired at
   * all rather than shipped UNDETERMINED, because an unsettled partisanship is
   * a gap in the hunt and not a fact about the seats.
   */
  const certifiedRows = certifiedRowsFor(slug);
  if (certifiedRows.length === 0) {
    refused.push({
      slug,
      why:
        "the county clerk's certified winners do not reach this municipality, so the SEATS' " +
        "partisanship is unsettled (M62). Not shipped UNDETERMINED — that is a gap in the hunt, " +
        "not a fact about the office. OWED.",
    });
    continue;
  }

  /*
   * **A ROSTER THAT RESOLVES NO PRESIDING OFFICER IS A GARBLED READ, NOT A BODY.**
   * (Added 2026-08-24, the NJ depth session, after the sitemap branch produced
   * exactly one.)
   *
   * `tests/top-offices.test.ts` already asserts that every curated roster
   * resolves a presiding officer, and it caught Hanover Township the moment the
   * new discovery branch reached its page. That is the guard working; what was
   * missing is the gate, because a defect the SUITE catches is a defect that
   * shipped into the artifact and had to be taken back out.
   *
   * The Hanover page is a portfolio table — *Director of Public Works*,
   * *Building Department and Property Maintenance Director* — and the extractor
   * read the portfolios as office titles. One "member" came back as
   * `Krista DiGiorgio / Bid Committee Members` with a list of six other names in
   * its term note, which is the parse failing rather than the town being odd.
   *
   * **This is not suppression.** It is the same completeness gate the seat-count
   * and partisanship checks above apply: the body is OWED with a stated reason
   * and named in `--dry`, exactly like the eighteen others. A New Jersey
   * governing body has someone presiding — the mayor, the chair, the deputy —
   * so a roster with none is a fact about our READ.
   */
  /* `topOfficesFor` reads only `officeTitle` and `id`; the cast keeps this to the
   * two fields the check actually uses rather than building a whole SeatHolder
   * that would then have to be kept in step with a type it does not need. */
  const presiding = topOfficesFor(
    members.map((m, i) => ({ id: `gate:${slug}#${i}`, officeTitle: m.officeTitle ?? null })) as unknown as
      Parameters<typeof topOfficesFor>[0],
  );
  if (presiding.length === 0) {
    refused.push({
      slug,
      why:
        `${members.length} member(s) read and NOT ONE resolves a presiding office. Every NJ ` +
        "governing body has someone presiding, so this is a garbled read rather than a town " +
        "that publishes no chair — most often a department-portfolio table parsed as a roster. OWED.",
    });
    continue;
  }

  wired.push({
    bodyId,
    partisanship: "PARTISAN",
    partisanshipSourceUrl: [...certifiedRows].sort((a, b) => b.cycle.localeCompare(a.cycle))[0].sourceUrl,
    bodyName: bodyNameFor(labelFor.get(division) ?? slug, bodyName),
    divisionLabel: labelFor.get(division) ?? slug,
    members,
    sourceUrl,
    sourceOrg: `${labelFor.get(division) ?? slug}, New Jersey (the body's own page)`,
    collectedAt: page?.walkedAt ?? AS_OF,
    origin,
  });
}

/* ── Report, then write ─────────────────────────────────────────────────── */

console.log(`wiring Morris County governing bodies — ${wiki.municipalities.length} municipalities read\n`);
for (const w of wired) {
  const e = w.members.filter((m) => m.email !== null).length;
  const p = w.members.filter((m) => m.phone !== null).length;
  console.log(
    `  WIRED   ${w.bodyName.padEnd(44)} ${String(w.members.length).padStart(2)} member(s), ` +
      `${e} email, ${p} phone — from ${w.origin}`,
  );
}
console.log("");
for (const r of refused) console.log(`  owed    ${r.slug.padEnd(32)} ${r.why}`);

const totals = {
  municipalitiesRead: wiki.municipalities.length,
  bodiesWired: wired.length,
  bodiesOwed: refused.length,
  membersWired: wired.reduce((n, w) => n + w.members.length, 0),
  membersWithEmail: wired.reduce((n, w) => n + w.members.filter((m) => m.email !== null).length, 0),
  membersWithPhone: wired.reduce((n, w) => n + w.members.filter((m) => m.phone !== null).length, 0),
  membersWithCertifiedParty: wired.reduce(
    (n, w) => n + w.members.filter((m) => m.partyLabel != null).length,
    0,
  ),
};

console.log(
  `\n  bodies wired ${totals.bodiesWired} · owed ${totals.bodiesOwed} · of ${totals.municipalitiesRead} municipalities\n` +
    `  members rendering ${totals.membersWired} · with email ${totals.membersWithEmail} · ` +
    `with phone ${totals.membersWithPhone} · with a party from a certified result ${totals.membersWithCertifiedParty}`,
);

if (DRY) {
  console.log("\n--dry: nothing written");
  process.exit(0);
}

if (totals.bodiesWired === 0) {
  console.error(
    "\n0 bodies passed the gate. A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION — " +
      "refusing to write an empty roster module over a populated one.",
  );
  process.exit(1);
}

writeFileSync(join(ROOT, LEDGER), `${ledgerLines.join("\n")}\n`, "utf8");

const ts = `/**
 * **Morris County, New Jersey — the governing bodies, wired.**
 *
 * GENERATED by \`pnpm nj:wire\` (\`scripts/build-nj-rosters.mts\`) on ${AS_OF}.
 * **Do not hand-edit** — RULING 92: fix the generator, never the artifact. A
 * hand-corrected generated file looks fixed until it regenerates.
 *
 * Every roster here passed the completeness gate: it maps to a registry
 * \`#governing\` body, carries at least three members, and reaches the seat count
 * its municipality's own form of government declares. Membership comes from the
 * body's own roster page where that page is complete, and otherwise from
 * Wikipedia rows whose citation was FETCHED and CONFIRMED against a primary
 * source (RULING 87 — the encyclopedia names, the citation proves).
 *
 * Bodies that did NOT pass are OWED, not absent. \`pnpm nj:wire --dry\` names
 * every one of them with the reason.
 *
 * Party is deliberately absent. NJ municipal seats in these forms are partisan,
 * but a member's party is read from a certified election result (M62) and from
 * nothing else, so \`partisanship\` stays UNDETERMINED and nothing renders.
 */
import type { BodyRoster } from "./body-rosters.ts";

export const NJ_MORRIS_ROSTERS: BodyRoster[] = ${JSON.stringify(
  wired.map((w) => ({
    bodyId: w.bodyId,
    bodyName: w.bodyName,
    members: w.members,
    sourceUrl: w.sourceUrl,
    sourceOrg: w.sourceOrg,
    collectedAt: w.collectedAt,
    partisanship: w.partisanship,
    partisanshipSourceUrl: w.partisanshipSourceUrl ?? undefined,
  })),
  null,
  2,
)};
`;

writeFileSync(join(ROOT, OUT_TS), ts, "utf8");
console.log(`\nwritten ${LEDGER} (${ledgerLines.length} line(s))\nwritten ${OUT_TS}`);
