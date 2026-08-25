/**
 * `context.md` — the seventh mirror file, generated at handoff.
 *
 * `state.md` is 249 KB and growing, and it is the wrong artifact to hand a
 * conversation that only needs to know where things stand: by the time it has
 * been pasted anywhere useful there is no room left for the actual question.
 * This is the short answer to "what is the current state of this project" —
 * dense and flat. **It carries no size cap** (RULING 106, 2026-08-23): it is
 * short because every section is an index rather than a copy, not because
 * anything trims it to fit. Where it grows, the answer is to remove
 * duplication in the SOURCE, never to clip the output.
 *
 * **Nothing in it is composed.** Every line is read out of `docs/state.md`,
 * `docs/tracker.csv`, `lib/ripcords.ts` and git. Where a field is too long for
 * a table the clip is marked, never smoothed. A generated summary that
 * paraphrased any of this would be a fresh set of claims with no source
 * behind them, which is the failure this repo spends most of its rules on.
 *
 * Like `git-state.txt` it is **generated, has no repo counterpart, is never
 * compared for drift, and is skipped by `--check`** — there is nothing to
 * compare it to, so a drift check could only ever report noise. It is
 * rewritten after a successful `--ship`, because a merge moves every fact in
 * it.
 *
 * Ripcord state is read from `lib/ripcords.ts` rather than from prose. That
 * module is the state of record — `pulled: true` is the committed position of
 * the switch — and a prose copy of it in `state.md` can be stale in a way the
 * registry cannot.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * **THERE IS NO CAP. RULING 106, 2026-08-23 (`NS09`, the author ruled C and
 * extended it: there are no caps anywhere).**
 *
 * The history is the argument. 20 KB truncated the tracker-change section to
 * nothing — the g6 session's own handoff reported *"19.4 KB of 20 KB —
 * TRUNCATED: tracker-change section: 10 of 10 rows dropped; P0 notes clipped
 * from 130 to 110 characters"*, which is the whole of that section gone from
 * the one file that orients every session. ITEM 8c raised it to 40 KB, and by
 * 2026-08-23 the same cascade was dropping the same section again and clipping
 * P0 notes from 130 characters to 90.
 *
 * Raising a cap is treating a recurring symptom. **A cap forces silent
 * trimming, and silent trimming is a partial that reconciles and reports
 * success — the same failure shape as RULING 100.** The shrink cascade
 * announced its cuts, which is better than nothing and is still a file that
 * says less than it knows while reading as complete.
 *
 * Where a generated file grows, the response is to remove duplication in the
 * SOURCE, never to clip the output.
 *
 * `CAP_BYTES` is kept, exported, and set to `Infinity` rather than deleted:
 * `pnpm handoff` and `tests/context-pinned-conduct.test.ts` both import it,
 * and a name that disappears is a name a later reader cannot search for.
 */
export const CAP_BYTES = Infinity;

/**
 * How much of a tracker Note survives into a one-line cell.
 *
 * **Restored to its full length and no longer clipped by the cascade** (RULING
 * 106). This is the length the author set; the shrink path used to walk it
 * down to 90 and, at 20 KB, to 110.
 */
const NOTE_CHARS = 130;
const ITEM_CHARS = 62;

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** Collapse a multi-line CSV cell to one line, marking any clip. */
function oneLine(text, limit) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/** Markdown tables break on a raw pipe. */
const cell = (s) => s.replace(/\|/g, "\\|");

/* --------------------------------------------------------------- phases --- */

/**
 * The phase standings, from `docs/state.md` §7.
 *
 * They are a bullet list in the source, not a table — each bullet opens with
 * a bolded standing ("**4.5 done** — ...") which is exactly the phase/status
 * split a table wants. The bold lead becomes the phase, the rest of the first
 * sentence becomes the status, and a clip is marked.
 */
export function readPhases(stateText) {
  const HEADING = "### Where the phases stand";
  const start = stateText.indexOf(HEADING);
  if (start === -1) {
    return {
      rows: [],
      source: "docs/state.md — section not found",
      failure: `\`${HEADING}\` is not in docs/state.md — the heading moved or was renamed`,
    };
  }

  const rest = stateText.slice(start);
  const end = rest.indexOf("\n## ");
  const block = end === -1 ? rest : rest.slice(0, end);

  const rows = [];
  const push = (phase, status) =>
    rows.push({ phase: oneLine(phase, 46), status: oneLine(status, 150) });

  // Shape 1: a bullet list, each bullet opening with a bolded standing.
  // Bullets wrap across lines; join each back into one string first.
  const bullets = block.split(/\n(?=- )/).filter((b) => b.startsWith("- "));
  for (const bullet of bullets) {
    const flat = bullet.replace(/^- /, "").replace(/\s+/g, " ").trim();
    const bold = flat.match(/^\*\*(.+?)\*\*/);
    const phase = bold ? bold[1] : flat.split(" — ")[0];
    const status = (bold ? flat.slice(bold[0].length) : flat.slice(phase.length))
      .replace(/^[\s—-]+/, "")
      .trim();
    push(phase, status);
  }

  /*
   * Shape 2 (added 2026-08-17, item 8c): bolded PARAGRAPHS.
   *
   * The h session restructured this section from a bullet list into
   * "**Phase A — The federal card. Complete but for one panel.** ..."
   * paragraphs. The bullet parser then found nothing, and the generator
   * printed "_No phase standings found in state.md — the section heading
   * moved._"
   *
   * **The heading had not moved.** It was exactly where it had always been —
   * the message asserted a cause nobody had checked, in the one file whose
   * job is to orient a session that has no other context. An empty section
   * with a confident wrong explanation is worse than an empty section, and it
   * is the same defect class as a render default manufacturing a claim.
   */
  if (rows.length === 0) {
    for (const para of block.split(/\n\s*\n/)) {
      const flat = para.replace(/\s+/g, " ").trim();
      const m = flat.match(/^\*\*(Phase [^*]+?)\*\*/i);
      if (!m) continue;
      push(m[1], flat.slice(m[0].length).replace(/^[\s—-]+/, "").trim());
    }
  }

  if (rows.length === 0) {
    return {
      rows,
      source: "docs/state.md §7 — Where the phases stand",
      failure:
        `the heading \`${HEADING}\` WAS found at byte ${start}, but no phase rows could be ` +
        `parsed from the ${block.length} bytes under it — neither the bullet shape ` +
        `("- **Phase A** …") nor the paragraph shape ("**Phase A — …**") matched. ` +
        `The section's format changed again; teach this parser the new shape.`,
    };
  }
  return { rows, source: "docs/state.md §7 — Where the phases stand" };
}

/* -------------------------------------------------------------- tracker --- */

export function readTracker(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0].map((c) => c.value.trim());
  const index = (name) => header.indexOf(name);

  const records = rows
    .slice(1)
    .filter((r) => r.length >= header.length && r[0].value.trim() !== "")
    .map((r) => ({
      id: r[index("ID")].value.trim(),
      area: r[index("Area")]?.value.trim() ?? "",
      item: r[index("Item")]?.value.trim() ?? "",
      priority: r[index("Priority")]?.value.trim() ?? "",
      status: r[index("Status")]?.value.trim() ?? "",
      notes: r[index("Notes")]?.value ?? "",
    }));
  return { header, records };
}

/**
 * The last N tracker rows whose Status changed, most recent first.
 *
 * There is no changed-at column, so the history is the only place this lives:
 * walk the commits that touched `docs/tracker.csv`, parse the file on both
 * sides of each, and diff Status by ID. First-parent so a merge reports the
 * branch's net change once rather than every commit inside it.
 *
 * **A new row is not a status change** and is counted separately rather than
 * listed. One session that opens ten rows would otherwise fill the whole
 * section with `(new row) → Done` and push out every actual transition, which
 * is the opposite of what the section is for. The count of new rows seen is
 * reported so their absence from the table is stated, not silent.
 *
 * Bounded by `maxCommits` on purpose — the whole history is 90+ commits of a
 * 250 KB CSV and this runs inside a handoff. When the bound is what stopped
 * the walk the caller is told, so a short list never reads as "nothing else
 * ever changed".
 */
export function readStatusChanges(limit = 10, maxCommits = 30) {
  const log = git([
    "log",
    "--first-parent",
    "--format=%H%x09%ad%x09%s",
    "--date=short",
    `--max-count=${maxCommits}`,
    "--",
    "docs/tracker.csv",
  ]);
  if (!log) return { changes: [], scannedCommits: 0, newRows: 0, exhausted: true };

  const commits = log.split("\n").filter(Boolean);
  const changes = [];
  let scanned = 0;
  let newRows = 0;

  const statusesAt = (rev) => {
    const text = git(["show", `${rev}:docs/tracker.csv`]);
    if (text === null) return null;
    const map = new Map();
    for (const r of readTracker(text).records) map.set(r.id, r.status);
    return map;
  };

  for (const line of commits) {
    if (changes.length >= limit) break;
    scanned++;
    const [sha, date, ...subjectParts] = line.split("\t");
    const subject = subjectParts.join("\t");

    const after = statusesAt(sha);
    const before = statusesAt(`${sha}^`);
    if (after === null || before === null) continue;

    for (const [id, status] of after) {
      const was = before.get(id);
      if (was === undefined) {
        newRows++;
        continue;
      }
      if (was === status) continue;
      if (changes.length >= limit) continue;
      changes.push({ id, from: was, to: status, date, sha, subject });
    }
  }

  return {
    changes,
    scannedCommits: scanned,
    newRows,
    exhausted: scanned >= commits.length && changes.length < limit,
    availableCommits: commits.length,
  };
}

/* ------------------------------------------------------------- ripcords --- */

export async function readRipcords() {
  try {
    const registry = await import("../lib/ripcords.ts");
    return Object.entries(registry.RIPCORDS).map(([name, r]) => ({
      name,
      state: r.pulled ? "PULLED" : "live",
      envVar: r.envVar,
      question: r.question,
      closer: r.closer,
      trackerRows: r.trackerRows,
    }));
  } catch (error) {
    return { error: error.message };
  }
}

/* ---------------------------------------------------------------- build --- */

/**
 * Assemble the file, then shrink it until it fits.
 *
 * The cap is the author's, and the order of sacrifice is the author's too:
 * the tracker-change section goes first, because it is the only section that
 * degrades gracefully — nine recent changes is nine recent changes. Everything
 * that is cut says so in the file, in the section it was cut from. A silent
 * truncation would make a partial file read as a complete one, which is the
 * single thing this project's rules never permit.
 */
/**
 * THE RULINGS INDEX (Prompt C item 5, 2026-08-20).
 *
 * `docs/rulings.md` is the append-only record of every decision the author has
 * made that is NOT law. Before it existed those decisions lived only in
 * whichever chat window was open at the time, which meant a session could be
 * told to "hardcode the ruling as fact" with no way to check what the ruling
 * said, and a superseded ruling could return as drift because nothing recorded
 * that it had been replaced.
 *
 * Surfacing it here is what makes every session open on it. **Nothing is
 * composed** — the headings are read out of the file, exactly like every other
 * section of this generator. The bodies are not copied: this is an index, and
 * a session that needs one reads the file.
 */
function readRulings() {
  let text;
  try {
    text = readFileSync(join(ROOT, "docs/rulings.md"), "utf8");
  } catch (error) {
    return { headings: [], failure: `could not read docs/rulings.md: ${error.message}` };
  }
  const headings = text
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4).trim());
  return {
    headings,
    failure: headings.length === 0 ? "docs/rulings.md carries no `###` ruling headings" : null,
  };
}

/**
 * THE PINNED DISCOVERY-CONDUCT BLOCK (2026-08-22, the author's Discovery
 * Conduct brief, item 8).
 *
 * `CLAUDE.md`'s **Discovery conduct** section is read out VERBATIM and is
 * **never trimmed**. If the cap bites, the shrink cascade below trims elsewhere
 * and says exactly what it trimmed.
 *
 * ## Why this one section is pinned when nothing else here is
 *
 * Every other section of this file is an INDEX — headings, counts, pointers —
 * on the principle that a session that needs the text reads the file. That
 * principle is right, and it is exactly wrong for this block, because the
 * failure this block exists to fix is a session not knowing there was anything
 * to look up. RULING 88 requires an output — a list of routes that did not
 * exist at session start — that a session cannot produce by consulting a
 * reference it was never prompted to open. A pointer would be read as *more
 * rules about hunting, read if stuck*, which is how the last three fixes were
 * absorbed and then not applied.
 *
 * **Nothing is composed.** The text is `CLAUDE.md`'s own, sliced between its
 * heading and the next `##`, so it cannot drift from the law it quotes.
 */
function readDiscoveryConduct() {
  let text;
  try {
    text = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  } catch (error) {
    return { body: "", failure: `could not read CLAUDE.md: ${error.message}` };
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+DISCOVERY CONDUCT\s*$/i.test(l));
  if (start < 0) {
    return {
      body: "",
      failure: "CLAUDE.md carries no `## DISCOVERY CONDUCT` heading — the section was renamed or removed",
    };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end).join("\n").trimEnd();
  return {
    body,
    failure: body.length < 500 ? `the section is only ${body.length} bytes — it looks truncated or emptied` : null,
  };
}

export async function buildContext({
  gitFacts = [],
  generatedAt,
  stampToday,
  // Injectable so the shrink path can be exercised against a real tree
  // instead of being a branch nobody has ever run.
  cap = CAP_BYTES,
}) {
  const stateText = readFileSync(join(ROOT, "docs/state.md"), "utf8");
  const csvText = readFileSync(join(ROOT, "docs/tracker.csv"), "utf8");

  const phases = readPhases(stateText);
  const { records } = readTracker(csvText);
  const p0 = records.filter((r) => r.priority === "P0");
  const ripcords = await readRipcords();
  const conduct = readDiscoveryConduct();
  const history = readStatusChanges(10);

  const render = (changeLimit, noteChars, cutNote) => {
    const out = [];
    const put = (...lines) => out.push(...lines);

    put(
      "# we-the-people — current context",
      "",
      "**GENERATED FILE — do not edit, and do not copy it back into the repo.**",
      /*
       * **TWO CLOCKS, ONE OF THEM AHEAD — and the file has to say so.**
       *
       * The run stamp is EASTERN by R18 (2026-08-17, the author's ruling) and
       * the session day is AMERICA/PHOENIX by the date doctrine. Between about
       * 21:00 and midnight Phoenix, Eastern is already TOMORROW, so this header
       * prints a date one day ahead of the session day directly above it.
       *
       * That is not a fabrication — it is a clock read, in the zone a ruling
       * names, with its own zone label attached. But the pre-commit date scan
       * cannot tell a clock read from a claim, and it correctly REFUSED the
       * commit: an unannotated future date is exactly what it exists to catch.
       *
       * So the generator declares it, and only when the collision is real. The
       * annotation is emitted from the same two values it is about, so it can
       * never describe a discrepancy that is not there.
       */
      `Written by \`pnpm handoff\` (\`scripts/context-file.mjs\`) at ${generatedAt}.` +
        (generatedAt.slice(0, 10) > stampToday
          ? ` <!-- expected-future: an Eastern run stamp (R18) past midnight while the Phoenix session day is still ${stampToday} -->`
          : ""),
      `Session day ${stampToday} (America/Phoenix, from \`pnpm stamp\`).`,
      "",
      "It has no repo counterpart, is never compared for drift, is skipped by",
      "`pnpm handoff --check`, and is overwritten after every successful `--ship`.",
      "",
      "It exists so a conversation outside the repo can get current without pulling",
      `the ${Math.round(Buffer.byteLength(stateText) / 1024)} KB \`state.md\`. **Nothing in it is composed** — every line is read`,
      "from `docs/state.md`, `docs/tracker.csv`, `lib/ripcords.ts` and git. Long",
      "fields are clipped with `…`; nothing is summarised.",
      "",
      "---",
      "",
    );

    /* phases */
    put(`## Phases — ${phases.rows.length} standing(s)`, "", `Source: ${phases.source}.`, "");
    if (phases.rows.length === 0) {
      /*
       * ITEM 8c: a section that CANNOT BE BUILT renders as a stated failure
       * naming what was dropped and why — never as an absence, and never as
       * silence. The previous text guessed at the cause ("the section heading
       * moved") and was wrong; `readPhases` now returns what actually
       * happened and this prints it.
       */
      put(
        `> **SECTION FAILED — phases could not be built.** ${phases.failure ?? "no reason recorded"}`,
        "",
        "> This is a failure of this generator, not a statement that the project has no phases.",
        "",
      );
    } else {
      put("| Phase | Status |", "|---|---|");
      for (const row of phases.rows) put(`| ${cell(row.phase)} | ${cell(row.status)} |`);
      put("");
    }

    /* P0 */
    /* rulings — decisions that are not law, and where to read them */
    /*
     * The PINNED block, first among the reference sections and never trimmed.
     * It is placed AHEAD of the rulings index deliberately: an index tells a
     * session what exists, and this tells it what it is required to produce.
     */
    if (conduct.failure) {
      put(
        `> **SECTION FAILED — the pinned Discovery conduct block could not be built.** ${conduct.failure}`,
        "",
        "> This is a failure of this generator, not a statement that the rule does not exist.",
        "> Read `CLAUDE.md` directly. **This block is never trimmed** — if it is",
        "> missing, something removed or renamed it upstream.",
        "",
      );
    } else {
      /*
       * **The provenance goes BEFORE the block as well as after it** (RULING
       * 106, 2026-08-23). It used to sit only at the end, which meant a reader
       * landing on the heading — which is what a reader does — read the whole
       * thing before being told where it came from. Uncapped, this file has to
       * be readable as a set of SOURCED EXTRACTS rather than as a second
       * authority competing with `CLAUDE.md`, and that only works if each
       * section says whose words these are at the point the reader arrives.
       *
       * Found by `tests/context-pinned-conduct.test.ts`, which sweeps every
       * `## ` heading for a source line and found this one without one.
       */
      put(
        "<!-- PINNED: never trimmed. Verbatim from CLAUDE.md. -->",
        "",
        "> **Source: `CLAUDE.md`, the `## DISCOVERY CONDUCT` section, verbatim.**",
        "> `CLAUDE.md` is the authority; this is a copy of it, pinned here because the",
        "> failure RULING 88 fixes is a session not knowing there was anything to look up.",
        "> `tests/context-pinned-conduct.test.ts` fails the build if the two diverge.",
        "",
        conduct.body,
        "",
        "*(Pinned verbatim from `CLAUDE.md` by `scripts/context-file.mjs`. Every other",
        "section of this file is an index; this one is the text, because the failure it",
        "fixes is a session not knowing there was anything to look up.)*",
        "",
        "---",
        "",
      );
    }

    const rulings = readRulings();
    put(
      `## Rulings — ${rulings.headings.length} recorded`,
      "",
      "Source: `docs/rulings.md`, append-only. **This is an index, not the text.**",
      "`CLAUDE.md` is law; these are the author's calls that are not, and a session",
      "told to hardcode a ruling as fact reads the file rather than the chat it came",
      "from. Each entry there names what it supersedes.",
      "",
    );
    if (rulings.failure) {
      put(
        `> **SECTION FAILED — the rulings index could not be built.** ${rulings.failure}`,
        "",
        "> This is a failure of this generator, not a statement that no ruling exists.",
        "",
      );
    } else {
      for (const h of rulings.headings) put(`- ${h}`);
      put("");
    }

    put(
      `## P0 tracker rows — ${p0.length} of ${records.length} rows`,
      "",
      `Source: \`docs/tracker.csv\`, every row with Priority \`P0\`. Notes clipped to ${noteChars} characters.`,
      "",
      "| ID | Item | Status | Note |",
      "|---|---|---|---|",
    );
    for (const row of p0) {
      put(
        `| ${cell(row.id)} | ${cell(oneLine(row.item, ITEM_CHARS))} | ${cell(row.status)} | ${cell(oneLine(row.notes, noteChars)) || "—"} |`,
      );
    }
    put("");

    /* ripcords */
    if (Array.isArray(ripcords)) {
      put(
        `## Ripcords — ${ripcords.length}`,
        "",
        "Source: `lib/ripcords.ts`, the state of record. State below is the **committed**",
        "position; each flag can be flipped without a deploy via its environment variable",
        "(`pulled` / `live`). Pull procedures: `docs/ripcords.md`.",
        "",
      );
      for (const r of ripcords) {
        put(
          `**\`${r.name}\`** — **${r.state}** · env \`${r.envVar}\` · rows ${r.trackerRows}`,
          "",
          `- Open question: ${r.question}`,
          `- Closer: ${r.closer}`,
          "",
        );
      }
    } else {
      put("## Ripcords", "", `_Could not read \`lib/ripcords.ts\`: ${ripcords.error}_`, "");
    }

    /* status changes */
    const shown = history.changes.slice(0, changeLimit);
    put(
      `## Last ${shown.length} tracker status change(s), most recent first`,
      "",
      `Source: git history of \`docs/tracker.csv\` (first-parent), ${history.scannedCommits} commit(s) walked` +
        `${history.availableCommits ? ` of ${history.availableCommits} available` : ""}. ` +
        `${history.newRows} row(s) first appeared in those commits and are not listed — ` +
        `a new row has no status to have changed.`,
      "",
    );
    if (cutNote) put(cutNote, "");
    if (shown.length === 0) {
      /*
       * ITEM 8c: "no status change recovered" and "ten status changes were
       * recovered and then dropped to fit the cap" are different facts, and
       * this line used to render both. The g6 handoff printed exactly that:
       * the section said nothing had been recovered while the truncation
       * summary said 10 of 10 rows had been dropped. Two statements, same
       * file, opposite meanings.
       *
       * RULING 106 (2026-08-23) removed the cascade that could drop them, so
       * this branch is now only reachable when nothing WAS recovered — but the
       * distinction stays, because a branch that can only be right today is a
       * branch that goes wrong the moment anything changes.
       */
      if (history.changes.length > 0) {
        put(
          `> **${history.changes.length} recovered status change(s) are missing from this section.**`,
          "",
          "> They were found and they are not shown, and since RULING 106 removed the",
          "> shrink cascade nothing here drops them — so this is a defect rather than a",
          "> trade. Do not read it as a quiet period in the tracker.",
          "",
        );
      } else {
        put("_No status change recovered in the commits walked._", "");
      }
    } else {
      put("| Date | ID | From → To | Commit |", "|---|---|---|---|");
      for (const c of shown) {
        put(
          `| ${c.date} | ${cell(c.id)} | ${cell(c.from)} → ${cell(c.to)} | \`${c.sha.slice(0, 7)}\` ${cell(oneLine(c.subject, 54))} |`,
        );
      }
      put("");
    }

    /* git */
    put("## Git", "", "Source: the same facts `git-state.txt` carries, generated in the same run.", "");
    if (gitFacts.length === 0) put("_No git facts available this run._", "");
    else {
      /*
       * The same two-clock collision, one section down: `git-state.txt` carries
       * its own Eastern `generated:` line and it lands here verbatim. Annotated
       * on the same condition and from the same values.
       */
      put("\`\`\`");
      put(
        ...gitFacts.map((line) =>
          /^generated:/.test(line) && line.slice(11, 21) > stampToday
            ? `${line}   <!-- expected-future: Eastern run stamp (R18) past midnight; Phoenix session day is ${stampToday} -->`
            : line,
        ),
      );
      put("\`\`\`");
    }
    put("");

    return out.join("\n");
  };

  /*
   * **THE SHRINK CASCADE IS GONE** (RULING 106, 2026-08-23).
   *
   * What stood here: drop the tracker-change section a row at a time until the
   * file fit, then walk the P0 note length down from 130 characters in steps
   * of 20, then — if that bottomed out — say so. It announced every cut, which
   * is better than a silent clip and is still a generated file that knows more
   * than it says while reading as complete.
   *
   * Every section renders at full length now. `cap` survives as a parameter so
   * a caller can still ASK how big the file is against a number, and nothing
   * in the repo passes one.
   *
   * The pinned Discovery-conduct block was already exempt from the cascade,
   * for the reason that made the whole cascade wrong: a pinned block that
   * could be shortened "just this once" is a pointer wearing a longer coat.
   * The same is now true of every other section.
   */
  const text = render(history.changes.length, NOTE_CHARS, null);
  const bytes = Buffer.byteLength(text);

  /*
   * Reported, never acted on. A caller that wants to know the file is unusually
   * large gets the number and the comparison; nothing here trims to meet it.
   * `Infinity` is the standing value, so this is normally empty.
   */
  const truncation =
    Number.isFinite(cap) && bytes > cap
      ? [
          `OVER THE STATED SIZE: ${bytes} bytes against ${cap} — reported, and ` +
            "NOTHING was dropped. RULING 106: where a generated file grows, the " +
            "response is to remove duplication in the source, never to clip the output.",
        ]
      : [];

  return {
    text,
    bytes,
    truncated: false,
    truncation,
    counts: {
      phases: phases.rows.length,
      p0: p0.length,
      trackerRows: records.length,
      ripcords: Array.isArray(ripcords) ? ripcords.length : 0,
      statusChanges: history.changes.length,
      gitFacts: gitFacts.length,
    },
  };
}

/**
 * Where the REPO copy lives. Repo-relative.
 *
 * **RULING 108 — anything a session must read at session start lives in the
 * repo.** (Adopted 2026-08-23.) This file is the orientation document every
 * session opens on, and until today it was written to the Drive mirror ONLY.
 * A session has a shell and a clone; it has no way into Drive. So the file
 * every session was told to read first was, by construction, unreadable by any
 * of them — and the work of uncapping it, restoring its tracker-change section
 * to ten of ten rows and restoring P0 notes to full length all landed somewhere
 * no session could see.
 *
 * That is the second time in two sessions an orientation input lived only in
 * Drive; the 8/22 visual captures were the first, and RULING 104 was adopted
 * over them.
 */
export const CONTEXT_REPO_PATH = "docs/context.md";

/**
 * Write it — **the repo copy first, the mirror second.**
 *
 * The order is the ruling. The repo write is the one that must not fail, and
 * it happens before the mirror is touched so an unreachable Drive cannot cost
 * a session its orientation file. A mirror failure is REPORTED on the return
 * value rather than thrown: Drive is a convenience for the author, and losing
 * a convenience may not take the primary output down with it.
 *
 * Returns what was written, for the checklist.
 */
export async function writeContext(mirrorDir, options) {
  const built = await buildContext(options);

  /*
   * **`mirrorOnly` — THE POST-SHIP REWRITE, AND WHY IT SKIPS THE REPO.**
   * (2026-08-25, Item 16.)
   *
   * `handoff` regenerates this file AFTER the merge, so it can carry the git
   * facts the merge produced. That write landed in the working tree, so every
   * session in this repo's history ENDED WITH A DIRTY TREE — and the next
   * branch switch ambushed Sean with an uncommitted-changes dialog. He has
   * hand-cleared that jam three times.
   *
   * The repo copy is still PRIMARY and is still written first (RULING 108) —
   * it is written BEFORE the ship, so it travels inside the pull request and a
   * session can always read it from a clone. What the post-ship pass updates
   * is the MIRROR, which is untracked and is where the author reads it.
   *
   * What this costs, stated rather than hidden: the committed copy does not
   * name the merge SHA. That is the same regress the merge-cadence rule
   * already documents — a document cannot name the commit that contains it —
   * and chasing it is what would merge forever.
   */
  if (!options?.mirrorOnly) {
    // PRIMARY — the repo copy. Written first, and never guarded by a
    // try/catch: if this fails the run has not produced the thing it exists
    // to produce.
    writeFileSync(join(ROOT, CONTEXT_REPO_PATH), built.text, "utf8");
  }

  // SECOND — the author's mirror. Best-effort by design.
  let mirrored = false;
  let mirrorError = null;
  if (mirrorDir) {
    try {
      writeFileSync(join(mirrorDir, "context.md"), built.text, "utf8");
      mirrored = true;
    } catch (err) {
      mirrorError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ...built, repoPath: CONTEXT_REPO_PATH, mirrored, mirrorError };
}
