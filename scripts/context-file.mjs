/**
 * `context.md` — the seventh mirror file, generated at handoff.
 *
 * `state.md` is 249 KB and growing, and it is the wrong artifact to hand a
 * conversation that only needs to know where things stand: by the time it has
 * been pasted anywhere useful there is no room left for the actual question.
 * This is the short answer to "what is the current state of this project" —
 * dense, flat, and under 20 KB by construction.
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

/** The hard cap the author set. Bytes, not characters. */
export const CAP_BYTES = 20 * 1024;

/** How much of a tracker Note survives into a one-line cell. */
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
  const start = stateText.indexOf("### Where the phases stand");
  if (start === -1) return { rows: [], source: "docs/state.md — section not found" };

  const rest = stateText.slice(start);
  const end = rest.indexOf("\n## ");
  const block = end === -1 ? rest : rest.slice(0, end);

  const rows = [];
  // Bullets wrap across lines; join each bullet back into one string first.
  const bullets = block.split(/\n(?=- )/).filter((b) => b.startsWith("- "));
  for (const bullet of bullets) {
    const flat = bullet.replace(/^- /, "").replace(/\s+/g, " ").trim();
    const bold = flat.match(/^\*\*(.+?)\*\*/);
    const phase = bold ? bold[1] : flat.split(" — ")[0];
    const status = (bold ? flat.slice(bold[0].length) : flat.slice(phase.length))
      .replace(/^[\s—-]+/, "")
      .trim();
    rows.push({ phase: oneLine(phase, 46), status: oneLine(status, 150) });
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
  const history = readStatusChanges(10);

  const render = (changeLimit, noteChars, cutNote) => {
    const out = [];
    const put = (...lines) => out.push(...lines);

    put(
      "# we-the-people — current context",
      "",
      "**GENERATED FILE — do not edit, and do not copy it back into the repo.**",
      `Written by \`pnpm handoff\` (\`scripts/context-file.mjs\`) at ${generatedAt}.`,
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
      put("_No phase standings found in state.md — the section heading moved._", "");
    } else {
      put("| Phase | Status |", "|---|---|");
      for (const row of phases.rows) put(`| ${cell(row.phase)} | ${cell(row.status)} |`);
      put("");
    }

    /* P0 */
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
      put("_No status change recovered in the commits walked._", "");
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
      put("```");
      put(...gitFacts);
      put("```");
    }
    put("");

    return out.join("\n");
  };

  const capLabel = `${Math.round(cap / 1024)} KB cap`;
  const cutNoteFor = (limit) =>
    limit < history.changes.length
      ? `> **Truncated to fit the ${capLabel}:** ${history.changes.length - limit} of ` +
        `${history.changes.length} recovered status change(s) dropped from this section.`
      : null;

  // Full size first; shrink only if it does not fit.
  let text = render(history.changes.length, NOTE_CHARS, null);
  const truncation = [];

  if (Buffer.byteLength(text) > cap) {
    // 1. The tracker-change section, as the author specified.
    let limit = history.changes.length;
    while (limit > 0 && Buffer.byteLength(text) > cap) {
      limit--;
      text = render(limit, NOTE_CHARS, cutNoteFor(limit));
    }
    if (limit < history.changes.length) {
      truncation.push(
        `tracker-change section: ${history.changes.length - limit} of ${history.changes.length} rows dropped`,
      );
    }

    // 2. Only if that was not enough. Said out loud in the P0 section header,
    //    which already states the clip length.
    let notes = NOTE_CHARS;
    while (notes > 40 && Buffer.byteLength(text) > cap) {
      notes -= 20;
      text = render(limit, notes, cutNoteFor(limit));
    }
    if (notes < NOTE_CHARS) {
      truncation.push(`P0 notes clipped from ${NOTE_CHARS} to ${notes} characters`);
    }

    // The floor. With 70 P0 rows this cannot be reached at 20 KB, but a file
    // that is over the cap must SAY it is over the cap — a silent overrun is
    // the same defect as a silent truncation, pointing the other way.
    if (Buffer.byteLength(text) > cap) {
      truncation.push(
        `STILL OVER: ${Buffer.byteLength(text)} bytes against a ${cap}-byte cap — ` +
          `the shrink cascade bottomed out and nothing further was dropped`,
      );
    }
  }

  if (truncation.length > 0) {
    text = text.replace(
      "---\n",
      `**Truncated to fit the ${capLabel}:** ${truncation.join("; ")}.\n\n---\n`,
    );
  }

  return {
    text,
    bytes: Buffer.byteLength(text),
    truncated: truncation.length > 0,
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

/** Write it into the mirror. Returns what was written, for the checklist. */
export async function writeContext(mirrorDir, options) {
  const built = await buildContext(options);
  writeFileSync(join(mirrorDir, "context.md"), built.text, "utf8");
  return built;
}
