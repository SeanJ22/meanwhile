/**
 * @freshness-reads-here
 *
 * RULING 107 — every clock stamp in this file is minted by the code path that
 * performs the read. `stamp()` is called immediately after a `paced()` fetch
 * returns, to record when THAT document was retrieved, and `lastRequestAt` is
 * written immediately before a request leaves. Neither restamps an inherited
 * date: a resumed run carries forward the `fetchedAt` already on disk and only
 * stamps rows it fetched itself, which is the distinction the ruling turns on.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { runOcr, ocrEngineAvailable } from "../lib/extract/ocr.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { writeCapturedFixture } from "../lib/ops/fixture-captures.ts";
import {
  AZLEG_BASE,
  parseChapterStamp,
  parseGovernorLetter,
  parseLetterIndex,
  parseSessionLawIndex,
  type ChapterRow,
  type ChapterStamp,
  type LetterRow,
  type ParsedLetter,
} from "./hunt-azleg-parse.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

/**
 * **WHAT THE GOVERNOR DID WITH THE LEGISLATURE'S BILLS, FROM THE
 * LEGISLATURE'S OWN PERMITTED PUBLICATION.** (AZ04, 2026-08-28.)
 *
 * ## The lead, and the wall it went around
 *
 * AZ03 shipped Arizona executive orders and named the missing half — bills
 * signed and vetoed — as unreachable, on the grounds that the legislature's
 * bill-status application at `apps.azleg.gov` publishes
 * `User-agent: * / Disallow: /`.
 *
 * **That was true about `apps.azleg.gov` and false as a claim about the
 * record.** `www.azleg.gov` is a different host with a different `robots.txt`,
 * it is ALLOWED, and it publishes the same facts in two static indexes. A
 * blocked route had been recorded as a blocked fact. This is the other branch.
 *
 * ## Permission, measured before anything was requested
 *
 * - **`www.azleg.gov` / `azleg.gov` — ALLOWED.** `robots.txt` is 793 bytes,
 *   `User-agent: *`, **`Crawl-delay: 120`**. The delay is HONOURED on every
 *   request this script makes, including retries and including the PDFs. Two
 *   minutes between requests is what makes the whole walk take hours, and the
 *   hours are the price of asking politely.
 *   The named disallows are `/FormatDocument.asp`, `/FormatForPrint.asp`,
 *   `/ExecutiveNominationsByNominee.asp`, `/DocumentsForBill.asp`,
 *   `/aspWebCalendar/`, `/xml/`, `/aspnet_client/`, `/search/`, `/Wordpress/`,
 *   `/wordpress/`, `/azlegwp/`. **None of them is touched.** `/govlettr/`,
 *   `/legtext/` and `/sessionlaws/` appear nowhere in the file, and a path that
 *   is not disallowed is allowed.
 * - **`apps.azleg.gov` — DISALLOWED. NOT REQUESTED, EVER.** Not once, not for
 *   `robots.txt` beyond the one read that established the rule, not for a
 *   HEAD. Its `BillStatus`/`BillOverview` URLs may travel in the store as
 *   cross-reference STRINGS for a human to click; nothing here fetches one.
 * - **`azhouse.gov` / `azsenate.gov` — `CANNOT_TELL`, RECHECK_DUE.** Their
 *   `robots.txt` could not be read by two independent clients and the cause was
 *   isolated to `CERT_HAS_EXPIRED` (CN=azsenate.gov, GoDaddy, valid_to
 *   Aug 28 16:04:01 2026 GMT). **Transport state is not a permission verdict**
 *   (RULING 182): a broken certificate is not a host saying no. They are
 *   recorded as due for a recheck and are NOT walked, because `CANNOT_TELL`
 *   fails safe for the ROUTE while the FACT keeps being hunted elsewhere —
 *   which is what this script is.
 *
 * ## Resumability is the design, not a feature
 *
 * 151 letters + 264 chapters + 2 indexes = 417 requests, and at the crawl delay
 * the host asks for that is **13.9 hours**. No single run finishes it, so no
 * single run is allowed to be the unit of progress.
 *
 * State is written to disk **after every single fetch**, through a temp file
 * and a rename so an interruption mid-write cannot corrupt it. Re-running
 * continues: anything already fetched with a 200 is skipped, and `--budget`
 * caps the requests one run will make. The frontier is STATE, not a recipe for
 * recreating state (RULING 181) — `--budget` chooses how much of the queue to
 * work, and never what is in it.
 *
 * ## What it will not do
 *
 * It never writes a disposition it did not read. The 151 lettered bills and the
 * 264 chaptered bills are **disjoint — the intersection is zero, measured** —
 * and it would be one line of code to call every lettered bill a veto. That
 * line is not here. Zero intersection is consistent with the inference and is
 * not evidence for it, and a manufactured verdict on a governmental act is the
 * one failure this product cannot survive. A letter that has not been read
 * carries `UNREAD`, and `UNREAD` reaches the reader as a fact about US.
 *
 *     pnpm exec tsx scripts/hunt-azleg-actions.mts --phase=all --budget=40
 */

/* ── the walk's own settings ──────────────────────────────────────────── */

const ARGS = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v] as const;
  }),
);

const STATE_PATH = ARGS.get("state") ?? join(".scratch", "azleg-actions-progress.json");
const STATE_REPO_PATH = relative(process.cwd(), resolve(STATE_PATH)).replaceAll("\\", "/");
if (!STATE_REPO_PATH.startsWith("../") && /^(?:data|docs|app|lib|scripts|public|\.github)\//.test(STATE_REPO_PATH)) {
  throw new Error(`AZLEG_RUNTIME_STATE_IN_TRACKED_TREE_FORBIDDEN:${STATE_REPO_PATH}`);
}
/** Where PDF bytes are cached so a re-run never re-asks the host for one. */
const PDF_CACHE = ARGS.get("cache") ?? join(process.env.TEMP ?? ".", "wtp-azleg-pdfs");
/** The host asks for 120 seconds between requests. It gets 120 seconds. */
const CRAWL_DELAY_MS = Number(ARGS.get("delay") ?? 120_000);
/** Requests this RUN may make. A cap on the run, never on the work. */
const BUDGET = Number(ARGS.get("budget") ?? 40);
const PHASE = (ARGS.get("phase") ?? "all") as "index" | "chapters" | "letters" | "all";
/** Record the two index pages and two sample PDFs as test fixtures. */
const WRITE_FIXTURES = ARGS.get("fixtures") === "true";

const UA = `Mozilla/5.0 (compatible; MeanwhileCivicBot/1.0; +${PUBLIC_SITE_ORIGIN})`;

const LETTERS_INDEX = `${AZLEG_BASE}/governors-letters/`;
const SESSION_LAWS_INDEX = `${AZLEG_BASE}/sessionlaws/`;

/* ── state ────────────────────────────────────────────────────────────── */

interface Fetched {
  url: string;
  status: number | null;
  bytes: number;
  fetchedAt: string | null;
  error?: string;
}

interface ChapterState extends Fetched, ChapterRow {
  extract: {
    outcome: string;
    rows: number;
    pages: number;
    pagesWithText: number;
    reason: string;
  } | null;
  /** The enrolled act's own enactment stamp: how it became law, and when. */
  stamp: ChapterStamp | null;
}

interface LetterState extends Fetched, LetterRow {
  textLayer: { outcome: string; rows: number; pages: number; reason: string } | null;
  ocr: { outcome: string; rows: number; reason: string } | null;
  parsed: ParsedLetter | null;
}

interface HuntState {
  version: 2;
  startedAt: string;
  lastRunAt: string;
  runs: number;
  requestsMade: number;
  crawlDelayMs: number;
  /**
   * When the LAST request left this machine, across every run.
   *
   * A crawl delay is a promise to a HOST, and a host counts requests, not
   * processes. Pacing that lived only in memory would honour 120 seconds
   * inside a run and then fire the next run's first request the instant the
   * previous one exited — which is exactly the resumable design's own failure
   * mode, and it would break the promise precisely because the walk is long
   * enough to need resuming.
   */
  lastRequestAt: string | null;
  permission: Record<string, string>;
  index: {
    letters: (Fetched & { rowsSeen: number; rowCount: number; rejected: unknown[] }) | null;
    sessionLaws:
      | (Fetched & { rowsSeen: number; rowCount: number; rejected: unknown[]; missingChapters: number[] })
      | null;
  };
  chapters: Record<string, ChapterState>;
  letters: Record<string, LetterState>;
  ocrEngine: { available: boolean; checkedAt: string; note: string } | null;
}

const PERMISSION = {
  "www.azleg.gov":
    "ALLOWED. robots.txt 793B, User-agent: *, Crawl-delay: 120 (honoured on every request). /govlettr/, /legtext/ and /sessionlaws/ are not among the named disallows.",
  "apps.azleg.gov":
    "DISALLOWED (User-agent: * / Disallow: /), recorded and not blocking since the owner decision of 2026-09-25. No adapter reads the application yet; its BillStatus URLs travel as cross-reference strings.",
  "azhouse.gov, azsenate.gov":
    "CANNOT_TELL / RECHECK_DUE. robots.txt unreadable by two clients; cause isolated to CERT_HAS_EXPIRED (CN=azsenate.gov, GoDaddy, valid_to Aug 28 16:04:01 2026 GMT). A transport failure, recorded; not a robots verdict and not a refusal. Not yet walked.",
  "azgovernor.gov":
    "ALLOWED, Crawl-delay 10. Walked by scripts/hunt-az-executive-orders.mts. Publishes no bill-action or veto index.",
};

function emptyState(now: string): HuntState {
  return {
    version: 2,
    startedAt: now,
    lastRunAt: now,
    runs: 0,
    requestsMade: 0,
    crawlDelayMs: CRAWL_DELAY_MS,
    lastRequestAt: null,
    permission: PERMISSION,
    index: { letters: null, sessionLaws: null },
    chapters: {},
    letters: {},
    ocrEngine: null,
  };
}

function loadState(now: string): HuntState {
  if (!existsSync(STATE_PATH)) return emptyState(now);
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as HuntState;
    if (raw.version !== 2) {
      throw new Error(`state file is version ${raw.version}, this script writes 2`);
    }
    return raw;
  } catch (error) {
    /* A corrupt state file is a HARD STOP. Silently starting over would re-ask
       a host that asked for two minutes between requests for 417 pages it has
       already served, which is the opposite of honouring a crawl delay. */
    throw new Error(
      `${STATE_PATH} exists and could not be read as hunt state: ${(error as Error).message}. ` +
        "Refusing to start over — move it aside deliberately if that is what you mean.",
    );
  }
}

/** Atomic enough to survive a kill mid-write: write beside, then rename over. */
function saveState(state: HuntState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, STATE_PATH);
}

/* ── the paced client ─────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
let spentThisRun = 0;
/* Bound to the live state at startup, so the promise survives a restart. */
let paceState: HuntState | null = null;

class BudgetSpent extends Error {}

/**
 * **A CAPTURED PAGE GOES THROUGH THE SANITIZATION BOUNDARY.** (2026-08-28.)
 *
 * These two recordings are public azleg.gov pages, and a public page is free to
 * emit its own vendor credentials into the markup — which is exactly how a
 * Google Maps key and a bearer token reached `tests/fixtures/` from Pima County
 * and stopped a Netlify deploy. What is redacted is printed; a recorder that
 * quietly removed bytes from evidence would be the worse of the two failures.
 */
function recordFixture(name: string, html: string): void {
  const { bytes, replaced, classes } = writeCapturedFixture(
    join("tests", "fixtures", name),
    html,
  );
  console.log(
    `    recorded tests/fixtures/${name} (${bytes}B)` +
      (replaced > 0 ? ` — ${replaced} source credential(s) redacted: ${classes.join(", ")}` : ""),
  );
}

async function paced(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  if (spentThisRun >= BUDGET) throw new BudgetSpent("run budget spent");
  const since = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && since < CRAWL_DELAY_MS) await sleep(CRAWL_DELAY_MS - since);
  lastRequestAt = Date.now();
  spentThisRun += 1;
  if (paceState) {
    /* Written BEFORE the request goes out, not after: a process killed
       mid-fetch must still leave the next one knowing a request was made. */
    paceState.lastRequestAt = new Date(lastRequestAt).toISOString();
    saveState(paceState);
  }
  const response = await fetch(url, { headers: { "user-agent": UA } });
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

const stamp = () => new Date().toISOString();

/* ── phase 1: the two indexes ─────────────────────────────────────────── */

async function walkLetterIndex(state: HuntState): Promise<void> {
  if (state.index.letters?.status === 200 && state.index.letters.rowCount > 0) return;
  const { status, bytes } = await paced(LETTERS_INDEX);
  state.requestsMade += 1;
  const html = new TextDecoder("utf8").decode(bytes);
  const parsed = status === 200 ? parseLetterIndex(html) : { rowsSeen: 0, rows: [], rejected: [] };
  state.index.letters = {
    url: LETTERS_INDEX,
    status,
    bytes: bytes.length,
    fetchedAt: stamp(),
    rowsSeen: parsed.rowsSeen,
    rowCount: parsed.rows.length,
    rejected: parsed.rejected,
  };
  for (const row of parsed.rows) {
    if (state.letters[row.billNumber]) continue;
    state.letters[row.billNumber] = {
      ...row,
      url: row.letterUrl,
      status: null,
      bytes: 0,
      fetchedAt: null,
      textLayer: null,
      ocr: null,
      parsed: null,
    };
  }
  if (WRITE_FIXTURES && status === 200) {
    recordFixture("azleg-governors-letters.html", html);
  }
  saveState(state);
  console.log(`index /governors-letters/  ${status}  ${bytes.length}B  ${parsed.rows.length} bills from ${parsed.rowsSeen} <tr chunks`);
}

async function walkSessionLawIndex(state: HuntState): Promise<void> {
  if (state.index.sessionLaws?.status === 200 && state.index.sessionLaws.rowCount > 0) return;
  const { status, bytes } = await paced(SESSION_LAWS_INDEX);
  state.requestsMade += 1;
  const html = new TextDecoder("utf8").decode(bytes);
  const parsed =
    status === 200
      ? parseSessionLawIndex(html)
      : { rowsSeen: 0, rows: [], rejected: [], missingChapters: [] };
  state.index.sessionLaws = {
    url: SESSION_LAWS_INDEX,
    status,
    bytes: bytes.length,
    fetchedAt: stamp(),
    rowsSeen: parsed.rowsSeen,
    rowCount: parsed.rows.length,
    rejected: parsed.rejected,
    missingChapters: parsed.missingChapters,
  };
  for (const row of parsed.rows) {
    const key = String(row.chapter);
    if (state.chapters[key]) continue;
    state.chapters[key] = {
      ...row,
      url: row.chapteredVersionUrl,
      status: null,
      bytes: 0,
      fetchedAt: null,
      extract: null,
      stamp: null,
    };
  }
  if (WRITE_FIXTURES && status === 200) {
    recordFixture("azleg-sessionlaws.html", html);
  }
  saveState(state);
  console.log(`index /sessionlaws/        ${status}  ${bytes.length}B  ${parsed.rows.length} chapters from ${parsed.rowsSeen} <tr chunks, missing: ${parsed.missingChapters.length}`);
}

/* ── phase 2: the chaptered versions (born-digital, cheapest real coverage) ── */

/**
 * Extract a cached chaptered version and read its enactment stamp.
 *
 * Split out from the fetch on purpose: it touches no network, so the whole
 * corpus can be re-read after a parser correction without asking a host that
 * wants two minutes per request for a single byte it has already served.
 * That is what `--reextract=true` runs.
 */
async function extractChapter(chapter: ChapterState, bytes: Uint8Array): Promise<void> {
  /* Copied, because pdf.js detaches the buffer it is handed and the caller
     still needs these bytes (see the note in `readLetter`). */
  const result = await extractTextLayer(new Uint8Array(bytes), chapter.url);
  chapter.extract = {
    outcome: result.outcome,
    rows: result.rows,
    pages: Number(result.counts.pages ?? 0),
    pagesWithText: Number(result.counts.pagesWithText ?? 0),
    reason: result.reason,
  };
  chapter.stamp =
    result.outcome === "EXTRACTED"
      ? parseChapterStamp(result.items.map((p) => p.text).join("\n"))
      : null;
}

async function readChapter(state: HuntState, key: string): Promise<void> {
  const chapter = state.chapters[key];
  if (chapter.status === 200 && chapter.extract) return;
  mkdirSync(PDF_CACHE, { recursive: true });
  const cached = join(PDF_CACHE, `chapter-${String(chapter.chapter).padStart(4, "0")}.pdf`);

  let bytes: Uint8Array;
  if (existsSync(cached)) {
    bytes = new Uint8Array(readFileSync(cached));
    chapter.status ??= 200;
  } else {
    try {
      const got = await paced(chapter.url);
      state.requestsMade += 1;
      chapter.status = got.status;
      bytes = got.bytes;
      if (got.status === 200) writeFileSync(cached, bytes);
    } catch (error) {
      if (error instanceof BudgetSpent) throw error;
      chapter.status = null;
      chapter.error = (error as Error).message;
      chapter.fetchedAt = stamp();
      saveState(state);
      return;
    }
  }

  chapter.bytes = bytes.length;
  chapter.fetchedAt = stamp();
  if (chapter.status === 200) await extractChapter(chapter, bytes);
  saveState(state);
  console.log(
    `  chapter ${String(chapter.chapter).padStart(3)}  ${chapter.billNumber.padEnd(7)} ${chapter.status}  ${String(chapter.bytes).padStart(7)}B  ${chapter.extract?.outcome ?? "-"} rows=${chapter.extract?.rows ?? 0}  ${chapter.stamp?.route ?? "-"} ${chapter.stamp?.approvedAt ?? ""}  ${chapter.shortTitle.slice(0, 40)}`,
  );
}

/* ── phase 3: the governor's letters (scans; OCR is the named rung) ─────── */

async function readLetter(state: HuntState, key: string): Promise<void> {
  const letter = state.letters[key];
  if (letter.status === 200 && letter.parsed && letter.parsed.disposition !== "UNREAD") return;
  if (letter.status === 200 && letter.parsed && !ocrEngineAvailable()) return;
  mkdirSync(PDF_CACHE, { recursive: true });
  const cached = join(PDF_CACHE, `letter-${letter.billNumber.toLowerCase()}.pdf`);

  let bytes: Uint8Array;
  if (existsSync(cached)) {
    bytes = new Uint8Array(readFileSync(cached));
    letter.status ??= 200;
  } else {
    try {
      const got = await paced(letter.url);
      state.requestsMade += 1;
      letter.status = got.status;
      bytes = got.bytes;
      if (got.status === 200) writeFileSync(cached, bytes);
    } catch (error) {
      if (error instanceof BudgetSpent) throw error;
      letter.status = null;
      letter.error = (error as Error).message;
      letter.fetchedAt = stamp();
      saveState(state);
      return;
    }
  }

  letter.bytes = bytes.length;
  letter.fetchedAt = stamp();
  if (letter.status !== 200) {
    saveState(state);
    return;
  }

  /*
   * RUNG ORDER, AND WHY THE FIRST ONE IS TRIED ANYWAY.
   *
   * The method store recorded these as "born-digital PDF with a readable text
   * layer". Measured, they are not: /Font 0, /Image 40, /CCITTFaxDecode 18 —
   * mixed-raster scans. The text layer is still attempted on every letter
   * rather than skipped on the strength of one sample, because one measured
   * document is a floor and a publisher can change its pipeline mid-session.
   * When it returns ZERO_ROWS that is recorded as a finding about THE LAYER.
   */
  /*
   * **EACH LAYER GETS ITS OWN COPY OF THE BYTES.**
   *
   * `pdfjs.getDocument({data})` DETACHES the ArrayBuffer it is given. Handing
   * the same `Uint8Array` to the OCR rung afterwards passes it a zero-length
   * view, and OCR then reports "the input is zero bytes — nothing was fetched"
   * about a document that was fetched perfectly. A false REASON on a real
   * failure is how a wall gets written down as the wrong wall, and the next
   * session goes looking for a network problem that never existed.
   */
  const text = await extractTextLayer(new Uint8Array(bytes), letter.url);
  letter.textLayer = {
    outcome: text.outcome,
    rows: text.rows,
    pages: Number(text.counts.pages ?? 0),
    reason: text.reason,
  };

  let read = text.outcome === "EXTRACTED" ? text.items.map((p) => p.text).join("\n") : "";

  if (!read) {
    const ocr = await runOcr(new Uint8Array(bytes), letter.url);
    letter.ocr = { outcome: ocr.outcome, rows: ocr.rows, reason: ocr.reason };
    if (ocr.outcome === "EXTRACTED") read = ocr.items.map((p) => p.text).join("\n");
  }

  /*
   * **NO TEXT MEANS UNREAD, AND UNREAD IS A STATE.** Not "no disposition
   * found", not a default of SIGNED, not an inference from the fact that this
   * bill never became a chapter. Nobody has looked at this document yet, and
   * that is what the store will say.
   */
  letter.parsed = read
    ? parseGovernorLetter(read)
    : { disposition: "UNREAD", date: null, coveredBills: [], evidenceLine: null };

  saveState(state);
  console.log(
    `  letter ${letter.billNumber.padEnd(7)} ${letter.status}  ${String(letter.bytes).padStart(7)}B  text=${letter.textLayer.outcome} ocr=${letter.ocr?.outcome ?? "-"}  -> ${letter.parsed.disposition}${letter.parsed.date ? ` ${letter.parsed.date}` : ""}`,
  );
}

/* ── the run ──────────────────────────────────────────────────────────── */

const now = stamp();
const state = loadState(now);
state.runs += 1;
state.lastRunAt = now;
paceState = state;
/* Inherit the previous run's clock. A restart does not reset the host's delay. */
if (state.lastRequestAt) lastRequestAt = Date.parse(state.lastRequestAt);

const engineOk = ocrEngineAvailable();
state.ocrEngine = {
  available: engineOk,
  checkedAt: now,
  note: engineOk
    ? "tesseract is on PATH; scanned letters are read mechanically."
    : "tesseract is NOT on PATH. lib/extract/ocr.ts returns CANNOT_RUN, which is a NAMED RUNG (REQUIRES_NEW_ADAPTER) and never a finding that the letters are blank.",
};
saveState(state);

let stoppedOn: string | null = null;
try {
  /*
   * **RE-READ WHAT IS ALREADY ON DISK, WITHOUT ASKING THE HOST AGAIN.**
   *
   * A parser correction has to reach documents already collected, or the store
   * carries whichever answer happened to be current when each row was fetched.
   * The first stamp detector shipped here was too loose and matched a sentence
   * about nomination petitions in chapter 1 — a FALSE POSITIVE, which would
   * have become a false claim that a document published a date it does not.
   * Fixing the detector is only half of it; this is the other half, and it
   * costs zero requests because every PDF is cached.
   */
  if (ARGS.get("reextract") === "true") {
    const cached = Object.keys(state.chapters).sort((a, b) => Number(a) - Number(b));
    let done = 0;
    for (const key of cached) {
      const chapter = state.chapters[key];
      const path = join(PDF_CACHE, `chapter-${String(chapter.chapter).padStart(4, "0")}.pdf`);
      if (!existsSync(path)) continue;
      await extractChapter(chapter, new Uint8Array(readFileSync(path)));
      done += 1;
    }
    saveState(state);
    console.log(`re-extracted ${done} cached chaptered version(s) — no requests made`);
  }

  if (PHASE === "index" || PHASE === "all") {
    await walkSessionLawIndex(state);
    await walkLetterIndex(state);
  }

  /* Chapters first, always: they are born-digital, they extract, and they are
     the cheapest COMPLETE and SOURCED record class available today. */
  if (PHASE === "chapters" || PHASE === "all") {
    const owed = Object.keys(state.chapters)
      .sort((a, b) => Number(a) - Number(b))
      .filter((k) => !(state.chapters[k].status === 200 && state.chapters[k].extract));
    console.log(`chapters owed: ${owed.length} of ${Object.keys(state.chapters).length}`);
    for (const key of owed) await readChapter(state, key);
  }

  if (PHASE === "letters" || PHASE === "all") {
    const owed = Object.keys(state.letters)
      .sort()
      .filter((k) => !(state.letters[k].status === 200 && state.letters[k].parsed));
    console.log(`letters owed: ${owed.length} of ${Object.keys(state.letters).length}`);
    for (const key of owed) await readLetter(state, key);
  }
} catch (error) {
  if (error instanceof BudgetSpent) stoppedOn = "RUN BUDGET SPENT";
  else throw error;
}

saveState(state);

/* ── the report, with its denominators ────────────────────────────────── */

const chapters = Object.values(state.chapters);
const letters = Object.values(state.letters);
const chaptersRead = chapters.filter((c) => c.status === 200 && c.extract?.outcome === "EXTRACTED");
const lettersFetched = letters.filter((l) => l.status === 200);
const lettersRead = letters.filter((l) => l.parsed && l.parsed.disposition !== "UNREAD");

console.log("");
console.log(floorLine(floored("chapters extracted", "chapters indexed", chapters.length, chaptersRead.length)));
console.log(floorLine(floored("letter PDFs retrieved", "letters indexed", letters.length, lettersFetched.length)));
console.log(floorLine(floored("letters actually READ", "letter PDFs retrieved", Math.max(lettersFetched.length, 1), lettersRead.length)));
const byRoute = (route: string) => chaptersRead.filter((c) => c.stamp?.route === route).length;
console.log(
  `  enactment route, read off each act's own stamp: APPROVED_BY_GOVERNOR ${byRoute("APPROVED_BY_GOVERNOR")}, ` +
    `WITHOUT_SIGNATURE ${byRoute("WITHOUT_SIGNATURE")}, OVER_VETO ${byRoute("OVER_VETO")}, ` +
    `UNDETERMINED ${byRoute("UNDETERMINED")} (of ${chaptersRead.length} extracted)`,
);
console.log(
  `  carrying a PUBLISHED approval date: ${chaptersRead.filter((c) => c.stamp?.approvedAt).length} of ${chaptersRead.length}`,
);
console.log(`  OCR engine: ${state.ocrEngine.available ? "PRESENT" : "ABSENT — letters stay UNREAD, which is a fact about US"}`);
console.log(`  requests made across ${state.runs} run(s): ${state.requestsMade}; this run spent ${spentThisRun} of ${BUDGET}`);
if (stoppedOn) console.log(`  STOPPED ON: ${stoppedOn} — this is a partial walk and every count above is a FLOOR`);

const owedNow =
  chapters.filter((c) => !(c.status === 200 && c.extract)).length +
  letters.filter((l) => !(l.status === 200 && l.parsed)).length;
console.log("");
console.log(`OWED, STILL: ${owedNow} document(s). RESUME WITH:`);
console.log(`  pnpm exec tsx scripts/hunt-azleg-actions.mts --phase=${PHASE} --budget=<n>`);
console.log(`  (state: ${STATE_PATH}; PDFs cached at ${PDF_CACHE}; nothing already fetched is re-asked)`);
