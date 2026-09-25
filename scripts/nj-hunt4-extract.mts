/**
 * **FROM A PAGE THAT NAMES SOMEBODY TO A FIELD ABOUT THEM.** (NJ Hunt 4 item 5,
 * 2026-08-22.)
 *
 * ```
 * pnpm nj:extract                       # every candidate with a lead
 * pnpm nj:extract --contest rockaway
 * pnpm nj:extract --plan out/plan.json  # a `pnpm ship:candidate` plan, for review
 * ```
 *
 * ## The gap this closes
 *
 * `pnpm nj:rosters` says *this page carries these filed names*, and
 * `pnpm nj:search` says *these URLs came back for this person*. Neither is a
 * field. A municipal directory page naming twelve people and carrying nine
 * emails has told you nothing about WHICH email is whose, and shipping the first
 * one would be the collapsing join this repo has already been bitten by twice —
 * one campaign's books served for three politicians, one FEC committee id shared
 * by three officials.
 *
 * So this re-reads each page and works PER PERSON: it finds the name in the
 * markup and takes only what sits inside that person's own block. Anything it
 * cannot tie to a person is reported as unattributed and shipped nowhere.
 *
 * ## What counts as that person's block
 *
 * The nearest enclosing table row, list item, or `div`/`section`/`article`,
 * whichever is smallest — the shape every roster page on every vendor happens to
 * share, because a roster is a list of people. Where the name is in running
 * prose with no block around it, a character window is used and the result is
 * marked `WINDOW`, which is weaker evidence and is reported as such.
 *
 * ## What it decides, which is nothing
 *
 * It proposes. Every photo is a claim about a real person's face, every blurb is
 * a description of a real person, and both stay with the session and with the
 * author — RULING 55 queues photos for his review and this writes none of them.
 * The plan it emits is read by a human before `pnpm ship:candidate` sees it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { searchableGiven, searchableSurname } from "../lib/ballot/name-case.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const contestFilter = arg("--contest");
const outPath = arg("--out") ?? join(ROOT, "data", "states", "nj", "hunt", "nj-hunt4-fields.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ballot {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: {
    id: string;
    contestId: string;
    familyName: string;
    givenName: string;
    partyLabel: string | null;
  }[];
}
const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
) as Ballot;

interface RosterFile {
  results: {
    municipality: string;
    rows: { pageUrl: string; names: string[] }[];
  }[];
}
const rosters = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "nj", "hunt", "nj-hunt4-rosters.json"), "utf8"),
) as RosterFile;

interface SearchFile {
  candidates: Record<
    string,
    { candidate: string; contestId: string; hits: { url: string; title: string; snippet: string; route: string }[] }
  >;
}
const search = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "nj", "hunt", "nj-hunt4-search.json"), "utf8"),
) as SearchFile;

/* ── page cache, so a directory naming twelve people is fetched once ─────── */
const cache = new Map<string, string | null>();
async function page(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url)!;
  let text: string | null = null;
  try {
    const r = await politeGetText(url, {});
    text = r.text;
  } catch {
    text = null;
  }
  cache.set(url, text);
  await sleep(500);
  return text;
}

/* ── the per-person block ────────────────────────────────────────────────── */

const BLOCK_TAGS = ["tr", "li", "article", "section", "div", "td", "p"];

/**
 * The smallest enclosing block that contains `index`, or a character window when
 * there is none. `kind` says which, because a window is weaker evidence and a
 * report that hid the difference would be presenting a guess as a reading.
 */
function blockAround(html: string, index: number): { text: string; kind: "BLOCK" | "WINDOW" } {
  let best: { start: number; end: number } | null = null;
  for (const tag of BLOCK_TAGS) {
    const open = new RegExp(`<${tag}\\b`, "gi");
    const close = new RegExp(`</${tag}\\s*>`, "gi");
    const opens: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = open.exec(html))) {
      if (m.index > index) break;
      opens.push(m.index);
    }
    close.lastIndex = index;
    const c = close.exec(html);
    if (!c || opens.length === 0) continue;
    const start = opens[opens.length - 1];
    const end = c.index + c[0].length;
    if (end <= index) continue;
    if (!best || end - start < best.end - best.start) best = { start, end };
  }
  if (best && best.end - best.start < 4000) {
    return { text: html.slice(best.start, best.end), kind: "BLOCK" };
  }
  return {
    text: html.slice(Math.max(0, index - 500), index + 900),
    kind: "WINDOW",
  };
}

const EMAIL_RE = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
/** The same address written out in the prose rather than in an `href`. */
const EMAIL_TEXT_RE = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;

/**
 * **THE JAVASCRIPT-CONCATENATED MAILTO, AND WHY READING IT IS NOT A TRICK.**
 *
 * Butler Borough's council page carries no `mailto:` at all. What it carries is
 * `a = 'rverdonik'; b = 'butlerborough.com'; document.write(...)` — the
 * anti-harvesting idiom every CivicPlus-era municipal site uses, which assembles
 * the address in the browser. A plain fetch sees the two halves and no address,
 * and records "no email published", which is a FALSE MISS about a sitting
 * councilman whose address the borough publishes on its own page.
 *
 * Reading the two halves the page itself sent us is the ladder's rung 8 — the
 * structured data the prose hides — and it is not circumvention: nothing is
 * authenticated, nothing is decoded, no access control is passed. The page
 * published the address; it published it in two pieces.
 *
 * Reconstructed addresses are marked so a reader of the report can tell them
 * from one lifted out of an `href`.
 */
const JS_EMAIL_RE = /\ba\s*=\s*['"]([A-Za-z0-9._%+-]+)['"]\s*;\s*b\s*=\s*['"]([A-Za-z0-9.-]+\.[A-Za-z]{2,})['"]/;
const PHONE_RE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;
const IMG_RE = /<img[^>]+src="([^"]+)"[^>]*>/gi;
/** Chrome, never a face. */
const NOT_A_PORTRAIT =
  /logo|banner|icon|seal|crest|spacer|header|footer|arrow|bullet|facebook|twitter|instagram|youtube|linkedin|flag|badge|placeholder|blank|pixel|alert|print|search|menu|nav|social|share/i;

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export interface Extracted {
  candidacyId: string;
  name: string;
  contestId: string;
  pageUrl: string;
  /** BLOCK is the person's own row or card; WINDOW is prose nearby. */
  evidence: "BLOCK" | "WINDOW";
  email: string | null;
  /** Where the address was published: an href, the prose, or the page's own script. */
  emailFrom: string | null;
  phone: string | null;
  imageUrl: string | null;
  /** How far out the portrait was found, and what made that attributable. */
  imageScope: string | null;
  /** The plain text of that person's block, clipped — the record of what was read. */
  read: string;
  readAt: string;
}

const found: Extracted[] = [];
const unattributed: { pageUrl: string; emails: number; phones: number; images: number }[] = [];

/* ── the roster walk, per person ─────────────────────────────────────────── */

const byName = new Map<string, Ballot["candidacies"][number]>();
for (const c of ballot.candidacies) {
  byName.set(`${searchableGiven(c.givenName)} ${searchableSurname(c.familyName)}`.toLowerCase(), c);
}

const contests = new Map(ballot.contests.map((c) => [c.id, c]));

let pagesRead = 0;
for (const result of rosters.results) {
  for (const row of result.rows) {
    const html = await page(row.pageUrl);
    if (html === null) continue;
    pagesRead++;
    let attributed = 0;
    for (const name of row.names) {
      const cand = byName.get(name.toLowerCase());
      if (!cand) continue;
      if (contestFilter && !cand.contestId.includes(contestFilter)) continue;

      const fam = searchableSurname(cand.familyName);
      const giv = searchableGiven(cand.givenName);
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);

      /*
       * **ANCHOR ON THE FULL NAME.** A surname is not a key.
       *
       * The first version searched for the surname alone and attributed a
       * Lincoln Park block reading "Janet Cassidy, Superintendent of
       * Recreation" to WILLIAM Cassidy, and a Kinnelon vote tally reading
       * "CHIRDO, Mabey, Lewis" to Sean Mabey. Both would have shipped another
       * person's contact under a candidate's name, which is the collapsing-join
       * failure this repo has already paid for twice.
       *
       * So the anchor is "Given Family" or "Family, Given" — the two orders a
       * roster is written in — and a block found on the surname ALONE is not
       * used at all. That costs real rows and every one of them is a row that
       * could not be attributed, which is the honest outcome.
       */
      const full = new RegExp(`${esc(giv)}[^<]{0,40}?${esc(fam)}|${esc(fam)},?\\s*${esc(giv)}`, "i");
      const idx = html.search(full);
      if (idx < 0) continue;

      const block = blockAround(html, idx);
      /*
       * **THE PORTRAIT IS OFTEN A SIBLING, NOT A CHILD.**
       *
       * Anchoring on the full name found a tighter block and correctly stopped
       * attributing other people's contacts — and it cost eight portraits,
       * because half these vendors put the face in one `<div>` and the name in
       * the next one. Both are inside the person's CARD; neither is inside the
       * other.
       *
       * So the image is looked for one level out, and only where that wider
       * region names EXACTLY ONE of the filed candidates. A region naming two
       * people cannot say whose face it carries, and a face attached to the
       * wrong name is the worst single error this product could make.
       */
      const wide = blockAround(html, Math.max(0, idx - 1));
      const widerText =
        wide.text.length > block.text.length && wide.text.length < 12_000 ? wide.text : block.text;
      const widerPlain = widerText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const namesInWider = row.names.filter((n) => {
        const f = searchableSurname(byName.get(n.toLowerCase())?.familyName ?? "");
        return f.length >= 3 && new RegExp(esc(f), "i").test(widerPlain);
      }).length;

      /* And the block itself has to carry both names, not just the anchor's page. */
      const blockPlain = block.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      if (!new RegExp(esc(fam), "i").test(blockPlain) || !new RegExp(esc(giv), "i").test(blockPlain)) {
        continue;
      }
      const plain = block.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      /*
       * **THE FILENAME IS THE STRONGEST ATTRIBUTION ON THE PAGE, AND IT IS FREE.**
       *
       * Proximity was the first instrument and it is a weak one: half these
       * vendors put the face in one `<div>` and the name in the next, so a
       * tighter block loses the portrait and a looser one risks attaching a face
       * to the wrong person — the worst single error this product could make.
       *
       * These municipalities name the file after the person.
       * `chathamtownship.org/.../jen_rowland.jpg`,
       * `chesterborough.org/.../gary-marshuetz.jpeg`,
       * `mendhamnj.org/Images/thumb.Althoff1.png`. A surname in the URL of an
       * image on that person's own government's roster page is an EXACT
       * attribution — it is the publisher saying whose face it is — and it does
       * not depend on where the markup happens to put the two.
       *
       * So: the whole page is scanned for an image whose URL carries the
       * surname, and only if none does is the block's own image used, marked as
       * the weaker evidence it is. Neither ships without the author's review
       * under RULING 55.
       */
      const surnameKey = fam.toLowerCase().replace(/[^a-z]/g, "");
      const namedFile =
        surnameKey.length >= 4
          ? [...html.matchAll(IMG_RE)]
              .map((m) => m[1])
              .find(
                (u) =>
                  !NOT_A_PORTRAIT.test(u) &&
                  decodeURIComponent(u).toLowerCase().replace(/[^a-z]/g, "").includes(surnameKey),
              )
          : undefined;

      const imageSource = namesInWider === 1 ? widerText : block.text;
      const images = [...imageSource.matchAll(IMG_RE)]
        .map((m) => m[1])
        .filter((u) => !NOT_A_PORTRAIT.test(u))
        .map((u) => absolute(u, row.pageUrl))
        .filter((u): u is string => Boolean(u));
      const namedAbs = namedFile ? absolute(namedFile, row.pageUrl) : null;
      const imageScope = namedAbs
        ? "the file is named after this person on their own government's page — an exact attribution"
        : images[0]
          ? namesInWider === 1
            ? "the block around the name, which names only this person — PROXIMITY, weaker"
            : "the person's own block — PROXIMITY, weaker"
          : null;

      found.push({
        candidacyId: cand.id,
        name,
        contestId: cand.contestId,
        pageUrl: row.pageUrl,
        evidence: block.kind,
        email:
          EMAIL_RE.exec(block.text)?.[1]?.toLowerCase() ??
          EMAIL_TEXT_RE.exec(plain)?.[1]?.toLowerCase() ??
          (() => {
            const js = JS_EMAIL_RE.exec(block.text);
            return js ? `${js[1]}@${js[2]}`.toLowerCase() : null;
          })() ??
          null,
        emailFrom: EMAIL_RE.test(block.text)
          ? "mailto"
          : EMAIL_TEXT_RE.test(plain)
            ? "prose"
            : JS_EMAIL_RE.test(block.text)
              ? "javascript-concatenated (rung 8)"
              : null,
        phone: PHONE_RE.exec(plain)?.[0] ?? null,
        imageUrl: namedAbs ?? images[0] ?? null,
        imageScope,
        read: plain.slice(0, 300),
        readAt: AS_OF,
      });
      attributed++;
    }
    if (attributed === 0) {
      unattributed.push({
        pageUrl: row.pageUrl,
        emails: (html.match(/mailto:/gi) ?? []).length,
        phones: (html.replace(/<[^>]+>/g, " ").match(new RegExp(PHONE_RE, "g")) ?? []).length,
        images: (html.match(/<img/gi) ?? []).length,
      });
    }
  }
}

/* ── the campaign-site leads, verified rather than trusted ───────────────── */

export interface SiteVerdict {
  candidacyId: string;
  name: string;
  contestId: string;
  url: string;
  status: number | null;
  /** HIT only when the page names the person AND the office or the place. */
  verdict: "HIT" | "LEAD" | "EMPTY" | "WALL";
  detail: string;
  ogImage: string | null;
  ogDescription: string | null;
  readAt: string;
}

const siteVerdicts: SiteVerdict[] = [];
for (const [id, row] of Object.entries(search.candidates)) {
  const cand = ballot.candidacies.find((c) => c.id === id);
  if (!cand) continue;
  if (contestFilter && !cand.contestId.includes(contestFilter)) continue;
  const contest = contests.get(cand.contestId);
  const place = /\/place:([a-z_]+)/.exec(contest?.ocdId ?? "")?.[1]?.replace(/_/g, " ") ?? "";
  const office = (contest?.title ?? "").replace(/^Member of the /, "");
  const fam = searchableSurname(cand.familyName);
  const giv = searchableGiven(cand.givenName);

  for (const hit of row.hits.filter((h) => h.route === "campaign-site")) {
    const html = await page(hit.url);
    if (html === null) {
      siteVerdicts.push({
        candidacyId: id,
        name: row.candidate,
        contestId: cand.contestId,
        url: hit.url,
        status: null,
        verdict: "WALL",
        detail: "the host did not answer this client — one branch, one date, not a verdict",
        ogImage: null,
        ogDescription: null,
        readAt: AS_OF,
      });
      continue;
    }
    const plain = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const namesThem = new RegExp(`${fam}`, "i").test(plain) && new RegExp(`${giv}`, "i").test(plain);
    const namesRace =
      (place && new RegExp(place.split(" ")[0], "i").test(plain)) ||
      new RegExp(office.split(" ")[0], "i").test(plain);
    siteVerdicts.push({
      candidacyId: id,
      name: row.candidate,
      contestId: cand.contestId,
      url: hit.url,
      status: 200,
      /*
       * RULING 68 and the transparency mandate's evidence standard. The URL was
       * found by a search engine, so the identifier was not guessed — but "this
       * domain belongs to THIS filed candidate" is still a claim about a real
       * person. A page that names the person AND the race is a HIT; a page that
       * names only the person is a LEAD; a page that names neither is EMPTY,
       * and EMPTY is a fact about this URL rather than about the candidate.
       */
      verdict: namesThem && namesRace ? "HIT" : namesThem ? "LEAD" : "EMPTY",
      detail: namesThem
        ? namesRace
          ? `the page carries "${giv} ${fam}" and the race`
          : `the page carries the name but nothing about ${office} in ${place || "this place"}`
        : "the page does not carry the candidate's name",
      ogImage: /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html)?.[1] ?? null,
      ogDescription:
        /<meta[^>]+(?:property|name)="og:description"[^>]+content="([^"]+)"/i.exec(html)?.[1] ?? null,
      readAt: AS_OF,
    });
  }
}

/* ── the counts ──────────────────────────────────────────────────────────── */

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ walkedAt: AS_OF, roster: found, sites: siteVerdicts, unattributed }, null, 2),
  "utf8",
);

const withEmail = found.filter((f) => f.email).length;
const withPhone = found.filter((f) => f.phone).length;
const withImage = found.filter((f) => f.imageUrl).length;
const block = found.filter((f) => f.evidence === "BLOCK").length;
console.log(
  `\nroster extraction — ${pagesRead} page(s) re-read, ${found.length} person-block(s) located ` +
    `for ${new Set(found.map((f) => f.candidacyId)).size} distinct candidate(s).`,
);
console.log(
  `  evidence: ${block} from the person's own block, ${found.length - block} from a prose window (weaker, and reported as such)`,
);
console.log(`  email ${withEmail} · phone ${withPhone} · portrait candidate ${withImage}`);
console.log(
  `  ${unattributed.length} page(s) carried a filed name but no block could be tied to a person; ` +
    `nothing from those pages is proposed.`,
);
const hits = siteVerdicts.filter((s) => s.verdict === "HIT");
console.log(
  `\ncampaign-site verification — ${siteVerdicts.length} URL(s) read: ` +
    `${hits.length} HIT · ${siteVerdicts.filter((s) => s.verdict === "LEAD").length} LEAD · ` +
    `${siteVerdicts.filter((s) => s.verdict === "EMPTY").length} EMPTY · ` +
    `${siteVerdicts.filter((s) => s.verdict === "WALL").length} WALL`,
);
if (pagesRead === 0 && siteVerdicts.length === 0) {
  console.error("NOTHING WAS READ — that is a failed run, not an empty one.");
  process.exit(1);
}
console.log(`\nwritten ${outPath}`);
