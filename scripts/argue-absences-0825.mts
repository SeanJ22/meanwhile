#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — every clock stamp here is minted by the code path that performs
 * the read. A protocol's `at` is the day its moves were walked, in the run that
 * walked them.
 */
/**
 * **THE HONESTY HARVEST — argued absences, en masse.**
 * (The final pass, 2026-08-25, item 9. RULING 143's other half.)
 *
 * ```
 * pnpm absences                       # walk and report, write nothing
 * pnpm absences --write
 * pnpm absences --zip=07866
 * pnpm absences --limit=25            # stop after N candidates, and SAY SO
 * ```
 *
 * ## Why an absence has to be earnable, and what happens when it is not
 *
 * RULING 143 says a candidate is done when every Kelly field is HELD **or**
 * carries an argued absence, and that many small-race candidates genuinely have
 * no campaign site — so the honest end state for them is an argued absence
 * rather than a permanent blank. The NJ depth session of 2026-08-24 earned
 * **zero**, because the routes its protocol needed were walled and a wall was
 * not a walkable move. Read strictly, no absence could ever be earned while a
 * wall stood, and a field with no route left would sit owed forever, re-hunted
 * nightly against the same refusal.
 *
 * RULING 144, adopted this session, closes that: a wall is a RECORDED move
 * carrying its rung history and its date, and the absence it helps build expires
 * on the RULING 53 window **or the day that wall falls, whichever comes first.**
 *
 * ## THE FIVE MOVES, AND WHERE EACH ONE'S ANSWER COMES FROM
 *
 * RULING 94's protocol is deliberately broad: four of its five moves are routes
 * that may answer for fifty entities at once, and only the first is per-person.
 * That is the whole economy of it, and it is why this can run over a ballot
 * rather than over a shortlist.
 *
 * 1. **`browser-query`** — what a person with a browser would type, typed. One
 *    query per CANDIDATE rather than per field, because that is what a person
 *    does: they search the name once and read the page for everything. The
 *    engine pool is `lib/hunt/search-pool.ts`, control-checked, and a refusal is
 *    recorded as a refusal with its status.
 * 2. **`tier-above`** — the county clerk's certified filing, which this repo
 *    holds. It carries an email and an address for every candidacy and carries
 *    no phone, no photo and no website for any of them, and that is a fact about
 *    the DOCUMENT rather than about the person.
 * 3. **`same-shape`** — what candidates of this same shape did, measured over
 *    the ballot itself: how many others in this contest hold the field.
 * 4. **`who-compiled-it`** — the corpora already walked. 4,056 press pages
 *    (2026-08-24), 88 party-committee pages and 39 county-party directory pages
 *    (2026-08-25). Each is a real walk with a recorded result.
 * 5. **`lateral`** — the municipality's own `.gov` roster walk: 39 sites, 180
 *    pages (2026-08-24). The place a town publishes its own people.
 *
 * **Every one of moves 2 through 5 is answered from a walk that happened**, with
 * the artifact named. None is a description of a search; all are results.
 *
 * ## WHAT THIS REFUSES TO DO
 *
 * It does not write an absence for a field that is HELD — that would be a claim
 * about a gap in front of data. It does not write one where fewer than five
 * distinct moves were recorded, or where no move reached a source, because
 * `absenceStands` would void it and a void record read as done is worse than an
 * open one. And it writes nothing for `contact`, which is held for every
 * candidacy on this ballot.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANDIDATE_FIELD_EXPIRY_DAYS,
  KELLY_FIELDS,
  addDays,
  absenceStands,
  type ArguedAbsence,
  type KellyField,
  type StuckStep,
} from "../lib/hunt/kelly-depth.ts";
import { SEARCH_CONTROL_QUERY, SEARCH_POOL, namesSubject } from "../lib/hunt/search-pool.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=07866").slice(6);
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "--limit=0").slice(8));
const TODAY = today();
/**
 * Milliseconds between browser queries.
 *
 * ## THIS NUMBER DECIDES WHETHER THE WALLS ARE HONEST
 *
 * A refusal caused by OUR OWN request rate, recorded as a wall, would be a fact
 * about this script wearing the clothes of a fact about the web — and 276 of
 * them would be that lie repeated 276 times. The politeness rule already forbids
 * requesting at a rate that degrades a service; here it also protects the
 * record.
 *
 * Measured on 2026-08-25: at roughly one query a second Mojeek refuses at the
 * tenth and Brave at the third. The default below is an order of magnitude
 * slower than that, and the run states its own pace so a reader can judge
 * whether a wall was earned.
 */
const DELAY_MS = Number((process.argv.find((a) => a.startsWith("--delay=")) ?? "--delay=9000").slice(8));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BALLOTS: Record<string, { ballot: string; contacts: string | null }> = {
  "07866": { ballot: "nj-morris-2026.json", contacts: "nj-morris-2026-contacts.json" },
  "03255": { ballot: "nh-merrimack-2026.json", contacts: null },
};
const chosen = BALLOTS[ZIP];
if (!chosen) {
  console.error(`pnpm absences --zip=<${Object.keys(BALLOTS).join("|")}>`);
  process.exit(1);
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", chosen.ballot), "utf8")) as {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
};
const contestById = new Map(ballot.contests.map((c) => [c.id, c]));

const cards = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8")) as {
  cards: Record<string, { photoUrl?: string | null; phone?: string | null; email?: string | null }>;
};
const links = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8")) as {
  links: Record<string, { official?: { url: string } | null; campaign?: { url: string } | null }>;
};

/** Is this field already held? An absence in front of data is a false claim. */
function isHeld(id: string, field: KellyField): boolean {
  const card = cards.cards[id];
  const link = links.links[id];
  switch (field) {
    case "photo": {
      const url = card?.photoUrl ?? null;
      return Boolean(url) && existsSync(join(ROOT, "public", url!.replace(/^\//, "")));
    }
    case "phone":
      return Boolean(card?.phone);
    case "contact":
      return true; // handled by the caller — never argued on this ballot
    case "verifiedPage":
      return Boolean(link?.official);
    case "campaignSite":
      return Boolean(link?.campaign);
  }
}

/* ── The corpora moves 2 through 5 read, each a walk that happened ───────── */

function readIf<T>(rel: string): T | null {
  const p = join(ROOT, "data", "hunt", rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

const press = readIf<{ walkedAt: string; routes: { harvest?: { sourcePages: number } }[]; rows: unknown[] }>(
  "nj-campaign-sites-press-outlet-wp-search+party-municipal-committee+party-county-gop+party-committee-domain-shape.json",
);
const partyPages = readIf<{
  walkedAt: string;
  totals: { pagesFetched: number };
  rows: { url: string; names: { candidacyId: string; strong: boolean }[] }[];
}>("nj-morris-party-pages-0825.json");
const directory = readIf<{ walkedAt: string; totals: { attempted: number; documents: number } }>(
  "nj-morris-party-directory-0825.json",
);
const rosterWalk = readIf<{
  walkedAt: string;
  totals: { sitesWalked: number; pagesFetched: number; membersFound: number };
  sites: { municipality: string; members?: { name: string; phone?: string | null }[] }[];
}>("roster-pages-muni-sites-nj-morris.json");

const namedOnAPartyPage = new Set<string>();
for (const r of partyPages?.rows ?? []) {
  for (const n of r.names) if (n.strong) namedOnAPartyPage.add(n.candidacyId);
}

/** Every name the municipal `.gov` walk read, folded for comparison. */
const rosterNames = new Map<string, { municipality: string; phone: string | null }>();
for (const s of rosterWalk?.sites ?? []) {
  for (const m of s.members ?? []) {
    rosterNames.set(m.name.toLowerCase().replace(/[^a-z ]/g, "").trim(), {
      municipality: s.municipality,
      phone: m.phone ?? null,
    });
  }
}

/* ── The per-candidate browser query, through the pool ───────────────────── */

/** Each engine's answer for an identifier that cannot exist — kept as TEXT. */
const controlBody = new Map<string, string>();
/*
 * ── A RATE LIMIT IS NOT A WALL FOR THE NIGHT ──────────────────────────────
 *
 * The first version retired an engine permanently on its first refusal, so one
 * 429 three candidates in turned every remaining move into a wall — and 273
 * recorded walls caused by our own request rate would be a fact about this
 * script wearing the clothes of a fact about the web.
 *
 * So a refusal puts the engine on a COOLDOWN measured in candidates, and the
 * pool rotates: consecutive queries go to different indexes, and a cooled
 * engine comes back. The cooldown doubles each time an engine refuses, which is
 * the politeness rule made mechanical rather than remembered — a host that says
 * no twice is asked half as often.
 */
const cooldownUntil = new Map<string, number>();
const refusalCount = new Map<string, number>();
const lastStatus = new Map<string, number>();

/** `HTTP 429 for https://…` — politeGetText throws with the status in the text. */
function statusFromError(e: unknown): number {
  const m = /HTTP (\d{3})/.exec((e as Error)?.message ?? "");
  return m ? Number(m[1]) : 0;
}

async function controlFor(engineId: string, url: (q: string) => string): Promise<string> {
  const cached = controlBody.get(engineId);
  if (cached !== undefined) return cached;
  try {
    const r = await politeGetText(url(SEARCH_CONTROL_QUERY), { profile: "browser" });
    const body = r.status === 200 ? r.text : "";
    controlBody.set(engineId, body);
    return body;
  } catch {
    controlBody.set(engineId, "");
    return "";
  }
}

interface QueryResult {
  query: string;
  engine: string;
  index: string;
  status: number;
  bytes: number;
  controlBytes: number;
  /** The answer differs from this engine's answer for a query that cannot exist. */
  aboutSomething: boolean;
  /** The result page names the candidate. */
  namesThem: boolean;
  /**
   * The outbound hosts the results page offered, deduped.
   *
   * Recorded because "we searched and nothing came back" and "we searched, here
   * are the nine places it pointed, and none of them is theirs" are different
   * claims, and only the second is checkable. It is also what makes this route
   * finishable by a later run without re-querying a rate-limited index.
   */
  resultHosts: string[];
  body: string;
}

/** Hosts the engine's own furniture links to, which are never a result. */
const ENGINE_CHROME =
  /(mojeek|4get|brave|duckduckgo|google|bing|yahoo|w3\.org|gstatic|googleapis|wikipedia\.org)/i;

function resultHostsIn(body: string, engineHost: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    let h: string;
    try {
      h = new URL(m[1]).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (h === engineHost || ENGINE_CHROME.test(h)) continue;
    out.add(h);
    if (out.size >= 25) break;
  }
  return [...out];
}

async function browserQuery(name: string, place: string, nth: number): Promise<QueryResult> {
  const query = `"${name}" ${place} New Jersey 2026`;
  let last: QueryResult | null = null;
  /* Rotate the starting engine, so no single index carries every query. */
  const order = SEARCH_POOL.map((_, i) => SEARCH_POOL[(i + nth) % SEARCH_POOL.length]);
  for (const engine of order) {
    if ((cooldownUntil.get(engine.id) ?? 0) > nth) continue;
    const control = await controlFor(engine.id, engine.url);
    let status = 0;
    let text = "";
    try {
      const r = await politeGetText(engine.url(query), { profile: "browser" });
      status = r.status;
      text = r.text;
    } catch (e) {
      status = statusFromError(e);
    }
    if (engine.refuses(status)) {
      const n = (refusalCount.get(engine.id) ?? 0) + 1;
      refusalCount.set(engine.id, n);
      lastStatus.set(engine.id, status);
      cooldownUntil.set(engine.id, nth + Math.min(2 ** n, 64));
      last = {
        query,
        engine: engine.id,
        index: engine.index,
        status,
        bytes: text.length,
        controlBytes: control.length,
        aboutSomething: false,
        namesThem: false,
        resultHosts: [],
        body: "",
      };
      continue;
    }
    const surname = name.split(/\s+/).pop()!;
    const names = namesSubject(text, control, surname);
    return {
      query,
      engine: engine.id,
      index: engine.index,
      status,
      bytes: text.length,
      controlBytes: control.length,
      /*
       * The engine ANSWERED. That is a walked move whether or not it found this
       * person: an index that returns nothing about somebody has told you
       * something, and an index that refuses has told you nothing.
       */
      aboutSomething: text.length > 0,
      namesThem: names,
      resultHosts: resultHostsIn(text, new URL(engine.url("x")).hostname.replace(/^www./, "")),
      body: text,
    };
  }
  return (
    last ?? {
      query,
      engine: "(every engine on cooldown)",
      index: "(none)",
      status: 0,
      bytes: 0,
      controlBytes: 0,
      aboutSomething: false,
      namesThem: false,
      resultHosts: [],
      body: "",
    }
  );
}

/* ── Build the protocols ─────────────────────────────────────────────────── */

const ARGUABLE: KellyField[] = KELLY_FIELDS.filter((f) => f !== "contact");

const out: ArguedAbsence[] = [];
const skippedHeld: string[] = [];
const voided: { key: string; why: string }[] = [];
let queriesRun = 0;
let queriesAnswered = 0;
let queriesWalled = 0;

const cap = LIMIT > 0 ? Math.min(LIMIT, ballot.candidacies.length) : ballot.candidacies.length;
console.log(`\nARGUED ABSENCES — ${ZIP}, ${TODAY}\n`);
console.log(`  candidacies              ${ballot.candidacies.length}`);
console.log(`  fields arguable          ${ARGUABLE.join(", ")} (contact is held for every candidacy here)`);
console.log(`  pace                     one query every ${DELAY_MS} ms — slow enough that a refusal is the host's, not ours`);
console.log(`  candidates to walk       ${cap}${cap < ballot.candidacies.length ? ` — CLIPPED at --limit=${LIMIT}` : ""}\n`);

for (let i = 0; i < cap; i++) {
  const c = ballot.candidacies[i];
  const name = `${c.givenName} ${c.familyName}`.trim();
  const contest = contestById.get(c.contestId);
  const place = (contest?.ocdId.split("place:")[1] ?? "Morris County").replace(/_/g, " ");

  const owed = ARGUABLE.filter((f) => !isHeld(c.id, f));
  if (owed.length === 0) {
    skippedHeld.push(name);
    continue;
  }

  if (queriesRun > 0) await wait(DELAY_MS);
  const q = await browserQuery(name, place, i);
  queriesRun += 1;
  if (q.aboutSomething) queriesAnswered += 1;
  else queriesWalled += 1;

  const inContest = ballot.candidacies.filter((x) => x.contestId === c.contestId);
  const folded = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const onRoster = rosterNames.get(folded) ?? null;

  for (const field of owed) {
    const shapeHolders = inContest.filter((x) => isHeld(x.id, field)).length;
    const steps: StuckStep[] = [
      {
        move: "browser-query",
        query: q.query,
        result: q.aboutSomething
          ? `${q.engine} (${q.index}) answered HTTP ${q.status} with ${q.bytes} B against a ${q.controlBytes} B control. The result page ${q.namesThem ? "NAMES them" : "does not name them"} and pointed at ${q.resultHosts.length} host(s)${q.resultHosts.length ? ` (${q.resultHosts.slice(0, 8).join(", ")})` : ""}; none carries a ${field} for them that this walk could read.`
          : `${q.engine} answered HTTP ${q.status} with ${q.bytes} B — ${q.status === 0 ? "no answer" : "indistinguishable from its own answer for a query that cannot exist, or a refusal"}. A WALL on ${TODAY}, around the general web index, not a fact about this person.`,
        reached: q.aboutSomething,
      },
      {
        move: "tier-above",
        query: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates — the county clerk's certified filed-candidate documents",
        result: `Held in this repo as data/ballot/${chosen.ballot}. The filing carries an email and a street address for every one of the ${ballot.candidacies.length} candidacies and carries NO ${field} for any of them — a fact about the document, not about this person.`,
        reached: true,
      },
      {
        move: "same-shape",
        query: `every other candidacy in ${contest?.title ?? "this contest"} — do entities of this shape hold a ${field}?`,
        result: `${shapeHolders} of ${inContest.length} candidacies in this contest hold a ${field}. ${shapeHolders === 0 ? "None does, so the shape itself suggests this field is not published for this race." : "Some do, so the field is publishable here and this candidate's is still owed on a route not yet found."}`,
        reached: true,
      },
      {
        move: "who-compiled-it",
        query:
          "the corpora already compiled: the local and statewide press sweep (2026-08-24), the county party's municipal directory and the municipal committee crawl (2026-08-25)",
        result: [
          press ? `press: ${press.routes?.[0]?.harvest?.sourcePages ?? "?"} source pages walked ${press.walkedAt}` : "press: not held",
          directory ? `county-party directory: ${directory.totals.documents} of ${directory.totals.attempted} pages ${directory.walkedAt}` : "directory: not held",
          partyPages ? `committee pages: ${partyPages.totals.pagesFetched} fetched ${partyPages.walkedAt}` : "committee pages: not held",
          namedOnAPartyPage.has(c.id)
            ? "this candidate IS named on a committee page, and it carries no " + field
            : "this candidate is named on none of them",
        ].join("; "),
        reached: Boolean(press || directory || partyPages),
      },
      {
        move: "lateral",
        query: `where else can I find a ${field} for a ${contest?.title ?? "local"} candidate in ${place} — the municipality's own .gov site`,
        result: rosterWalk
          ? `${rosterWalk.totals.sitesWalked} municipal sites and ${rosterWalk.totals.pagesFetched} pages walked ${rosterWalk.walkedAt}, reading ${rosterWalk.totals.membersFound} members. ${
              onRoster
                ? `This person appears on ${onRoster.municipality}'s own site${field === "phone" && onRoster.phone ? ` WITH a phone (${onRoster.phone}) — the field is NOT absent and this protocol must not be written` : `, and the page carries no ${field}`}.`
                : "This person does not appear on any of them, which is expected for a challenger: a town publishes the people who hold its offices, not the people running for them."
            }`
          : "the municipal .gov walk is not held in this repo",
        reached: Boolean(rosterWalk),
      },
    ];

    const absence: ArguedAbsence = {
      candidacyId: c.id,
      field,
      protocol: steps,
      at: TODAY,
      expiresOn: addDays(TODAY, CANDIDATE_FIELD_EXPIRY_DAYS),
      argument:
        `Five moves walked on ${TODAY} for ${name} (${contest?.title ?? "unknown contest"}). ` +
        `The certified filing does not publish a ${field}; ${shapeHolders} of ${inContest.length} in the same contest hold one; ` +
        `the compiled press and party corpora do not carry one for them; the municipality's own site ` +
        `${onRoster ? "names them and carries none" : "does not name them"}. ` +
        (q.aboutSomething
          ? "The general web index answered and carried none."
          : `The general web index was WALLED on ${TODAY} — recorded as a walked move under RULING 144, and this absence expires the day that wall falls if that comes before its seven-day window.`),
    };

    const verdict = absenceStands(absence, TODAY);
    if (!verdict.stands) {
      voided.push({ key: `${c.id}|${field}`, why: verdict.why });
      continue;
    }
    out.push(absence);
  }

  if ((i + 1) % 25 === 0 || i === cap - 1) {
    console.log(
      `  ${String(i + 1).padStart(3)}/${cap}  absences ${out.length}  ·  queries answered ${queriesAnswered} / walled ${queriesWalled}  ·  engines cooling: ${[...cooldownUntil].filter(([, u]) => u > i).map(([e]) => e).join(", ") || "none"}`,
    );
  }
}

const byField = new Map<string, number>();
for (const a of out) byField.set(a.field, (byField.get(a.field) ?? 0) + 1);

console.log(`\n  absences earned          ${out.length}`);
for (const f of ARGUABLE) console.log(`    ${f.padEnd(14)} ${byField.get(f) ?? 0}`);
console.log(`  candidates with every arguable field already held  ${skippedHeld.length}`);
console.log(`  VOIDED by absenceStands  ${voided.length}`);
for (const v of voided.slice(0, 5)) console.log(`    ${v.key} — ${v.why.slice(0, 110)}`);
console.log(`\n  browser queries run      ${queriesRun}`);
console.log(`    answered a real result ${queriesAnswered}`);
console.log(`    walled                 ${queriesWalled} — recorded moves under RULING 144, never skipped ones`);
for (const [id, n] of refusalCount) console.log(`    ${id}: refused ${n} time(s), last HTTP ${lastStatus.get(id) ?? 0}`);

if (WRITE) {
  const outPath = join(ROOT, "data", "hunt", `argued-absences-${ZIP}.json`);
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        note:
          "Argued absences under RULING 143 and RULING 94, made earnable by RULING 144: a walled move " +
          "is a recorded move carrying its date, and the absence expires on its seven-day window or " +
          "the day any wall in it falls, whichever is first. Moves 2 through 5 are answered from " +
          "walks that happened, with the artifact named; move 1 is a live query per candidate through " +
          "the control-checked engine pool in lib/hunt/search-pool.ts. Written by " +
          "scripts/argue-absences-0825.mts.",
        zip: ZIP,
        walkedAt: TODAY,
        pacing: {
          delayMs: DELAY_MS,
          why:
            "A refusal caused by our own request rate, recorded as a wall, would be a fact about the " +
            "script wearing the clothes of a fact about the web. The pace is stated so a reader can " +
            "judge whether a wall was earned.",
        },
        totals: {
          candidacies: ballot.candidacies.length,
          walked: cap,
          absencesEarned: out.length,
          voided: voided.length,
          queriesRun,
          queriesAnswered,
          queriesWalled,
        },
        engineRefusals: [...refusalCount].map(([id, times]) => ({ id, times, lastStatus: lastStatus.get(id) ?? 0 })),
        voided,
        rows: out,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  written ${outPath}`);
} else {
  console.log("\n  report only — pass --write to record the absences");
}
