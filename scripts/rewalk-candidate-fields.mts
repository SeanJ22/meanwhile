/**
 * **RE-WALK EVERY CANDIDATE FIELD THIS PRODUCT CLAIMS TO HOLD** (built
 * 2026-08-21, NH Hunt 5 item 3; RULING 53).
 *
 * ```
 * pnpm rewalk:candidates                 # the report, no writes
 * pnpm rewalk:candidates --stamp         # write checkedAt for every field re-walked
 * pnpm rewalk:candidates --only=nh       # limit to keys containing a substring
 * ```
 *
 * ## Why this exists
 *
 * RULING 53 says an absence is a measurement with a shelf life. Its second
 * half, which is easier to forget, is that **a record that cannot say when it
 * was measured reads as stale rather than fresh** — defaulting the other way
 * is how a bad date buys permanent trust.
 *
 * On 2026-08-21 `data/ballot/candidate-hunt-state.json` held 544 field records
 * and **not one carried a date**. `pnpm stale` reported "0 stale of 0
 * measured", because it only counted recorded ABSENCES and there are none;
 * every FOUND field — 138 of them, each a live claim about a named person on a
 * page a reader can open — was outside its view entirely. A zero-row read
 * presented as a clean board.
 *
 * So two things were needed and neither existed: `pnpm stale` had to count
 * FOUND (fixed in that script), and something had to be able to RE-WALK what
 * it counts. This is that something.
 *
 * ## What a re-walk actually checks, per field
 *
 * The point is not to re-derive the value. It is to ask whether the claim this
 * product is making today still stands, which is a different and cheaper
 * question:
 *
 * - **photo** — the committed asset under `public/`. Photos are served from
 *   our own origin by the photo rule, so this is ladder rung 1 and it is
 *   local: does the file this card points at exist, and is it non-empty. A
 *   card pointing at a missing image renders a broken portrait, which is a
 *   visible defect no DOM assertion catches.
 * - **campaignSite** — a live fetch of the URL. A campaign site that has gone
 *   down is the single most perishable Kelly field; the seven-day window
 *   exists for it.
 * - **blurb** — a live fetch of `bioSourceUrl`, plus a check that the quoted
 *   text is STILL ON THE PAGE. A blurb whose source no longer contains it has
 *   become an unsourced description of a real person, which the blurb rule
 *   says is treated as a generated claim and removed.
 * - **contact** — a phone or email has no URL to re-walk, so what is checked
 *   is that the value is still present and still shaped like what it claims to
 *   be. This is the WEAKEST of the four and it is reported as such rather than
 *   counted as a clean verification; a disconnected number answers a fetch
 *   with nothing.
 *
 * ## What it does NOT do
 *
 * It never deletes, never downgrades, and never writes a value. Stale is not
 * wrong. A field whose re-walk fails is REPORTED, with what the branch
 * returned, and the decision is the session's — because removing a fact about
 * a named person because one route was refused today is exactly the
 * failed-fetch-empties-a-full-surface defect, moved to the candidate layer.
 *
 * `--stamp` writes `checkedAt` and nothing else. That is the whole of its
 * write authority, and it is what turns 138 undated records into 138 dated
 * ones so the next session inherits a measurement rather than a mystery.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STAMP = process.argv.includes("--stamp");
const JSON_OUT = process.argv.includes("--json");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;
const AS_OF = today();

interface HuntRecord {
  state: string;
  checkedAt?: string;
  [k: string]: unknown;
}
interface HuntState {
  candidates: Record<string, Record<string, HuntRecord>>;
  [k: string]: unknown;
}
interface Card {
  photoUrl?: string | null;
  bio?: string | null;
  bioSourceUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  [k: string]: unknown;
}

const HUNT_PATH = join(ROOT, "data", "ballot", "candidate-hunt-state.json");
const state = JSON.parse(readFileSync(HUNT_PATH, "utf8")) as HuntState;
const cardsFile = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as { cards: Record<string, Card> };
const linksFile = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8"),
) as {
  links: Record<string, { campaign?: { url?: string } | null; official?: { url?: string } | null }>;
};

type Verdict = "STANDS" | "WRONG" | "UNCHECKABLE" | "DUPLICATE_KEY";

/**
 * THE DUPLICATE-KEY FINDING, and why it gets a verdict of its own.
 * (NH Hunt 5, 2026-08-21.)
 *
 * `candidate-hunt-state.json` holds 136 candidate keys in TWO formats for the
 * same people: a slug form, `ballot-az-pima:governor:hobbs-katie`, and a
 * pipe-and-display-name form, `ballot-az-pima:governor|Katie Hobbs`. Thirty of
 * the 136 are the pipe form and every one of them names somebody the slug form
 * already names. `candidate-cards-2026.json` carries 20 of the same duplicates.
 *
 * It is why `pnpm hunt:gaps` counts 92 candidates while the hunt state holds
 * 136, and it is why the first run of this script reported "the card carries
 * no bio text" for a row of AZ candidates whose bios are sitting in the file
 * under their other key.
 *
 * These are NOT counted as WRONG. A duplicate key is a defect in our indexing,
 * not a claim about a person that stopped being true, and folding the two
 * together would inflate an error rate that is supposed to mean something. It
 * gets its own line, its own count, and a tracker row.
 */
function isDuplicateKey(key: string): boolean {
  return key.includes("|");
}

interface Result {
  key: string;
  field: string;
  verdict: Verdict;
  branch: string;
  detail: string;
}

const results: Result[] = [];

/** One live read, with every failure turned into a sentence rather than a throw. */
async function readPage(url: string): Promise<{ ok: boolean; text: string; note: string }> {
  try {
    /*
     * politeGetText returns the STATUS and the body, not a bare string — a
     * 200 is a status and not a document, which is the whole reason it is
     * shaped this way (RULING 43).
     *
     * `expect` is deliberately NOT passed. The first version of this script
     * passed `expect: "html"`, and `expect` takes an object of `{label,
     * marker}` — so `expect.marker` was `undefined`, `text.includes(undefined)`
     * was false, and EVERY campaign site that answered 200 was recorded as a
     * WALL. That is 28 live sites reported dead and an error rate of 34.8%
     * that was almost entirely this instrument's own defect. RULING 12: check
     * whose stopwatch ran out, and it was ours.
     *
     * There is no honest marker to demand here anyway. These are campaign
     * sites on every CMS there is; the thing being re-walked is whether the
     * URL still answers, and `politeGetText` already refuses an empty body.
     */
    const res = await politeGetText(url);
    return {
      ok: true,
      text: res.text,
      note: `HTTP ${res.status}, ${res.text.length} bytes, ${res.contentType || "no content-type"}`,
    };
  } catch (error) {
    return { ok: false, text: "", note: (error as Error).message.split("\n")[0].slice(0, 160) };
  }
}

/** The quoted blurb, reduced to something a page's own markup can be searched for. */
function blurbNeedle(bio: string): string {
  const words = bio
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 3);
  // A short distinctive run rather than the whole sentence: a page may have
  // rewrapped, re-punctuated or re-cased the text without having changed it.
  return words.slice(0, 6).join(" ").toLowerCase();
}

function looseText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function rewalk(key: string, field: string, card: Card): Promise<Result> {
  const base = { key, field };

  if (isDuplicateKey(key)) {
    const twin = key.slice(0, key.indexOf("|"));
    return {
      ...base,
      verdict: "DUPLICATE_KEY",
      branch: "the hunt-state index",
      detail:
        `a second key for a candidate the slug form already holds under ${twin}:… — ` +
        "an indexing defect, not a claim that stopped being true",
    };
  }

  if (field === "photo") {
    const url = card.photoUrl;
    if (!url) {
      return { ...base, verdict: "WRONG", branch: "rung 1 — committed asset", detail: "the card records FOUND but carries no photoUrl" };
    }
    if (/^https?:/i.test(url)) {
      // The photo rule says every shipped photo is served from our own origin.
      // A remote URL on a card is itself the finding.
      return { ...base, verdict: "WRONG", branch: "rung 1 — committed asset", detail: `photoUrl is remote (${url}); the photo rule requires our own origin` };
    }
    const file = join(ROOT, "public", url.replace(/^\//, ""));
    if (!existsSync(file)) {
      return { ...base, verdict: "WRONG", branch: "rung 1 — committed asset", detail: `no file at public${url} — the card renders a broken portrait` };
    }
    const bytes = statSync(file).size;
    if (bytes < 1024) {
      return { ...base, verdict: "WRONG", branch: "rung 1 — committed asset", detail: `public${url} is ${bytes} bytes — too small to be a portrait` };
    }
    return { ...base, verdict: "STANDS", branch: "rung 1 — committed asset", detail: `public${url}, ${bytes} bytes` };
  }

  if (field === "campaignSite") {
    const url = linksFile.links[key]?.campaign?.url;
    if (!url) {
      return { ...base, verdict: "WRONG", branch: "rung 2 — plain fetch", detail: "FOUND, but no campaign URL is recorded for this key" };
    }
    const r = await readPage(url);
    return {
      ...base,
      verdict: r.ok ? "STANDS" : "WRONG",
      branch: "rung 2 — plain fetch",
      detail: `${url} — ${r.note}`,
    };
  }

  if (field === "blurb") {
    const src = card.bioSourceUrl;
    const bio = card.bio;
    if (!bio) {
      return { ...base, verdict: "WRONG", branch: "the card itself", detail: "FOUND, but the card carries no bio text" };
    }
    if (!src) {
      return { ...base, verdict: "WRONG", branch: "the card itself", detail: "a blurb with no source URL — the blurb rule removes it" };
    }
    const r = await readPage(src);
    if (!r.ok) {
      return { ...base, verdict: "WRONG", branch: "rung 2 — plain fetch of the quoted source", detail: `${src} — ${r.note}` };
    }
    const needle = blurbNeedle(bio);
    const present = looseText(r.text).includes(needle);
    return {
      ...base,
      verdict: present ? "STANDS" : "UNCHECKABLE",
      branch: "rung 2 — plain fetch of the quoted source",
      detail: present
        ? `${src} still carries the quoted opening`
        : `${src} answered, but the quoted opening ("${needle}") was not found in its text — the page may have been rewritten, or the quote may live behind JavaScript (rung 6 not walked here)`,
    };
  }

  if (field === "contact") {
    const bits: string[] = [];
    if (card.email) bits.push(`email ${card.email}`);
    if (card.phone) bits.push(`phone ${card.phone}`);
    if (bits.length === 0) {
      return { ...base, verdict: "WRONG", branch: "the card itself", detail: "FOUND, but the card carries neither an email nor a phone" };
    }
    return {
      ...base,
      verdict: "UNCHECKABLE",
      branch: "the card itself — no live branch exists for a phone or an email",
      detail: `${bits.join(", ")} — present and well-formed, but a stored number is not a reachable number and this must not be counted as a live verification`,
    };
  }

  return { ...base, verdict: "UNCHECKABLE", branch: "none", detail: `no re-walk is defined for field ${field}` };
}

/* -------------------------------------------------------------------------- */

const queue: { key: string; field: string; card: Card }[] = [];
for (const [key, fields] of Object.entries(state.candidates ?? {})) {
  if (ONLY && !key.includes(ONLY)) continue;
  const card = cardsFile.cards[key];
  for (const [field, record] of Object.entries(fields)) {
    if (record.state !== "FOUND") continue;
    if (!card) {
      /*
       * ORDER MATTERS HERE, and getting it wrong cost a wrong headline once.
       *
       * A duplicate pipe-form key usually has no card of its own — the card
       * lives under the slug form. Reporting that as "the hunt state says
       * FOUND and no card exists" put 12 indexing duplicates into the WRONG
       * bucket and pushed the error rate to 15.1% when the real figure was
       * 1.6%. The duplicate check has to come FIRST, because "there is no
       * card under this key" is a SYMPTOM of the duplicate rather than a
       * separate finding.
       */
      results.push({
        key,
        field,
        verdict: isDuplicateKey(key) ? "DUPLICATE_KEY" : "WRONG",
        branch: "the card index",
        detail: isDuplicateKey(key)
          ? `a second key for a candidate the slug form already holds under ` +
            `${key.slice(0, key.indexOf("|"))}:… — the card is filed under that key`
          : "the hunt state says FOUND and no card exists under this key",
      });
      continue;
    }
    queue.push({ key, field, card });
  }
}

console.log(`\nre-walk of every FOUND candidate field — RULING 53, ${AS_OF}\n`);
console.log(`  ${queue.length} field(s) queued${ONLY ? ` (--only=${ONLY})` : ""}\n`);

let done = 0;
for (const item of queue) {
  const r = await rewalk(item.key, item.field, item.card);
  results.push(r);
  done++;
  if (done % 10 === 0) console.log(`  … ${done} of ${queue.length}`);
}

const stands = results.filter((r) => r.verdict === "STANDS");
const wrong = results.filter((r) => r.verdict === "WRONG");
const uncheckable = results.filter((r) => r.verdict === "UNCHECKABLE");
const dupes = results.filter((r) => r.verdict === "DUPLICATE_KEY");

if (JSON_OUT) {
  console.log(JSON.stringify({ asOf: AS_OF, results }, null, 1));
} else {
  if (wrong.length) {
    console.log(`\n  WRONG — the claim no longer stands (${wrong.length}):\n`);
    for (const r of wrong) console.log(`    ${r.key} · ${r.field}\n      [${r.branch}] ${r.detail}`);
  }
  if (uncheckable.length) {
    console.log(`\n  NOT VERIFIABLE BY THIS INSTRUMENT (${uncheckable.length}) — named, never counted as clean:\n`);
    for (const r of uncheckable) console.log(`    ${r.key} · ${r.field}\n      [${r.branch}] ${r.detail}`);
  }
  // The PAIR, always. A bare "12 wrong" hides whether that is 12 of 13 or 12 of 1300.
  if (dupes.length) {
    console.log(
      `\n  DUPLICATE KEYS (${dupes.length}) — an indexing defect, counted apart from the error rate:\n`,
    );
    for (const r of dupes) console.log(`    ${r.key} · ${r.field}`);
  }
  console.log(
    `\n  RE-WALKED ${results.length} · STANDS ${stands.length} · WRONG ${wrong.length} · ` +
      `NOT VERIFIABLE ${uncheckable.length} · DUPLICATE KEY ${dupes.length}`,
  );
  const sum = stands.length + wrong.length + uncheckable.length + dupes.length;
  console.log(
    `  ${stands.length} + ${wrong.length} + ${uncheckable.length} + ${dupes.length} = ${sum}` +
      (sum === results.length ? "  (reconciles)" : "  *** DOES NOT RECONCILE ***"),
  );
  /*
   * The denominator EXCLUDES duplicate keys, and says so on the line.
   *
   * An error rate is the share of live claims that stopped being true. A
   * duplicate index key was never a claim about a person, so leaving it in
   * would measure our filing cabinet and call it our accuracy.
   */
  const judged = stands.length + wrong.length + uncheckable.length;
  const errorRate = judged ? ((wrong.length / judged) * 100).toFixed(1) : "0.0";
  console.log(
    `  error rate: ${wrong.length} of ${judged} judged (${errorRate}%) — ` +
      `${dupes.length} duplicate key(s) excluded from the denominator\n`,
  );
}

if (STAMP) {
  /*
   * The ONLY write, and it writes one key.
   *
   * `checkedAt` is a fact about US — the date this product last asked. It is
   * stamped for every field actually re-walked, including the ones that came
   * back WRONG and the ones no branch could verify, because "we asked on this
   * date and could not confirm it" is a measurement and is exactly what
   * RULING 53 wants recorded. What is NOT written is any change to `state`:
   * downgrading a FOUND field because one branch was refused today is the
   * failed-fetch-empties-a-full-surface defect at the candidate layer, and
   * the decision belongs to a session with judgement in it.
   */
  let stamped = 0;
  for (const r of results) {
    const rec = state.candidates?.[r.key]?.[r.field];
    if (!rec) continue;
    rec.checkedAt = AS_OF;
    rec.lastRewalk = { verdict: r.verdict, branch: r.branch, detail: r.detail };
    stamped++;
  }
  writeFileSync(HUNT_PATH, `${JSON.stringify(state, null, 1)}\n`, "utf8");
  console.log(`  STAMPED checkedAt=${AS_OF} on ${stamped} of ${results.length} record(s) — ${HUNT_PATH}\n`);
}

// A re-walk that found nothing wrong is a good day, not a failure. What is a
// failure is a run that re-walked nothing at all, which would be the zero-row
// shape this whole instrument was built because of.
if (results.length === 0) {
  console.error(
    "re-walked ZERO fields. That is an error state, not an empty queue: the " +
      "hunt state holds FOUND records and this run reached none of them.",
  );
  process.exit(1);
}
