import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";


/**
 * Rulings §0 supersedes the blanket coverage silence below: derived missing-field
 * labels are required. The remaining assertions protect against stale prose claims.
 *
 * **RULING 59 (2026-08-21, the author's ruling) — THE PAGE SAYS ONE THING
 * ABOUT COMPLETENESS AND NOTHING ELSE.**
 *
 * The only reader-facing statement about what the product holds is one line:
 * *"What we have found, we are displaying here."* — once in the ballot
 * section and once on the battlecard, per RULING 51. No other sentence
 * anywhere describes coverage, counts what is missing, or characterises what
 * has not been worked out.
 *
 * ## The failure that produced the ruling
 *
 * NH Hunt 4's first merge began rendering Lake Todd Village District's
 * meetings at 03255. The coverage note four inches down the same page still
 * read: *"18 more — water districts, fire districts, and the like — exist in
 * the counties around you. We have not worked out which of them reach this
 * ZIP code."* Lake Todd was one of the eighteen. The product was displaying a
 * body while telling the reader, in the same viewport, that it had not worked
 * out whether that body reached them.
 *
 * Every automated check was green. That is not an oversight in the checks; it
 * is a property of the sentence. **A sentence that counts what is missing is
 * a claim ABOUT data that changes underneath it, and nothing can tell a
 * correct render from a stale note about that render** without re-deriving
 * the count at render time — at which point the sentence is a second query
 * that may disagree with its own page, which the stated-N-equals-rendered-rows
 * rule already forbids. It was caught by a human reading a screenshot, and
 * the next one would be too.
 *
 * So the class of sentence is deleted rather than the instance corrected.
 *
 * ## What this does NOT touch, and the line is load-bearing
 *
 * Honesty about coverage survives everywhere it was ever load-bearing. The
 * gap ledger is generated and current by construction. The stated-N rule, the
 * two-numbers pair rule and the prohibition on asserting absence are all
 * untouched. **The render-default rule is untouched**: a null still renders
 * as its NAMED GAP, saying whose gap it is — "we haven't recorded this
 * chamber's vote yet" is required, not banned.
 *
 * The difference this test draws is between:
 *
 *   - a **named gap**, which is about ONE field of ONE subject, is true when
 *     rendered because it is derived from the very row being rendered, and
 *     cannot go stale independently of it; and
 *   - a **coverage claim**, which is about the product's holdings in
 *     aggregate, is derived from somewhere other than what is on screen, and
 *     goes stale silently the moment the work behind it is done.
 *
 * The first is law. The second is what RULING 59 deleted.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories a reader's page is built from. */
const RENDER_ROOTS = ["app", "components", "lib", "data"];
/*
 * `.json` is in scope, and that is the point.
 *
 * The "Not here yet" section was half in `app/ballot/page.tsx` and half in
 * `data/states/az/ballot/az-pima-2026.json`, and a sweep over code alone could see only
 * the half that carried no claim. Reader-facing prose in this product lives in
 * DATA as often as it lives in code.
 */
const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "fixtures"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry)) out.push(full);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

/**
 * Comments stripped, so a doc block explaining a deleted sentence is not
 * mistaken for the sentence. Same crude line-oriented read the suppression
 * sweep uses, and for the same reason.
 */
function withoutComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    // `{/*` as well as `/*`: the headstones explaining these deletions are JSX
    // comments, and on the first pass this test flagged its own gravestones.
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!/\*\/\s*\}?$/.test(t)) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    out.push(line.replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
}

/**
 * `lib/coverage/tier.ts` is the ONE exemption, and it is named rather than
 * pattern-matched so it cannot quietly widen.
 *
 * RULING 59 does not delete the coverage enumeration; it MOVES it, to
 * docs/gap-ledger.md — internal, generated, current by construction. This
 * module is that document's vocabulary, and its strings are written in reader
 * language because the ledger is read by a person. What matters is that they
 * never reach a page, and that is asserted separately below: no file under
 * `app/` or `components/` may import any of them.
 */
const LEDGER_VOCABULARY = "lib/coverage/tier.ts";

const MOVE_PLAN = "data/state-holdings/move-plan.json";
const HISTORICAL_TRACKER_LINE_SHA256 =
  "41f95beb26c89289ab447c6a34a27acb32f2a3d64cc20e9ae193d25d0b71d648";

/**
 * The migration plan preserves one tracker line describing the deleted UI.
 * That exact, hash-bound source quotation is evidence, like the comments
 * above. Keep scanning every other field and every other file: neither the
 * plan nor its directory is exempt from the reader-language guard.
 */
function readerSource(path: string, source: string): string {
  if (path !== MOVE_PLAN) return withoutComments(source);
  const plan = JSON.parse(source);
  const historical = plan.allowedHistoricalReferences.filter(
    (row: { path: string; jsonPointer: string }) =>
      row.path === "docs/tracker.csv" && row.jsonPointer === "/sourceLine/15",
  );
  assert.equal(historical.length, 1, "the historical tracker quotation must be unique");
  const quotation = historical[0];
  assert.equal(quotation.sha256, HISTORICAL_TRACKER_LINE_SHA256);
  assert.equal(
    createHash("sha256").update(quotation.sourceText).digest("hex"),
    HISTORICAL_TRACKER_LINE_SHA256,
    "the historical tracker quotation changed; it cannot exempt new reader prose",
  );
  quotation.sourceText = "[exact historical tracker quotation: hash verified]";
  return withoutComments(JSON.stringify(plan, null, 2));
}

const FILES = RENDER_ROOTS.flatMap((r) => walk(join(ROOT, r)));

/**
 * The banned forms, each with the reason it is banned, because a bare regex
 * list becomes a thing people delete entries from.
 *
 * Every one of these describes the product's holdings in AGGREGATE. None of
 * them can be true-by-construction at render time, and each has a stale state
 * that looks exactly like its correct state.
 */
const BANNED: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    re: /we have not worked out which/i,
    why:
      "the Lake Todd sentence itself — it counted districts nobody had " +
      "worked out while the page rendered one of them",
  },
  {
    re: /\bcoverage today\b/i,
    why:
      "an enumeration of which places the product covers. It is false the " +
      "day a place is added, on a page nobody thought to edit",
  },
  // Rulings §0 requires a plain missing-coverage label derived from current holdings.
  {
    re: /we are still (working out|finding|filling)/i,
    why:
      "a progress claim about our own hunt. It reads as current forever and " +
      "is derived from nothing on the page",
  },
  {
    re: /\bmore (?:—|-|governments|bodies|districts)[^.]{0,80}exist in the (?:county|counties)/i,
    why: "a count of bodies we hold no data for, stated to a reader",
  },
  {
    re: /(?:where|when) we have not found something/i,
    why:
      "a characterisation of how the product handles gaps. RULING 28 made " +
      "it false — a field with no data renders nothing at all",
  },
  {
    re: /\bwe have (?:confirmed|not confirmed) \d/i,
    why: "a coverage count rendered as prose",
  },
  {
    re: /\bnext for us\b/i,
    why:
      "a statement of what we intend to hunt next. It is a roadmap on a " +
      "reader surface and it goes stale the moment the step is taken",
  },
  /*
   * The three below were added AFTER the first sweep, because reading a
   * production screenshot as an image found a whole section the source scan
   * had missed: a heading reading "Not here yet" over a note reading "Pima
   * County offices, City of Tucson offices, and school-district (TUSD, Vail
   * Unified) contests are not curated yet."
   *
   * Two lessons, and the second is why `data` is in RENDER_ROOTS:
   *
   * 1. The heading was three ordinary words in a JSX element and matched
   *    nothing. A pattern list built from the sentences you already know about
   *    only finds the sentences you already know about.
   * 2. The sentence that made it a coverage claim lived in
   *    `data/states/az/ballot/az-pima-2026.json` and never appeared under `app/` at all.
   *    Reader-facing prose in this product lives in DATA as often as in code.
   */
  {
    re: /\bnot here yet\b/i,
    why:
      "a section heading announcing a list of what the product lacks. RULING " +
      "59: the page says one thing about completeness and nothing else",
  },
  {
    re: /\bnot curated yet\b/i,
    why:
      "hunt-queue vocabulary on a reader surface (RULING 28), attached to an " +
      "enumeration of offices nobody has worked yet",
  },
  {
    re: /\bwe (?:have not|haven't) (?:wired|curated|worked)\b/i,
    why:
      "a progress claim about our own pipeline. Whether one source is wired " +
      "is a fact about us that no reader can act on",
  },
];

function coverageClaims(path: string, source: string): string[] {
  if (path === LEDGER_VOCABULARY) return [];
  const src = readerSource(path, source);
  return BANNED.flatMap(({ re, why }) => {
    const m = re.exec(src);
    return m ? [`${path}: ${JSON.stringify(m[0])} — ${why}`] : [];
  });
}

test("RULING 59: no reader surface renders a coverage claim", () => {
  const hits = FILES.flatMap((file) =>
    coverageClaims(rel(file), readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    hits,
    [],
    "RULING 59: the page says one thing about completeness and nothing " +
      "else.\n\nA sentence counting what is missing goes false the moment " +
      "the work behind it is done, and no automated check can see it — that " +
      "is how the Lake Todd note stayed green while contradicting the very " +
      "page it sat on. Move the enumeration to docs/gap-ledger.md, which is " +
      "generated and current by construction.\n\nFound:\n  " +
      hits.join("\n  "),
  );
});

test("RULING 59: historical migration evidence cannot exempt reader data or other plan fields", () => {
  const source = readFileSync(join(ROOT, MOVE_PLAN), "utf8");
  assert.deepEqual(coverageClaims(MOVE_PLAN, source), []);
  assert.ok(
    coverageClaims("data/states/az/ballot/planted-reader.json", source).length > 0,
    "copying the archived UI quotation to a reader dataset must remain red",
  );
  const plan = JSON.parse(source);
  plan.readerNote = "Not here yet";
  assert.ok(
    coverageClaims(MOVE_PLAN, JSON.stringify(plan)).some((hit) => hit.includes("Not here yet")),
    "only the exact evidence field is exempt, never the entire plan",
  );
});

test("RULING 59: changing the historical quotation cannot broaden the exemption", () => {
  const plan = JSON.parse(readFileSync(join(ROOT, MOVE_PLAN), "utf8"));
  const quotation = plan.allowedHistoricalReferences.find(
    (row: { path: string; jsonPointer: string }) =>
      row.path === "docs/tracker.csv" && row.jsonPointer === "/sourceLine/15",
  );
  quotation.sourceText += " Not curated yet";
  // Rehashing a new claim in the plan must not turn it into frozen evidence.
  quotation.sha256 = createHash("sha256").update(quotation.sourceText).digest("hex");
  assert.throws(() => coverageClaims(MOVE_PLAN, JSON.stringify(plan)), assert.AssertionError);
});

test("RULING 59: the deleted coverage note has not come back", () => {
  const hits = FILES.filter((f) =>
    readFileSync(f, "utf8").includes("data-coverage-note="),
  ).map(rel);
  assert.deepEqual(
    hits,
    [],
    "the coverage note renders again. It was deleted by RULING 59, and a " +
      "deleted reader surface comes back the way it went out — as somebody " +
      "reinstating a component that used to be mandated (it was, by RULING 6 " +
      "and Prompt B item 7.6). If it is genuinely wanted back, that is the " +
      "author's ruling to make and this test is where he records it.",
  );
});

test("RULING 59: the tier prose is internal-only and reaches no reader", () => {
  // The tier constants still exist and still matter — docs/gap-ledger.md is
  // built from them, and RULING 59 explicitly sends the enumeration THERE.
  // What must not happen is one of them finding its way back onto a page.
  const readerRoots = ["app", "components"];
  const readerFiles = readerRoots.flatMap((r) => walk(join(ROOT, r)));
  const hits: string[] = [];
  for (const file of readerFiles) {
    const src = readFileSync(file, "utf8");
    for (const name of [
      "COVERAGE_TIER_ZIP_HEADLINE",
      "COVERAGE_TIER_NEXT_STEP",
      "COVERAGE_TIER_READER_LABEL",
    ]) {
      if (src.includes(name)) hits.push(`${rel(file)}: ${name}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "coverage-tier prose is being imported by a reader surface. These strings " +
      "are the gap ledger's vocabulary — internal, generated, current by " +
      "construction. On a page they are the banned form: a claim about our " +
      "holdings, derived from somewhere other than what is on screen.",
  );
});

test("FE-30: the retired completeness sentence has no reader import", () => {
  for (const dir of ["app", "components"]) for (const file of walk(join(ROOT, dir))) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(source, /import[^;]*collection-note|\{COLLECTION_NOTE\}/);
  }
});
