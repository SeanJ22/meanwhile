/**
 * `pnpm leads:adjudicate-descent` — TURN LEADS INTO BODIES, OR SAY WHY NOT.
 * (2026-08-26, the descent-resume session. **RULING 183**, **RULING 181**.)
 *
 * ## Why this command had to exist before any more walking
 *
 * At this session's start every one of the three descent workstreams reported
 * the same number:
 *
 * ```
 * candidates   693 lead(s), 0 promoted body/bodies  <- the coverage numerator
 * candidates   720 lead(s), 0 promoted body/bodies  <- the coverage numerator
 * candidates   259 lead(s), 0 promoted body/bodies  <- the coverage numerator
 * ```
 *
 * `CandidateState` has declared `ENTITY_VERIFIED` and `BODY_PROMOTED` since the
 * governance remediation landed, and `workstream.ts` has validated their
 * invariants ever since. **No file in the repository ever performed either
 * transition.** The coverage numerator was not low, it was structurally pinned:
 * a descent could run for a hundred passes and it would still read zero,
 * because nothing anywhere could write the state that raises it.
 *
 * So walking further first would have grown the lead pile against a numerator
 * that could not move — which is the exact shape RULING 183 was adopted
 * against, one level up: not a lead counted as a body, but a lead pile counted
 * as a walk.
 *
 * ## The three gates, cheapest first
 *
 * 1. **Triage** (`lib/hunt/lead-triage.ts`) — no network. Rejects on evidence
 *    visible in the link: an association's own PDF, a video host, a court
 *    opinion, an opening-hours line. Terminal: `REJECTED_FALSE_POSITIVE`, with
 *    a written reason, and the row keeps its URL forever (RULING 88).
 * 2. **The name** (`lib/hunt/entity-name.ts`) — no network. Does the string
 *    name a body at all? A failure here is `NEEDS_CLASSIFICATION` and **NOT a
 *    rejection**, because "my heuristic cannot read this name" is a fact about
 *    the heuristic. `Law Division - Civil Part` is a real court and this test
 *    cannot tell; saying so is honest and saying "not a body" would not be.
 * 3. **The page** — network, and the only gate that can promote. Fetch it,
 *    require the document to NAME the entity in its own title or heading, and
 *    record what it said. A 200 is not evidence (RULING 100, section 17): the
 *    control is what the page called itself.
 *
 * ## Promotion, and the one thing it may not do
 *
 * A verified entity is matched against `lib/registry/registry.json` first. If
 * the registry already holds it, the lead is `DUPLICATE` — it is the same
 * government, found by a new route, and that is knowledge about the route
 * rather than a new body. Only an entity the registry does not hold is
 * promoted, and promotion writes a registry row and puts its id on the lead.
 *
 * **Coverage rises by exactly the number of rows written.** Nothing else in
 * this file touches the numerator.
 *
 * Usage:
 *   pnpm leads:adjudicate-descent --state nj --dry
 *   pnpm leads:adjudicate-descent --state nj --budget 120
 *   pnpm leads:adjudicate-descent --state nj --budget 200 --pilot
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadWorkstream, saveWorkstream, deriveCursor } from "../lib/workstate/frontier.ts";
import {
  classifyCandidate,
  promoteCandidate,
  verifyCandidate,
} from "../lib/workstate/candidates.ts";
import { triageLead } from "../lib/hunt/lead-triage.ts";
import { readsAsBodyName } from "../lib/hunt/entity-name.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The jurisdictions a pilot ZIP actually sits in.
 *
 * `--pilot` orders the queue by these before anything else, because the four
 * pilot ZIPs are what a reader can actually load today. A Burlington County
 * courthouse is owed and is not owed FIRST.
 */
const PILOT_TERMS: Record<string, string[]> = {
  nj: ["rockaway", "morris", "njleg", "nj.gov", "state.nj.us"],
  az: ["pima", "tucson", "vail", "az.gov", "azleg"],
  nh: ["newbury", "merrimack", "nh.gov", "gc.nh.gov"],
};

interface Fetched {
  readonly status: number;
  readonly html: string;
  readonly rung: number;
}

/** The same ladder the descent walks, for the same reasons. */
async function getPage(url: string): Promise<Fetched | null> {
  const rungs: { rung: number; headers: Record<string, string> }[] = [
    {
      rung: 2,
      headers: {
        "user-agent": "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)",
        accept: "text/html,*/*",
      },
    },
    {
      rung: 3,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    },
  ];
  for (const step of rungs) {
    try {
      const res = await fetch(url, {
        headers: step.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { status: res.status, html: await res.text(), rung: step.rung };
    } catch {
      /* a transport failure is not an answer — next rung */
    }
  }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(
      "curl",
      ["-sL", "--max-time", "20", "-w", "\n__WTP__%{http_code}", "-A", BROWSER_UA, url],
      { timeout: 35_000, maxBuffer: 24 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP__");
    if (cut < 0) return null;
    const status = Number(stdout.slice(cut + "\n__WTP__".length).trim());
    if (status >= 200 && status < 300) return { status, html: stdout.slice(0, cut), rung: 4 };
  } catch {
    /* rung 4 refused too */
  }
  return null;
}

/**
 * Decode the HTML entities a title actually contains.
 *
 * The first version of this named five entities by hand and `&#8211;` was not
 * among them. That one omission promoted eight bodies with names like
 * **"Bergen County, NJ &#8211; Official Website"**, because the site-chrome
 * splitter looks for a dash and an undecoded en-dash is not one — so the
 * chrome never came off, the name never matched the registry's existing
 * `county:bergen` row, and a county the project already held was written a
 * second time under a name no reader would ever type.
 *
 * A numeric range is the fix, not a longer list: any `&#NNN;` or `&#xHH;` is a
 * character, and enumerating them by hand is how the first five got chosen and
 * the sixth got missed.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&amp;/gi, "&");
}

/** What the document calls itself: `<title>` and the first two headings. */
function selfDescription(html: string): { title: string; headings: string[] } {
  const strip = (s: string): string =>
    decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const hs: string[] = [];
  const rx = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && hs.length < 4) {
    const h = strip(m[1]);
    if (h) hs.push(h);
  }
  return { title: t ? strip(t[1]) : "", headings: hs };
}

/**
 * Does the document name this entity?
 *
 * The control is a WORD-OVERLAP test rather than a substring test, because a
 * page titled "State Board of Education | NJ Department of Education" does
 * contain the name and a page titled "New Jersey Department of Education"
 * does not contain "State Board of Education" while being the right site. The
 * distinctive words are what matter: the ones that are not "of", "the",
 * "new", "jersey" or a body noun every page on the host carries.
 */
const STOP = new Set([
  "of", "the", "and", "for", "a", "an", "in", "on", "to", "&", "nj", "az", "nh",
  "new", "jersey", "arizona", "hampshire", "state", "county", "office", "department",
]);

/**
 * Strip the site chrome a page hangs off its own name.
 *
 * `New Jersey Department of Education - Home Page`, `Appellate Division | NJ
 * Courts`, `NJ Motor Vehicle Commission - NJMVC`. The body's name is the part
 * before the separator; the part after is the site it lives on.
 *
 * Only the LAST segment comes off, and only when something survives: a title
 * that is nothing but chrome is left alone rather than emptied.
 */
function stripChrome(s: string): string {
  let out = s.trim();
  /* "Official Website", "Home Page", "Welcome" are what a CMS appends; no body
   * is called one. Removed BEFORE the separator split, or the split keeps them
   * as the head of a two-part title and the body is named after its CMS. */
  out = out
    .replace(/[\s|·–—,-]*\b(official\s+web\s*site|official\s+site|home\s*page|welcome)\s*$/i, "")
    .trim();
  const cut = out.split(/\s+[|·–—]\s+|\s+-\s+/);
  if (cut.length < 2) return out;
  const head = cut.slice(0, -1).join(" - ").trim();
  return head.length >= 4 ? head : out;
}

/**
 * Title-case a name that arrived lower-cased, without shouting the joining
 * words: every migrated lead is lower-cased, and a naive per-word capitaliser
 * writes "Appellate Division Of Superior Court".
 */
const SMALL_WORDS = new Set(["of", "the", "and", "for", "a", "an", "in", "on", "to", "at", "by"]);
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.replace(/^\w/, (c) => c.toUpperCase())))
    .join(" ");
}

/**
 * The keys a name should be looked up under in the registry.
 *
 * "Bergen County" and the census division tail "bergen" are the same
 * government. The registry holds the second; the descent finds the first. Both
 * spellings are probed, or every one of New Jersey's twenty-one counties gets
 * promoted a second time under a slightly longer name — which is a duplicate
 * government in a product whose whole claim is that it knows who governs you.
 */
function lookupKeys(name: string): string[] {
  const base = normName(name);
  const keys = new Set<string>([base]);
  const geo = /\s+(county|city|borough|township|town|village|state)$/;
  let trimmed = base;
  while (geo.test(trimmed)) {
    trimmed = trimmed.replace(geo, "").trim();
    if (trimmed) keys.add(trimmed);
  }
  return [...keys].filter(Boolean);
}

function namesEntity(name: string, doc: { title: string; headings: string[] }): string | null {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length === 0) return null;
  const haystacks = [doc.title, ...doc.headings].filter(Boolean);
  for (const h of haystacks) {
    const low = h.toLowerCase();
    const hit = words.filter((w) => low.includes(w)).length;
    /* Every distinctive word for a one- or two-word name; a clear majority for
     * a longer one, so "Board on Attorney Certification" is not defeated by a
     * page that writes it "Board on Attorney Certification (BAC)". */
    const need = words.length <= 2 ? words.length : Math.ceil(words.length * 0.6);
    if (hit >= need) return h;
  }
  return null;
}

/** ------------------------------------------------------------------ registry */

interface RegistryBody {
  id: string;
  /* Nullable, because a promoted body's division is genuinely not established
   * by the descent — see the note where the row is built. */
  ocdId: string | null;
  name: string | null;
  bodyClass: string;
  bodyOrigin: string;
  coverageStatus: string;
  agendaSourceType: string;
  agendaSourceRef: string | null;
  meetingCadence: string | null;
  homepageUrl: string | null;
  demandCount: number;
  sourceDataset: string;
  provenance: {
    sourceUrl: string | null;
    sourceOrg: string | null;
    collectedAt: string;
    verifiedAt: string | null;
  };
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|of|and|for|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A registry id for a body the census divisions never contained.
 *
 * Derived from the jurisdiction and a slug of the name, so the same body found
 * twice by two routes lands on the same id and the second is a `DUPLICATE`
 * rather than a second row. It is deliberately NOT an `ocd-division` id: OCD
 * ids name DIVISIONS, and a state agency is not a division of anything.
 */
function bodyIdFor(state: string, name: string): string {
  const slug = normName(name).replace(/\s+/g, "_").slice(0, 70);
  return `wtp-body/country:us/state:${state}/${slug}#governing`;
}

async function main(): Promise<void> {
  const state = (arg("state") ?? "").trim().toLowerCase();
  if (!state) throw new Error("pnpm leads:adjudicate-descent --state <code>");
  const dry = has("dry");
  const budget = Number(arg("budget") ?? 60);
  const pilotFirst = has("pilot");
  const stamp = today();

  const w = loadWorkstream(ROOT, state);
  if (!w) throw new Error(`no canonical work state for ${state} — data/workstate/${state}.json is absent`);

  const registryPath = join(ROOT, "lib/registry/registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    generatedAt: string;
    divisions: unknown[];
    bodies: RegistryBody[];
  };

  /* Every name the registry already holds, for this state, normalised once. */
  const heldNames = new Map<string, string>();
  for (const b of registry.bodies) {
    if (!b.id.includes(`state:${state}`)) continue;
    if (b.name) heldNames.set(normName(b.name), b.id);
    const tail = b.ocdId?.split("/").pop();
    if (tail) heldNames.set(normName(tail.replace(/^[a-z_]+:/, "").replace(/_/g, " ")), b.id);
  }
  const heldIds = new Set(registry.bodies.map((b) => b.id));

  const pending = w.candidates.filter(
    (c) => c.state === "ENTITY_CANDIDATE" || c.state === "NEEDS_CLASSIFICATION",
  );

  /* ---- gate 1 and 2: offline, and every lead in the pool gets both ------- */
  const counts = {
    seen: pending.length,
    rejected: 0,
    needsClassification: 0,
    toFetch: 0,
    fetched: 0,
    unreachable: 0,
    challenged: 0,
    controlFailed: 0,
    verified: 0,
    promoted: 0,
    duplicate: 0,
  };
  const rejectedBy = new Map<string, number>();
  const openable: { id: string; name: string; url: string; tier: string }[] = [];

  for (const c of pending) {
    const t = triageLead({ text: c.text, url: c.url });
    if (!t.keep) {
      if (!dry) classifyCandidate(w, c.id, "REJECTED_FALSE_POSITIVE", `${t.rule}: ${t.reason}`);
      counts.rejected += 1;
      rejectedBy.set(t.rule, (rejectedBy.get(t.rule) ?? 0) + 1);
      continue;
    }
    const n = readsAsBodyName(c.text);
    if (!n.isBody) {
      /* NOT a rejection. The heuristic could not read it, which is a fact
       * about the heuristic and is recorded as one (RULING 184). */
      if (!dry) {
        classifyCandidate(
          w,
          c.id,
          "NEEDS_CLASSIFICATION",
          `name test could not read this as a body name — ${n.basis}. This is a limit of the current method version, NEVER a finding that no body is here.`,
        );
      }
      counts.needsClassification += 1;
      continue;
    }
    openable.push({ id: c.id, name: n.name, url: c.url, tier: c.tier });
  }
  /*
   * ONE ENTRY PER ENTITY, not per sighting.
   *
   * Canonical state holds a row per sighting, and `candidateId` is the same
   * for two sightings of one government (see `rowsFor`). Without this, the
   * first sighting promotes the body and the second reaches the duplicate
   * branch, which calls `classifyCandidate` on a row that is now
   * BODY_PROMOTED — and that throws, correctly. The list of things to open is
   * a list of entities.
   */
  const seenIds = new Set<string>();
  const entities = openable.filter((x) => (seenIds.has(x.id) ? false : (seenIds.add(x.id), true)));
  const extraSightings = openable.length - entities.length;
  openable.length = 0;
  openable.push(...entities);
  counts.toFetch = openable.length;

  /* Pilot jurisdictions first when asked. A stable sort, so a re-run with the
   * same budget opens the same leads and the run is reproducible. */
  if (pilotFirst) {
    const terms = PILOT_TERMS[state] ?? [];
    const score = (x: { url: string; name: string }): number =>
      terms.some((t) => `${x.url} ${x.name}`.toLowerCase().includes(t)) ? 0 : 1;
    openable.sort((a, b) => score(a) - score(b));
  }

  /* ---- gate 3: the network, and the only gate that promotes -------------- */
  const promotedRows: RegistryBody[] = [];
  const log: string[] = [];

  for (const lead of openable) {
    if (counts.fetched >= budget) break;

    /* The registry check comes BEFORE the fetch: a body we already hold does
     * not need a request to tell us so, and spending the budget on it would
     * be spending it on the one outcome that cannot raise coverage. */
    const already = lookupKeys(lead.name)
      .map((k) => heldNames.get(k))
      .find(Boolean);
    if (already) {
      if (!dry) {
        classifyCandidate(
          w,
          lead.id,
          "DUPLICATE",
          `the registry already holds this body as ${already}; this lead is a NEW ROUTE to a known body, which is knowledge about the route`,
        );
      }
      counts.duplicate += 1;
      continue;
    }

    counts.fetched += 1;
    const page = await getPage(lead.url);
    if (!page) {
      /* Left as ENTITY_CANDIDATE on purpose: a wall is not a verdict, and this
       * lead is still owed (RULING 184, section 6). */
      counts.unreachable += 1;
      log.push(`  UNREACHABLE   ${lead.name} — ${lead.url}`);
      continue;
    }

    const doc = selfDescription(page.html);

    /*
     * A CHALLENGE IS A TRANSPORT STATE, NOT A VERDICT ON THE DOCUMENT.
     *
     * Cloudflare answers HTTP 200 with a page titled "Just a moment...". Before
     * this check, that 200 went straight into the control test, failed it —
     * because a loading screen does not name the body — and the lead was filed
     * as NEEDS_CLASSIFICATION with the evidence "its title reads Just a
     * moment...".
     *
     * That is precisely the collapse RULING 182 exists to prevent, one field
     * over: a fact about the connection written down as a fact about the
     * document. The lead stays ENTITY_CANDIDATE, which is what an owed and
     * unopened lead is, and the challenge is named.
     */
    if (/just a moment|checking your browser|attention required|enable javascript and cookies/i.test(doc.title)) {
      counts.challenged += 1;
      log.push(`  CHALLENGED    ${lead.name} — interstitial at ${new URL(lead.url).hostname}, not the document`);
      continue;
    }

    const hit = namesEntity(lead.name, doc);
    if (!hit) {
      if (!dry) {
        classifyCandidate(
          w,
          lead.id,
          "NEEDS_CLASSIFICATION",
          `fetched HTTP ${page.status} at rung ${page.rung}, but the document does not name this entity: its title reads "${doc.title.slice(0, 120)}". A 200 that describes something else is not evidence for this body.`,
        );
      }
      counts.controlFailed += 1;
      log.push(`  CONTROL FAIL  ${lead.name} — page says "${doc.title.slice(0, 60)}"`);
      continue;
    }

    const id = bodyIdFor(state, lead.name);
    if (heldIds.has(id)) {
      if (!dry) classifyCandidate(w, lead.id, "DUPLICATE", `already promoted in this run as ${id}`);
      counts.duplicate += 1;
      continue;
    }
    heldIds.add(id);
    heldNames.set(normName(lead.name), id);

    /*
     * THE BODY'S NAME COMES FROM THE BODY.
     *
     * The first dry run recorded "Department Of Education" from a link text,
     * off a page whose own title read "New Jersey Department of Education".
     * The link text is what some OTHER site called it; the page is the body
     * speaking about itself, and it is also where the capitalisation is real
     * — every migrated lead is lower-cased, so title-casing the link text
     * produces "Nj Motor Vehicle Commission".
     *
     * The page's name is only taken when it still carries the lead's
     * distinctive words after the site chrome comes off, so a title that
     * drifted to something broader cannot rename the body.
     */
    const fromPage = stripChrome(hit);
    const keepsIdentity = namesEntity(lead.name, { title: fromPage, headings: [] }) !== null;
    const officialName = keepsIdentity && fromPage.length <= 90 ? fromPage : titleCase(lead.name);

    /*
     * THE NAME TEST RUNS AGAIN, ON THE NAME THAT WILL ACTUALLY BE RECORDED.
     *
     * The first calibration pass ran it only on the LINK TEXT, and the second
     * dry run showed what that costs: the lead "burlington county" passed —
     * it names a county — and the page it pointed at was the county's
     * affordable-housing document index. The control held on the word
     * "Burlington", the page's own title became the name, and "Burlington
     * County Affordable Housing Documents" was promoted as a unit of
     * government. Nine more like it in the same run.
     *
     * A body is only promoted if the string that will appear in the registry
     * reads as a body's name. Anything else is the page telling us it is a
     * document, and it is recorded as needing classification rather than
     * rejected — the county is real, this route to it is just not the body.
     */
    let finalName = readsAsBodyName(officialName);

    /*
     * THE PAGE TITLE IS THE BODY'S NAME PLUS A SUFFIX, OFTEN ENOUGH TO MATTER.
     *
     * Read off the Arizona run's own output: the lead "defensive driving board"
     * landed on a page titled "Defensive Driving Board Information", and
     * "flood control district advisory committee" on "Flood Control District
     * Advisory Committee Agendas, Minutes & Information". Both are real bodies.
     * Both failed, because the name that would have been recorded heads on
     * "information" — the page's, not the body's.
     *
     * The rescue is a PREFIX test and nothing looser: the page's name must
     * begin with the lead's name, so the title is the body plus a tail. That
     * refuses the cases it should — "AZ Courts Locator" does not begin with
     * "court locator", and "AZCourts.gov > Education Services" is a breadcrumb
     * that begins with the site — while recovering the ones where a CMS simply
     * appended what the page holds.
     */
    if (!finalName.isBody) {
      const leadName = titleCase(lead.name);
      const asLead = readsAsBodyName(leadName);
      if (asLead.isBody && normName(officialName).startsWith(normName(leadName))) {
        finalName = asLead;
        log.push(`  SUFFIXED      ${asLead.name} — page title adds "${officialName.slice(normName(leadName).length).slice(0, 40)}"`);
      }
    }

    if (!finalName.isBody) {
      if (!dry) {
        classifyCandidate(
          w,
          lead.id,
          "NEEDS_CLASSIFICATION",
          `the page named itself "${officialName.slice(0, 100)}", which is not a body's name — ${finalName.basis}. The lead text read as a body and the document does not; a real body may still be behind this route.`,
        );
      }
      counts.controlFailed += 1;
      log.push(`  NOT A BODY    ${lead.name} — page is "${officialName.slice(0, 55)}"`);
      continue;
    }

    /* Verification happens HERE and not a line earlier: the page has now
     * cleared both controls — it named the entity, and what it named it is a
     * body's name. Verifying before the second check would put the lead
     * through ENTITY_VERIFIED on its way to NEEDS_CLASSIFICATION, writing a
     * state it never actually earned into a store other sessions read. */
    const evidence = `fetched ${lead.url} — HTTP ${page.status} at rung ${page.rung} on ${stamp}; the document names itself "${hit.slice(0, 140)}"`;
    if (!dry) verifyCandidate(w, lead.id, evidence);
    counts.verified += 1;

    const row: RegistryBody = {
      id,
      /*
       * NULL, AND THE NULL IS THE HONEST ANSWER.
       *
       * `ocdId` names the census DIVISION a body governs, and
       * `tests/registry-oracle.test.ts` requires every non-null one to resolve
       * to a division that exists. The first version of this wrote the body's
       * own id here, which resolved to nothing and broke that invariant — a
       * fabricated geography wearing the field that means "where".
       *
       * The division is genuinely not established by this route. The descent
       * knows the tier it walked and the host it read; neither is evidence of
       * which division a body governs, and a state agency found on a state
       * portal could be statewide, regional or attached to one county. Writing
       * the state division for all of them would be a plausible guess in the
       * one field a reader would use to decide whether this body governs THEM.
       *
       * So it is null, and attaching divisions with evidence is owed work,
       * carried as its own gap rather than closed by inference.
       */
      ocdId: null,
      /* `finalName.name` and not `officialName`: the name test strips the
       * page furniture off the front, so "About the Supreme Court" — which is
       * what the page's own title says — is recorded as "Supreme Court". The
       * registry holds the body, never the page that introduced it. */
      name: finalName.name,
      bodyClass: "GOVERNING",
      bodyOrigin: "PROMOTED_FROM_DESCENT_CANDIDATE",
      coverageStatus: "NOT_ATTEMPTED",
      agendaSourceType: "NONE",
      agendaSourceRef: null,
      meetingCadence: null,
      homepageUrl: lead.url,
      demandCount: 0,
      sourceDataset: "DESCENT",
      provenance: {
        sourceUrl: lead.url,
        sourceOrg: new URL(lead.url).hostname,
        collectedAt: `${stamp}T00:00:00.000Z`,
        verifiedAt: `${stamp}T00:00:00.000Z`,
      },
    };
    promotedRows.push(row);
    if (!dry) promoteCandidate(w, lead.id, id);
    counts.promoted += 1;
    log.push(`  PROMOTED      ${row.name}  <- "${hit.slice(0, 50)}"`);
  }

  /* ---- write ------------------------------------------------------------- */
  if (!dry) {
    registry.bodies.push(...promotedRows);
    registry.generatedAt = new Date(`${stamp}T00:00:00.000Z`).toISOString();
    /* ONE space, which is what `registry.json` is already written with. Two
     * spaces re-indents all 1,263 existing rows and turns a 650-row addition
     * into a 160,000-line diff nobody can review. */
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 1)}\n`, "utf8");
    w.cursor = `${deriveCursor(w, state)} / adjudicated ${counts.fetched} lead(s) on ${stamp}`;
    saveWorkstream(ROOT, w);
  }

  /* ---- report: every count, with its denominator ------------------------- */
  console.log(`\n=== LEAD ADJUDICATION — ${state.toUpperCase()}${dry ? "  (DRY RUN — nothing written)" : ""}`);
  console.log(`unclassified leads seen        ${counts.seen}`);
  console.log(`  rejected as not a body       ${counts.rejected}`);
  for (const [rule, n] of [...rejectedBy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${rule}`);
  }
  console.log(`  name unreadable by method 0  ${counts.needsClassification}   (NEEDS_CLASSIFICATION — a limit of the method, not a finding)`);
  console.log(`  worth opening                ${counts.toFetch}  (entities; ${extraSightings} extra sighting(s) of an entity already in this list)`);
  console.log(`\nof those, this run opened      ${counts.fetched}  (budget ${budget})`);
  console.log(`  unreachable at every rung    ${counts.unreachable}   (still ENTITY_CANDIDATE — a wall is not an absence)`);
  console.log(`  met a challenge screen       ${counts.challenged}   (still ENTITY_CANDIDATE — a transport state, never a verdict)`);
  console.log(`  page named something else    ${counts.controlFailed}`);
  console.log(`  VERIFIED                     ${counts.verified}`);
  console.log(`  already in the registry      ${counts.duplicate}`);
  console.log(`  PROMOTED (coverage delta)    ${counts.promoted}`);
  console.log(`\nleads left unopened            ${Math.max(0, counts.toFetch - counts.fetched - counts.duplicate)}  <- still owed`);

  /*
   * THE SAME NUMBERS AGAIN, EACH AGAINST ITS OWN DENOMINATOR (RULING 159).
   *
   * "191 promoted" is the number a reader remembers and it answers nothing on
   * its own — 191 of what? The three ratios below are the three questions that
   * actually matter about a run like this: how much of the pool was worth
   * opening, how much of what we opened was a body, and how much of that was
   * already held. A run whose promoted count rises because it opened more
   * leads is not the same as one whose promoted count rises because it got
   * better at reading them, and only the denominator tells them apart.
   *
   * `floored` throws on a zero population rather than printing `0 of 0`, so a
   * run that reached nothing cannot report like a run that found nothing.
   */
  const ratios = [
    counts.seen > 0
      ? floored("worth opening", "the unclassified pool", counts.seen, counts.toFetch)
      : floored("worth opening", "the unclassified pool", 0, 0, "no unclassified leads remained in this state"),
    counts.fetched > 0
      ? floored("named a body", "the pages opened this run", counts.fetched, counts.verified)
      : floored("named a body", "the pages opened this run", 0, 0, "the budget opened nothing this run"),
    counts.verified + counts.duplicate > 0
      ? floored("new to the registry", "the entities verified or matched", counts.verified + counts.duplicate, counts.promoted)
      : floored("new to the registry", "the entities verified or matched", 0, 0, "nothing was verified or matched this run"),
  ];
  console.log("");
  for (const r of ratios) console.log(`  ${floorLine(r)}`);
  if (log.length) {
    console.log("\n--- what happened, per lead ---");
    for (const l of log) console.log(l);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
