/**
 * **The end-of-queue sweep** — g21 item 9.5, and the reason this session is
 * the last queue session.
 *
 * `pnpm queue:homes` → writes `docs/queue-homes.md`.
 *
 * ## What it answers
 *
 * Every open row in `docs/deferred.csv` must end this session with a home
 * that WILL EXIST: finished, the feedback session, H, post-H, or killed.
 * **Nothing may point at a future g-session**, because there are no more.
 *
 * ## And the split every report so far has conflated
 *
 * The author works the QUEUE; the tracker is bigger than the queue. A report
 * that says "84 open" without saying how many of those are rows he is
 * actually looking at has told him a number about a document he does not
 * read. This prints both, every run.
 *
 * ## The homing rule, applied mechanically
 *
 * A row's home comes from the author's OWN disposition where it has one. The
 * mapping below is a reading of his words, not a decision about them, and a
 * row whose disposition does not decide a home is printed as NEEDS A HOME
 * rather than being assigned one quietly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// F01-continued session 2, item 0B: the Phoenix day comes from the one
// module that owns it, exactly as `pnpm stamp` does. This file used to
// carry its own byte-identical copy of the formatter — correct on the day
// it was written, and one more place for the rule to drift.
import { today } from "./doc-dates.mjs";

type Home = "FINISHED" | "FEEDBACK SESSION" | "H" | "POST-H" | "KILLED" | "NEEDS A HOME";

/**
 * Read the author's disposition into a home. Ordered: the FIRST pattern that
 * matches wins, so "pre H" is caught before the bare "H".
 */
function homeFrom(disposition: string, status: string, id: string): Home {
  if (/^(Done|Absorbed)/i.test(status)) return "FINISHED";
  const d = disposition.toLowerCase();
  // The author's standing parks, named individually in the g21 brief.
  if (id === "F01") return "FEEDBACK SESSION";
  if (id === "M07") return "FEEDBACK SESSION";
  if (/not rele[vw]ent|not relevant/.test(d)) return "KILLED";
  if (/^table\b|table for now|table until/.test(d)) return "KILLED";
  if (/pre h|post g7|do now|build now|wire them in now|finish now|keep curating/.test(d))
    return "H";
  if (/post h|in h|during h|schedule in h|sweep scheduled for h|build in h/.test(d))
    return "POST-H";
  if (/\bh\b/.test(d)) return "H";
  if (/keep rule|standing/i.test(status)) return "KILLED";
  return "NEEDS A HOME";
}

/**
 * Rows the g21 brief homes by NAME, overriding or supplying a disposition.
 * Each entry quotes the brief's own words so a later reader can check it.
 */
const BRIEF_HOMES: Record<string, { home: Home; why: string }> = {
  D70: { home: "POST-H", why: 'the brief: "It remains h2\'s build. Do not run it this session."' },
  P06: { home: "KILLED", why: 'the brief: "P06, P07, P08 remain TABLED." This CONTRADICTS the row\'s own disposition ("Build pre H"), and the brief is the later ruling — flagged so the author can overturn it in one line.' },
  P07: { home: "KILLED", why: 'the brief: "P06, P07, P08 remain TABLED." Same contradiction with the row\'s disposition; same flag.' },
  P08: { home: "KILLED", why: 'the brief: "P06, P07, P08 remain TABLED." Same contradiction with the row\'s disposition; same flag.' },
  M07: { home: "FEEDBACK SESSION", why: 'the brief: "M07 remains with the feedback session."' },
  AUD09: { home: "KILLED", why: 'the brief: "the author has approved leaving both recorded as documented unknowns inside bundle-budget.json. Do not chase."' },
  F01: { home: "FEEDBACK SESSION", why: 'the brief: "F01 is parked whole ... until the author calls the feedback session by name."' },
  HUNT01: { home: "H", why: "the depth sweep H is named for." },
  T10: { home: "POST-H", why: "waiting on the author's own testing pass; it cannot be scheduled by a session." },
  R33: { home: "FEEDBACK SESSION", why: "status is 'Blocked on the author' — it is a question for him, which is what the feedback session is." },
  T05: { home: "FEEDBACK SESSION", why: 'its disposition is "Unsure what the ask is here" — that is a question for the author, not work for a session.' },
  P09: { home: "FEEDBACK SESSION", why: 'its disposition is "Maybe, depending on…" — undecided is a decision he still owes.' },
};

/**
 * Rows whose disposition does not decide a home, homed by THIS SESSION.
 *
 * Kept separate from `BRIEF_HOMES` on purpose: these are g21's own calls, made
 * under the brief's unattended-session rule — *"Make the call this brief and
 * CLAUDE.md support, record the call and the reasoning, and keep going. A
 * recorded judgement the author can overturn in one line beats a stalled
 * session."* Every one is one line to overturn, and the reasoning is printed
 * beside it rather than folded into the author's own words.
 */
const SESSION_CALLS: Record<string, { home: Home; why: string }> = {
  B01: {
    home: "FEEDBACK SESSION",
    why: "g21's call. The disposition's ACTIONABLE half is done — the product is called Meanwhile everywhere. What is left is 'real name still in discussion', which is a decision only he makes.",
  },
  B02: {
    home: "FEEDBACK SESSION",
    why: "g21's call. A trademark search cannot start before B01's name is settled, and that is his decision.",
  },
  D03: {
    home: "POST-H",
    why: "g21's call. The disposition asks for NH, NJ and AZ and defers the rest; g19 verified all three already serve state roll calls live. The remaining states are the deferred half.",
  },
  D06: {
    home: "H",
    why: "g21's call. The disposition UNBLOCKS it; the build is unfinished, so it belongs with the work phase rather than after it.",
  },
  D50: {
    home: "H",
    why: "g21's call. The rungs half of the disposition shipped this session; the 750 collection target is unfinished work, not a post-launch item.",
  },
  D62: {
    home: "H",
    why: "g21's call. g20 shipped lib/sources/prl/ at 537 of 537 by bioguide, which is the disposition's 'yes'. What remains is downstream build.",
  },
  HUNT02: {
    home: "H",
    why: "g21's call. It is an H-family denominator row and its disposition describes what H should render.",
  },
  T03: {
    home: "POST-H",
    why: "g21's call, and it is the disposition read literally: 'Full review does not happen before open.'",
  },
  T04: {
    home: "KILLED",
    why: "g21's call. The disposition is a POLICY he has already stated — 'Never to solely one side, equal offers will always be made' — not work anyone can do. It stays a tracker row as the record of that policy.",
  },
  D23: {
    home: "KILLED",
    why: "g21's call, and it is the disposition read literally: 'table for lawyer. Not a code project.'",
  },
  M18: {
    home: "POST-H",
    why: "g21's call. 'Will address at the time' is a deferral to when a consolidated city-county actually enters scope, which is not before H.",
  },
  AUD05: {
    home: "POST-H",
    why: "g21's call. A serving-performance item with no disposition; nothing about coverage or honesty turns on it.",
  },
  AUD08: {
    home: "POST-H",
    why: "g21's call. Same class as AUD05 — a spatial access path is a scale concern, not a launch one.",
  },
  D68: {
    home: "H",
    why: "g21's call. The overwrite it records was verified repaired in g20; the row stays open for its GUARD — nothing yet stops a fetch script writing less data than it found — and that guard belongs with the work phase.",
  },
  D69: {
    home: "POST-H",
    why: "g21's call. A reconciliation between NCES and the Census of Governments for a state outside the three covered ones.",
  },
  R48: {
    home: "H",
    why: "g21's call, and it is the one on this list with a live blast radius: two scheduled workflows push to main with no rebase, so a collision loses a run. That is an ops defect that can eat a session's work, and it should not wait for after launch.",
  },
};

const deferred = parseCsv(readFileSync(join(ROOT, "docs", "deferred.csv"), "utf8"));
const tracker = parseCsv(readFileSync(join(ROOT, "docs", "tracker.csv"), "utf8"));
const dIx = Object.fromEntries(deferred[0].map((h, i) => [h, i]));
const tIx = Object.fromEntries(tracker[0].map((h, i) => [h, i]));
const trackerById = new Map(tracker.slice(1).map((r) => [r[0], r]));

const queueIds = new Set(deferred.slice(1).map((r) => r[0]));

interface Homed {
  id: string;
  item: string;
  status: string;
  disposition: string;
  home: Home;
  why: string;
}

const homed: Homed[] = [];
for (const row of deferred.slice(1)) {
  const id = row[0];
  const t = trackerById.get(id);
  const status = t ? t[tIx.Status] : "(not in tracker)";
  const disposition = (row[dIx.Disposition] ?? "").trim();
  const override = BRIEF_HOMES[id] ?? SESSION_CALLS[id];
  const home =
    /^(Done|Absorbed)/i.test(status) ? "FINISHED" : (override?.home ?? homeFrom(disposition, status, id));
  homed.push({
    id,
    item: t ? t[tIx.Item] : row[dIx.Item],
    status,
    disposition,
    home,
    why: /^(Done|Absorbed)/i.test(status)
      ? "closed in the tracker"
      : (override?.why ?? (disposition ? `the author's disposition: "${disposition}"` : "no disposition recorded")),
  });
}

const openTracker = tracker
  .slice(1)
  .filter((r) => !/^(Done|Absorbed)/i.test(r[tIx.Status]));
const openQueue = openTracker.filter((r) => queueIds.has(r[0]));
const openOutside = openTracker.filter((r) => !queueIds.has(r[0]));

const byHome = (h: Home) => homed.filter((x) => x.home === h);
const HOMES: Home[] = ["FINISHED", "H", "POST-H", "FEEDBACK SESSION", "KILLED", "NEEDS A HOME"];

const lines: string[] = [
  "# Where every deferred-queue row goes",
  "",
  "**Generated by `pnpm queue:homes` — do not hand-edit.**",
  "",
  `Generated ${today()}, at the close of the last queue session (g21).`,
  "",
  "Every open row in `docs/deferred.csv` gets a home that WILL EXIST: finished,",
  "H, post-H, the feedback session, or killed. **Nothing points at a future",
  "g-session**, because there are no more.",
  "",
  "## The split every report so far has conflated",
  "",
  "The author works the QUEUE. The tracker is bigger than the queue, and a",
  "report that says \"N open\" without saying how many of those are rows he is",
  "actually looking at has told him a number about a document he does not read.",
  "",
  `* **Tracker rows: ${tracker.length - 1}**, of which **${openTracker.length} are open** (not Done or Absorbed).`,
  `* **Of those ${openTracker.length} open rows, ${openQueue.length} are DEFERRED-QUEUE rows** — the ones he works.`,
  `* **${openOutside.length} are tracker rows OUTSIDE the queue** — this session's own new rows and prior sessions' internal work items.`,
  `* The queue itself holds **${deferred.length - 1} rows**, of which **${byHome("FINISHED").length} are now closed**.`,
  "",
  "Open tracker rows outside the queue: " +
    (openOutside.length > 0 ? openOutside.map((r) => `\`${r[0]}\``).join(", ") : "none") +
    ".",
  "",
];

for (const home of HOMES) {
  const rows = byHome(home);
  lines.push(`## ${home} — ${rows.length}`, "");
  if (rows.length === 0) {
    lines.push(
      home === "NEEDS A HOME"
        ? "**None.** Every open queue row has a home. That is what makes this the last queue session."
        : "None.",
      "",
    );
    continue;
  }
  lines.push("| Row | Item | Status | Why here |", "|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| \`${r.id}\` | ${r.item.replace(/\|/g, "/").slice(0, 80)} | ${r.status} | ${r.why.replace(/\|/g, "/")} |`,
    );
  }
  lines.push("");
}

const out = join(ROOT, "docs", "queue-homes.md");
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");

console.log(`wrote ${out}`);
console.log(`  queue rows:            ${deferred.length - 1}`);
console.log(`  tracker rows:          ${tracker.length - 1}`);
console.log(`  open tracker rows:     ${openTracker.length}`);
console.log(`    of which queue rows: ${openQueue.length}`);
console.log(`    outside the queue:   ${openOutside.length}`);
for (const home of HOMES) console.log(`  ${home.padEnd(18)} ${byHome(home).length}`);
if (byHome("NEEDS A HOME").length > 0) {
  console.error(
    `\nREFUSING TO CALL THE QUEUE SWEPT: ${byHome("NEEDS A HOME").length} row(s) have no home.`,
  );
  process.exit(1);
}
