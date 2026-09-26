/**
 * **FOLLOWING THE CITATION — turning an encyclopedia LEAD into a sourced fact.**
 * A route that did not exist at session start.
 * (Overnight depth hunt, 2026-08-23, item 3 and item 5.)
 *
 * ## How it was conceived — RULING 88 asks, so this answers
 *
 * From reading RULING 87 against the manifest and finding a gap between them.
 * That ruling says, in as many words: **Wikipedia names the person; the
 * citation proves them**, and a fact whose citation cannot be confirmed is a
 * `LEAD` and not a `FOUND`. The manifest holds three Wikipedia routes —
 * `wikipedia-municipality`, `wikipedia-election`, `wikipedia-government-graph`
 * — and every one of them reads the ARTICLE. **Not one of them walks the
 * footnote.** So the ruling names a confirming step that no route in the
 * manifest performs, and nine municipal officials have been sitting at `LEAD`
 * since 2026-08-23 waiting for a step nothing was built to take.
 *
 * Checked against `docs/branch-manifest.md` and `lib/hunt/branch-manifest.ts`
 * BEFORE building, per RULING 63: building a route that already exists is a
 * reported defect, and duplication is worse than a gap. The three Wikipedia
 * routes stop at the article. This one starts where they stop.
 *
 * ## Why it is expansion and not a side quest — RULING 89
 *
 * It ends at `verifiedPage` for nine people the item list already owes. No new
 * surface, no new capability. It reuses `lib/hunt/wikipedia.ts`, which already
 * holds `refs`, `resolveRefNames` and `urlsIn` — the citation MACHINERY was
 * built; the route that walks it was not.
 *
 * ## What "confirmed" means here, and what it deliberately does not
 *
 * The citation target must be a **source of record**, not another encyclopedia.
 * Confirmation requires the cited page to name the person AND the office. A
 * page naming only the person confirms nothing about the seat, and a page
 * naming only the office confirms nothing about the person.
 *
 * **The verdict is capped by the SOURCE, not by the match quality.** A citation
 * pointing at a government host confirms; one pointing at a newspaper is
 * recorded as `PRESS_CONFIRMED` and kept apart, because a press report is
 * evidence about an official and is not the body's own record of its own
 * membership. Collapsing the two would let a decade-old election-night article
 * ship as a current roster.
 *
 * ## RULING 68 and RULING 110 apply unchanged
 *
 * Every fetched citation is control-paired, and every name is searched in the
 * full set of forms with each form recorded whether it matched or not.
 *
 * ## RULING 100 — the count is asserted
 *
 * The lead file states `counts.municipal`. This walks that many, compares, and
 * FAILS on a shortfall rather than reporting whatever it happened to reach.
 *
 *   WTP_STAMP=$(pnpm stamp) pnpm wiki:citation
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlledProbe, type ProbeOutcome } from "../lib/hunt/control-query.ts";
import {
  flattenForEvidence,
  matchNameForms,
} from "../lib/hunt/candidate-evidence.ts";
import { fetchWikitext, refs, resolveRefNames, plain } from "../lib/hunt/wikipedia.ts";
import { politeGetText } from "../lib/sources/http.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEADS = join(ROOT, "data/states/nj/hunt/wiki-leader-leads-07866.json");
const OUT = join(ROOT, "data/states/nj/hunt/wiki-citation-follow.json");
const TIER_DIRECTORIES = join(ROOT, "data/hunt/tier-directories.json");

const STAMP = process.env.WTP_STAMP ?? "";

/**
 * A source of RECORD for who holds a municipal office.
 *
 * Decided against TLD space and against the state's own locality namespace,
 * never a hand-list of hosts — the same test `lib/officials/verification.ts`
 * already applies, for the same reason: an official host is decided by
 * something outside us.
 *
 * A VENDOR portal is deliberately not official. The records are the body's; the
 * site is a third party's.
 */
function isOfficialHost(host: string): boolean {
  return (
    /(^|\.)[a-z0-9-]+\.gov$/.test(host) ||
    /\.mil$/.test(host) ||
    /(^|\.)[a-z0-9-]+\.(?:k12\.)?[a-z]{2}\.us$/.test(host) ||
    stateDesignatedHosts().has(host.replace(/^www\./, ""))
  );
}

/**
 * Hosts the STATE'S OWN DIRECTORY names as a municipality's official website.
 *
 * **A New Jersey municipality's own site is very often on `.org`, and a TLD
 * test alone calls it press.** The first version of this route did exactly
 * that: `rockawaytownship.org`, `rockawayborough.org` and `denvillenj.org` all
 * named their mayor, and all three were filed as `PRESS_CONFIRMED` — "evidence
 * ABOUT an official, never the body's own record of its own membership" —
 * about three towns' own homepages.
 *
 * `CLAUDE.md`'s verification rule already anticipates this. Official is decided
 * against something outside us and never a hand-list: the `.gov`/`.mil` TLDs,
 * RFC 1480's `.us` locality space, **and the hosts the source wiring itself
 * types as a body's own page**. This is that third clause, answered by a better
 * authority than our own wiring — the State of New Jersey's directory of all
 * 21 counties and all 564 municipalities, walked under RULING 93 and committed
 * at `data/hunt/tier-directories.json`. If the state says this host is that
 * municipality's website, that is not our opinion about a TLD.
 *
 * A VENDOR portal is still deliberately not official, and nothing here changes
 * that: the state's directory lists the body's own site, not its agenda host.
 */
let designated: Set<string> | null = null;
function stateDesignatedHosts(): Set<string> {
  if (designated) return designated;
  designated = new Set<string>();
  const dirs = JSON.parse(readFileSync(TIER_DIRECTORIES, "utf8")) as {
    routes: { route: string; entities?: { name: string; url: string }[] }[];
  };
  for (const route of dirs.routes) {
    // Only routes published BY a government about the tier below it.
    if (!/localgov|state-/.test(route.route)) continue;
    for (const e of route.entities ?? []) {
      try {
        designated.add(new URL(e.url).hostname.toLowerCase().replace(/^www\./, ""));
      } catch {
        /* a malformed href in a directory is the directory's, not a reason to stop */
      }
    }
  }
  return designated;
}

/**
 * The official website the STATE names for one municipality.
 *
 * **This is the second branch, and it exists because the first one runs out.**
 * Six of the nine parked leads carry NO footnote at all — the encyclopedia
 * names a municipal clerk or administrator and cites nothing — so there is no
 * citation to follow and the route as first written stops there with nothing.
 *
 * RULING 52: a branch returning empty is one measurement, not a verdict, and
 * where no branch exists one is built. The two are genuinely INDEPENDENT: one
 * goes through Wikipedia's editors and their sources, the other through the
 * State of New Jersey's own directory. They fail for different reasons, which
 * is what independence is counted over.
 *
 * The entity name arrives as `Rockaway Township, New Jersey`; the directory
 * lists `Rockaway Township`. Matching is on the part before the comma, folded,
 * and it REFUSES an ambiguous match rather than picking one — `Rockaway
 * Township` and `Rockaway Borough` are different governments and attaching one
 * town's clerk to the other's page would be a false claim about both.
 */
let byMunicipality: Map<string, string[]> | null = null;
function stateSiteFor(entity: string): string | null {
  if (!byMunicipality) {
    byMunicipality = new Map();
    const dirs = JSON.parse(readFileSync(TIER_DIRECTORIES, "utf8")) as {
      routes: { route: string; entities?: { name: string; url: string }[] }[];
    };
    for (const route of dirs.routes) {
      if (!/localgov/.test(route.route)) continue;
      for (const e of route.entities ?? []) {
        const key = e.name.toLowerCase().replace(/[^a-z ]/g, "").trim();
        byMunicipality.set(key, [...(byMunicipality.get(key) ?? []), e.url]);
      }
    }
  }
  const key = entity.split(",")[0].toLowerCase().replace(/[^a-z ]/g, "").trim();
  const exact = byMunicipality.get(key);
  if (exact && exact.length === 1) return exact[0];
  if (exact && exact.length > 1) return null;

  /*
   * The TYPE SUFFIX, which is where the exact match runs out.
   *
   * Wikipedia titles the article `Denville, New Jersey`; the state's directory
   * lists `Denville Township`. Same government, two names, and an exact match
   * loses it. So the entity is also tried as a PREFIX — `denville` reaches
   * `denville township` and nothing else.
   *
   * **And where the prefix reaches more than one, this refuses.** `rockaway`
   * prefixes BOTH `rockaway borough` and `rockaway township`, which are two
   * different governments with two different mayors sitting a few miles apart.
   * Picking either would attach one town's clerk to the other town's page. A
   * refusal here is a correct answer, not a gap in the matcher, and it is why
   * the four that stay unresolved stay unresolved.
   */
  const prefixed = [...byMunicipality.entries()].filter(
    ([name]) => name === key || name.startsWith(`${key} `),
  );
  if (prefixed.length === 1 && prefixed[0][1].length === 1) return prefixed[0][1][0];
  return null;
}

/** Why a host counted as official, or why it did not. Recorded on every row. */
function officialBasis(host: string): string {
  const bare = host.replace(/^www\./, "");
  if (/(^|\.)[a-z0-9-]+\.gov$/.test(host)) return "a .gov host";
  if (/\.mil$/.test(host)) return "a .mil host";
  if (/(^|\.)[a-z0-9-]+\.(?:k12\.)?[a-z]{2}\.us$/.test(host)) return "RFC 1480 .us locality space";
  if (stateDesignatedHosts().has(bare)) {
    return "named by the State of New Jersey's own directory of its 564 municipalities";
  }
  return "not named as official by any authority outside us";
}

type Verdict =
  /** A government source names this person in this office. */
  | "CONFIRMED_OFFICIAL"
  /** A non-government source does. Kept apart — see the header. */
  | "PRESS_CONFIRMED"
  /** The citation was reached and does not name the person in the office. */
  | "CITATION_SILENT"
  /** The citation could not be reached at all. Never an absence. */
  | "CITATION_UNREACHABLE"
  /** The claim in the article carries no footnote to follow. */
  | "NO_CITATION";

interface Row {
  entity: string;
  name: string;
  officeTitle: string;
  wikipediaUrl: string;
  /** Every citation URL attached to the claim, in article order. */
  citationUrls: string[];
  /** Which branch answered: the article's footnote, or the state's directory. */
  branch: "wikipedia-footnote" | "state-directory" | "none";
  /** The one that answered, if any. */
  confirmedBy: string | null;
  confirmedByHost: string | null;
  /** Why the host counted as official, or why it did not. */
  hostBasis: string;
  verdict: Verdict;
  probeOutcome: ProbeOutcome | null;
  formsSearched: { form: string; kind: string; matched: boolean }[];
  officeNamed: boolean;
  detail: string;
  attemptedAt: string;
  /** The ladder rung, in `CLAUDE.md`'s numbering, always. */
  walkedAtRung: number;
}

async function readBody(url: string): Promise<{ status: number; body: string }> {
  try {
    const r = await politeGetText(url, {});
    return { status: r.status, body: r.text };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 0, body: "" };
  }
}

/**
 * The citations attached to the claim that names this person.
 *
 * **Scoped to the sentence, not to the article**, and the difference is the
 * whole value of the route. A municipality article carries fifty footnotes; the
 * ones that prove the mayor is the mayor are the ones on the mayor's sentence.
 * Taking the article's references wholesale would "confirm" any person against
 * any citation and would be a confirmation instrument that cannot fail — which
 * is worse than no instrument, because it would read as evidence.
 */
function citationsForClaim(wikitext: string, name: string): string[] {
  const surname = name.trim().split(/\s+/).pop() ?? name;
  // Sentences, keeping the refs inline so they stay attached to their claim.
  const sentences = wikitext.split(/(?<=[.;])\s+/);
  const urls: string[] = [];
  for (const s of sentences) {
    const bare = plain(s).toLowerCase();
    if (!bare.includes(name.toLowerCase()) && !bare.includes(surname.toLowerCase())) continue;
    for (const r of resolveRefNames(wikitext, refs(s))) urls.push(...r.urls);
  }
  return [...new Set(urls)];
}

async function main(): Promise<void> {
  if (STAMP === "") {
    throw new Error(
      "WTP_STAMP is unset. Every date entering a document comes from `pnpm stamp`; " +
        "a plausible date is a fabrication (CLAUDE.md, the date rule).",
    );
  }

  const leadFile = JSON.parse(readFileSync(LEADS, "utf8")) as {
    counts: { municipal: number };
    rows: {
      entity: string;
      wikipediaUrl: string;
      officeTitle: string;
      name: string;
      municipal: boolean;
    }[];
  };
  const leads = leadFile.rows.filter((r) => r.municipal);

  /* RULING 100: the source states a count. Yielding fewer FAILS. */
  if (leads.length !== leadFile.counts.municipal) {
    throw new Error(
      `count assertion FAILED: the lead file states ${leadFile.counts.municipal} municipal rows ` +
        `and holds ${leads.length} (RULING 100).`,
    );
  }

  console.log(`following citations for ${leads.length} parked municipal roster leads\n`);

  const probe = new ControlledProbe(async (url: string) => {
    const r = await readBody(url);
    return { status: r.status, length: Buffer.byteLength(r.body, "utf8") };
  });

  /** One wikitext fetch per ARTICLE, not per person. Three articles, nine people. */
  const wikitextByUrl = new Map<string, string>();
  const rows: Row[] = [];

  for (const lead of leads) {
    const title = decodeURIComponent(lead.wikipediaUrl.split("/wiki/")[1] ?? "");
    if (!wikitextByUrl.has(lead.wikipediaUrl)) {
      const wt = await fetchWikitext(title, async (url) => readBody(url), STAMP);
      if (wt.missReason !== null) {
        console.log(`  article miss: ${title} — ${wt.missReason}`);
      }
      wikitextByUrl.set(lead.wikipediaUrl, wt.wikitext ?? "");
    }
    const wikitext = wikitextByUrl.get(lead.wikipediaUrl) ?? "";

    if (wikitext.length === 0) {
      // A reader that came back with nothing has told you about itself.
      rows.push({
        entity: lead.entity,
        name: lead.name,
        officeTitle: lead.officeTitle,
        wikipediaUrl: lead.wikipediaUrl,
        citationUrls: [],
        confirmedBy: null,
        confirmedByHost: null,
        hostBasis: "no host was reached",
        branch: "none",
        verdict: "CITATION_UNREACHABLE",
        probeOutcome: null,
        formsSearched: [],
        officeNamed: false,
        detail: "the article's wikitext could not be fetched, so no citation could be read",
        attemptedAt: STAMP,
        walkedAtRung: 7,
      });
      console.log(`  CITATION_UNREACHABLE  ${lead.name} — article wikitext not fetched`);
      continue;
    }

    const footnotes = citationsForClaim(wikitext, lead.name);
    const stateSite = stateSiteFor(lead.entity);
    // The second branch, appended LAST so a real footnote is tried first.
    // See `stateSiteFor`: six of nine claims carry no footnote at all.
    const citations = stateSite && !footnotes.includes(stateSite)
      ? [...footnotes, stateSite]
      : footnotes;
    if (citations.length === 0) {
      rows.push({
        entity: lead.entity,
        name: lead.name,
        officeTitle: lead.officeTitle,
        wikipediaUrl: lead.wikipediaUrl,
        citationUrls: [],
        confirmedBy: null,
        confirmedByHost: null,
        hostBasis: "no host was reached",
        branch: "none",
        verdict: "NO_CITATION",
        probeOutcome: null,
        formsSearched: [],
        officeNamed: false,
        detail:
          "the article names this person in this office and attaches NO footnote to the claim, " +
          "and the State of New Jersey's directory names no unambiguous official site for this " +
          "municipality either — two independent branches, both empty on this date. A finding " +
          "about the article and the directory, never about the person, and they stay at LEAD.",
        attemptedAt: STAMP,
        walkedAtRung: 7,
      });
      console.log(`  NO_CITATION           ${lead.name} — the claim carries no footnote`);
      continue;
    }

    let best: Row | null = null;
    for (const url of citations) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        continue;
      }
      const make = (id: string): string => (id === url ? url : `https://${host}/${id}`);
      const p = await probe.probe(make, url, { guessed: false });
      const usable = p.outcome === "LEAD" || p.outcome === "HIT";
      const body = usable ? (await readBody(url)).body : "";
      const hay = flattenForEvidence(body);
      const forms = matchNameForms(lead.name, hay);
      // The office must be named too: a page naming only the person confirms
      // nothing about the seat.
      const officeNamed = hay.includes(lead.officeTitle.toLowerCase());
      const named = forms.some((f) => f.matched && f.kind !== "surname");

      const verdict: Verdict = !usable
        ? "CITATION_UNREACHABLE"
        : named && officeNamed
          ? isOfficialHost(host)
            ? "CONFIRMED_OFFICIAL"
            : "PRESS_CONFIRMED"
          : "CITATION_SILENT";

      const row: Row = {
        entity: lead.entity,
        name: lead.name,
        officeTitle: lead.officeTitle,
        wikipediaUrl: lead.wikipediaUrl,
        citationUrls: citations,
        confirmedBy: verdict.startsWith("CONFIRMED") || verdict === "PRESS_CONFIRMED" ? url : null,
        confirmedByHost: host,
        branch: url === stateSite ? "state-directory" : "wikipedia-footnote",
        hostBasis: officialBasis(host),
        verdict,
        probeOutcome: p.outcome,
        formsSearched: forms,
        officeNamed,
        detail:
          verdict === "CONFIRMED_OFFICIAL"
            ? `${host} names ${lead.name} as ${lead.officeTitle}, and is official because it is ` +
              `${officialBasis(host)}`
            : verdict === "PRESS_CONFIRMED"
              ? `${host} names ${lead.name} as ${lead.officeTitle} but is not a government host — ` +
                "evidence ABOUT an official, never the body's own record of its own membership"
              : verdict === "CITATION_SILENT"
                ? `${host} answered but does not name the person and the office together ` +
                  `(name matched: ${named}, office matched: ${officeNamed})`
                : `${host} could not be read: ${p.outcome}`,
        attemptedAt: STAMP,
        walkedAtRung: 7,
      };

      // Keep the strongest verdict this person's citations produced.
      const rank = (v: Verdict): number =>
        v === "CONFIRMED_OFFICIAL" ? 4 : v === "PRESS_CONFIRMED" ? 3 : v === "CITATION_SILENT" ? 2 : 1;
      if (best === null || rank(verdict) > rank(best.verdict)) best = row;
      if (verdict === "CONFIRMED_OFFICIAL") break;
    }

    if (best !== null) {
      rows.push(best);
      console.log(`  ${best.verdict.padEnd(21)} ${best.name.padEnd(22)} ${best.detail}`);
    }
  }

  if (rows.length !== leads.length) {
    throw new Error(
      `count assertion FAILED: ${leads.length} leads walked, ${rows.length} rows produced ` +
        "(RULING 100).",
    );
  }

  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);

  console.log("\n──────── summary ────────");
  console.log(`  leads walked                 ${rows.length} of ${leadFile.counts.municipal}`);
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v} of ${rows.length}`);
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          "The wikipedia-citation-follow route, walked. A route that did not exist before " +
          "2026-08-23. RULING 87 says Wikipedia NAMES the person and the citation PROVES them; " +
          "the manifest's three Wikipedia routes all stop at the article. This walks the footnote " +
          "attached to the CLAIM — scoped to the sentence, never the article's whole reference " +
          "list, because an article-wide match would confirm any person against any citation. " +
          "Written by scripts/hunt-wikipedia-citation.mts.",
        route: "wikipedia-citation-follow",
        tier: "A",
        walkedAt: STAMP,
        tally: Object.fromEntries(tally),
        rows,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

await main();
