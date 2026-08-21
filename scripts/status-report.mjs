/**
 * `pnpm status:report` — write `docs/status.md` from `docs/tracker.csv`
 * (Prompt C item 11.4, 2026-08-20).
 *
 * ## Why it is generated
 *
 * A hand-maintained status page is a second tracker that disagrees with the
 * first. This repo has already paid for that shape twice — a coverage number
 * that counted our own registry, and a mirror set assembled in prose that came
 * out different every time it was written. So nothing here is composed: every
 * count is read out of the tracker in one pass, and the section a row lands in
 * is computed, never assigned.
 *
 * ## Sections come from the dependency graph; names come from the outcome
 *
 * A section is a set of rows where nothing inside it depends on anything in a
 * LATER section. That is a topological layering — layer 0 is everything that
 * depends on nothing, layer N is everything whose deepest dependency sits in
 * layer N-1. Forward, never sideways. The ORDER is therefore not a judgement
 * call and cannot be argued with.
 *
 * The NAMES are the judgement call, and they answer "what does Sean get when
 * this section closes" rather than "what kind of work is in it". `SECTION_NAMES`
 * below is committed rather than derived, because no arrangement of tracker
 * columns knows what a reader gets.
 *
 * **AND LAYER 0 IS HONESTLY NOT AN OUTCOME.** It holds 54% of the tracker,
 * because most rows declare no dependency at all — the `Depends on` column is
 * sparse, so the graph cannot separate work that genuinely has no prerequisite
 * from work whose prerequisite was never written down. Naming it as though it
 * were one deliverable would be a label that lies, and this file says so in
 * place rather than quietly picking a name. `R56` carries that for the author.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";

/**
 * RFC 4180, returning plain strings.
 *
 * `parseCsv` in `doc-dates.mjs` returns `{ value, line }` per cell — it has to,
 * because the date gate reports the LINE a bad stamp sits on. This wants
 * strings, and wrapping the other one would mean two shapes of "a row" in one
 * file. Twelve lines is cheaper than that ambiguity.
 */
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACKER = join(ROOT, "docs", "tracker.csv");
const OUT = join(ROOT, "docs", "status.md");

/**
 * What Sean gets when each section closes. Committed, not derived.
 *
 * Keyed by dependency layer. A layer with no entry renders as UNNAMED and says
 * so — an unnamed section is a real state (the graph grew a layer nobody has
 * described yet) and it must not render as a nameless number pretending to be
 * a heading.
 */
const SECTION_NAMES = {
  0: {
    name: "Everything with no recorded prerequisite",
    outcome:
      "NOT A DELIVERABLE, and named honestly rather than dressed as one. This " +
      "is every row whose `Depends on` column is empty, which is most of the " +
      "tracker — the column is sparse, so the graph cannot tell work that " +
      "genuinely has no prerequisite from work whose prerequisite was never " +
      "written down. See `R56`.",
  },
  1: {
    name: "The four pilot zips answer completely",
    outcome:
      "A reader at 03255, 07866, 85641 or 85701 gets every body, every " +
      "officeholder and every contest that place actually has — the depth " +
      "sweeps, the blurb equalization, the state voting records and the " +
      "funding surface all sit here.",
  },
  2: {
    name: "The bodies inside a government are known, not just the government",
    outcome:
      "Tier 1 becomes Tier 2: enumeration per unit, the re-walk of every " +
      "record written before the ladder existed, and the candidate sweep to " +
      "Kelly depth. This is the step Census and NCES can never take for us.",
  },
  3: {
    name: "The hard territory resolves and the extractors exist",
    outcome:
      "Special districts get territory, embedded-JSON pages give up their " +
      "content, and the ask box answers the questions a reader actually " +
      "arrives with.",
  },
  4: {
    name: "The vendor layer is understood rather than guessed at",
    outcome:
      "Vanity domains resolve to their tenants, the vendor review closes, and " +
      "a new place's platform is identified rather than inferred.",
  },
  5: {
    name: "The map's last dependent polish",
    outcome: "Rendering work that waited on everything above it.",
  },
  6: {
    name: "The deepest dependents",
    outcome: "The tail of the graph — nothing depends on these.",
  },
};

const CLOSED = new Set(["Done", "Absorbed"]);
const BLOCKED = new Set(["Blocked on the author", "Tabled", "Parked", "Waiting on testing end"]);

const rows = parseRows(readFileSync(TRACKER, "utf8"));
const header = rows[0];
const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
const col = (n) => header.indexOf(n);
const ID = col("ID");
const AREA = col("Area");
const ITEM = col("Item");
const PRIORITY = col("Priority");
const STATUS = col("Status");
const DEPENDS = col("Depends on");

if (body.length === 0) {
  console.error("REFUSED: the tracker parsed to zero rows. A zero-row status page is a failed read.");
  process.exit(1);
}

/* ---- the layering, computed exactly as scripts/promptb-tracker.mts does --- */

const ids = new Set(body.map((r) => r[ID]));
const depsOf = (r) =>
  (r[DEPENDS] ?? "")
    .split(/[,;]\s*/)
    .map((d) => d.trim())
    .filter((d) => d && ids.has(d));

const layer = new Map();
for (let pass = 0; pass < 50; pass += 1) {
  let moved = 0;
  for (const r of body) {
    const d = depsOf(r);
    const want = d.length ? Math.max(...d.map((x) => (layer.get(x) ?? 0) + 1)) : 0;
    if ((layer.get(r[ID]) ?? 0) !== want) {
      layer.set(r[ID], want);
      moved += 1;
    }
  }
  if (moved === 0) break;
}

const forward = [];
for (const r of body) {
  const mine = layer.get(r[ID]) ?? 0;
  for (const d of depsOf(r)) {
    if ((layer.get(d) ?? 0) >= mine) forward.push(`${r[ID]} depends on ${d}`);
  }
}
const dangling = [];
for (const r of body) {
  for (const d of (r[DEPENDS] ?? "").split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean)) {
    if (!ids.has(d)) dangling.push(`${r[ID]} -> ${d}`);
  }
}

const bySection = new Map();
for (const r of body) {
  const l = layer.get(r[ID]) ?? 0;
  if (!bySection.has(l)) bySection.set(l, []);
  bySection.get(l).push(r);
}

/* ---- render ---------------------------------------------------------------- */

const out = [];
const put = (...lines) => out.push(...lines);

const done = body.filter((r) => CLOSED.has(r[STATUS])).length;
const blocked = body.filter((r) => BLOCKED.has(r[STATUS])).length;
const open = body.length - done;
/*
 * **P0, STATED AS A PAIR** (Prompt D item 4, 2026-08-20).
 *
 * This file used to print one number — P0 across EVERY row, done ones
 * included — under a heading about the whole tracker, and it read as "100 of
 * the 137 open rows are top priority". It was never that. Of the 100, 17 were
 * open; the other 83 were P0 rows that had already shipped, and a priority on
 * a closed row is history rather than a queue.
 *
 * A single figure standing in front of two measurements is the D68 pattern,
 * and it is the reason a re-prioritisation got scheduled against a premise the
 * file itself had manufactured. Both numbers print now, and which one is the
 * standing figure is stated: the OPEN count is the queue.
 */
const p0 = body.filter((r) => r[PRIORITY] === "P0").length;
const p0Open = body.filter((r) => !CLOSED.has(r[STATUS]) && r[PRIORITY] === "P0").length;
const areas = new Set(body.map((r) => r[AREA].trim()));

put(
  "# Status — what each section delivers, and how far it is",
  "",
  "**GENERATED FILE — do not hand-edit.** Written by `pnpm status:report`",
  "(`scripts/status-report.mjs`) from `docs/tracker.csv`, in one pass.",
  `Generated ${today()} (America/Phoenix, from \`pnpm stamp\`).`,
  "",
  "A hand-maintained status page is a second tracker that disagrees with the",
  "first, so nothing here is composed: every count is read, and the section a",
  "row lands in is computed from the dependency graph rather than assigned.",
  "",
  "**Sections come from dependencies; names come from what you get.** A section",
  "is a set of rows where nothing inside it depends on anything in a later",
  "section. The order is therefore not a judgement call. The names are, and they",
  "answer *what does this deliver* rather than *what kind of work is it*.",
  "",
  "---",
  "",
  "## The whole tracker",
  "",
  `- **${body.length} rows** · **${done} done** · **${open} open** · **${blocked} of the open ones blocked or parked**`,
  `- **${p0Open} OPEN P0** — the queue — of **${p0} P0 across all rows** (the rest have shipped)`,
  `- **${bySection.size} sections** · **${areas.size} distinct Areas**`,
  "",
  "**P0 means: blocks a reader-visible outcome before 2026-11-03.** <!-- expected-future: US general polling day, the deadline this priority is defined against -->",
  "(Adopted 2026-08-20, Prompt D item 4.) A row is P0 when a reader meets its",
  "output on a surface, that surface is wrong, missing or unreachable until the",
  "row closes, and it can land before polling day. Everything else is not P0",
  "regardless of prior marking — real work, and no reader is blocked on it.",
  "A priority field that marks three-quarters of a queue top priority sorts",
  "nothing, which is what this definition exists to prevent.",
  "",
);

put(
  forward.length === 0
    ? "**No row depends on anything in a later section.** The file reads front to back."
    : `**${forward.length} ROW(S) DEPEND ON A LATER SECTION** — named, not hidden: ${forward.join("; ")}`,
  "",
  dangling.length === 0
    ? "**No dangling dependency** — every `Depends on` points at a row that exists."
    : `**${dangling.length} DANGLING DEPENDENCY(S)** — pointing at an id that does not exist: ${dangling.join("; ")}`,
  "",
  "---",
  "",
);

for (const [l, rs] of [...bySection.entries()].sort((a, b) => a[0] - b[0])) {
  const named = SECTION_NAMES[l];
  const d = rs.filter((r) => CLOSED.has(r[STATUS])).length;
  const b = rs.filter((r) => BLOCKED.has(r[STATUS])).length;
  const o = rs.length - d;

  put(
    named
      ? `## Section ${l} — ${named.name}`
      : `## Section ${l} — UNNAMED`,
    "",
  );
  if (named) {
    put(`**What you get:** ${named.outcome}`, "");
  } else {
    put(
      "> **This section has no name.** The dependency graph grew a layer nobody",
      "> has described yet. That is a real state and it renders as one — a",
      "> nameless number is not a heading. Add it to `SECTION_NAMES` in",
      "> `scripts/status-report.mjs`.",
      "",
    );
  }
  put(
    `**${rs.length} rows** · **${d} done** · **${o} open** · **${b} blocked or parked**`,
    "",
  );

  const openP0 = rs.filter((r) => !CLOSED.has(r[STATUS]) && r[PRIORITY] === "P0");
  if (openP0.length > 0) {
    put(`**Open P0 in this section (${openP0.length}):**`, "");
    for (const r of openP0.sort((x, y) => x[ID].localeCompare(y[ID]))) {
      put(`- \`${r[ID]}\` — ${r[ITEM]} *(${r[STATUS]})*`);
    }
    put("");
  } else {
    put("_No open P0 in this section._", "");
  }
}

writeFileSync(OUT, `${out.join("\n")}\n`, "utf8");

// RE-READ, because a generator that generated nothing exits 0.
const back = readFileSync(OUT, "utf8");
console.log(`WROTE docs/status.md — ${Buffer.byteLength(back, "utf8")} bytes`);
console.log(
  `  ${body.length} rows · ${done} done · ${open} open · ${p0} P0 · ` +
    `${bySection.size} sections · ${areas.size} areas`,
);
for (const [l, rs] of [...bySection.entries()].sort((a, b) => a[0] - b[0])) {
  const d = rs.filter((r) => CLOSED.has(r[STATUS])).length;
  console.log(
    `  section ${l}: ${String(rs.length).padStart(4)} rows, ${d} done, ${rs.length - d} open` +
      `${SECTION_NAMES[l] ? "" : "   *** UNNAMED ***"}`,
  );
}
if (Buffer.byteLength(back, "utf8") < 500) {
  console.error("REFUSED: the written file is too small to be a status page.");
  process.exit(1);
}
