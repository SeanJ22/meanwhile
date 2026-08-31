/**
 * **THE STATUS LEDGER GENERATOR — now generated from RUN RECORDS.**
 * (2026-08-30, the status-generation ruling; rebuilt by A.1 WI6.)
 *
 * ```
 * pnpm status:ledger          # write docs/status-ledger.md
 * pnpm status:ledger --check  # verify freshness; writes NOTHING
 * ```
 *
 * ## What changed, and why the old shape could not be repaired in place
 *
 * The DATA used to be `STATUS_ENTRIES` — one array holding both the claim and
 * a hand-typed result: `lastResult: "suite green in the workstream run that
 * generated this ledger"`, `proofClass`, `asOf`, and a `sha` that was usually
 * `"—"`. This script rendered them. `--check` byte-compared the Markdown
 * against that array, which proves the document equals its own source and
 * says nothing whatever about whether any named check currently passes.
 *
 * The committed ledger said HEAD `e62c420` while the release was `096e0469`,
 * and every gate was green, because nothing in the loop ever asked an
 * instrument anything.
 *
 * Now:
 *
 * ```
 *   lib/ops/capability-registry.ts   CURATED: claim -> the check that proves it
 *   lib/ops/status-result.ts         DERIVED: what that check's run record says
 *   docs/status-ledger.md            RENDERED from the second
 * ```
 *
 * **No typed PASS or green string anywhere can produce a current GREEN.** The
 * registry has no field to write one in. A capability whose check has no run
 * record renders UNPROVEN; one whose record measured a tree the release does
 * not contain renders STALE.
 *
 * ## The HEAD equality rule
 *
 * `--check` is red when the ledger's recorded HEAD is not the generating HEAD.
 * A ledger stamped with an older commit is a status surface describing a tree
 * that is not this one, and that is the exact defect the committed `e62c420`
 * stamp was.
 *
 * ## Impurity, stated
 *
 * This generator is IMPURE and registered as such: it reads the wall clock and
 * `git rev-parse HEAD`. It also now reads RUN RECORDS, which move — so the
 * carried-stamp trick that kept it idempotent still applies to the BODY, and
 * a body that changes because a check actually ran again earns a fresh stamp.
 * That is correct: the result changed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITY_REGISTRY } from "../lib/ops/capability-registry.ts";
import { containsCommit, headSha } from "../lib/ops/git-facts.ts";
import { loadRunRecords, resolveAll, type StatusResult } from "../lib/ops/status-result.ts";
import { today } from "./doc-dates.mjs";
import { generatedAtEastern } from "./generated-at.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "status-ledger.md");

/*
 * Split so this SCRIPT's own head never matches the artifact-declaration
 * sweep in tests/generated-artifacts.test.ts — the phrase belongs in the
 * ARTIFACT, which is registered; a script carrying it contiguously in its
 * first 1200 bytes would read as an unregistered generated file.
 */
const GENERATED_HEADER =
  ["**GENERATED", "by `pnpm status:ledger`. Never hand-edit (RULING 92).**"].join(" ");

/** Everything above this line is the stamp block; the body below is compared. */
const STAMP_END =
  "<!-- stamp-end: the stamp above is carried verbatim when the body below is byte-identical; only a changed body earns a fresh stamp (scripts/status-ledger.mts) -->";

/** A table cell that cannot break the table, whatever the prose does. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}

const DATE_RE = /20\d\d-\d\d-\d\d/g;

/**
 * Mechanically annotate any FUTURE date on a rendered line. Same-line, per
 * `scripts/doc-dates.mjs` — an annotation anywhere else excuses nothing.
 */
function annotateFutureDates(line: string, todayStr: string): string {
  if (line.includes("expected-future:")) return line;
  DATE_RE.lastIndex = 0;
  const future = [...line.matchAll(DATE_RE)].some((m) => m[0] > todayStr);
  if (!future) return line;
  return (
    line +
    " <!-- expected-future: a future date rendered from this row's own source data " +
    "(an election date, deferral horizon or similar), annotated mechanically by the generator -->"
  );
}

/* The two git facts, through the shared helper (RULING 103). Both refuse in
   the safe direction: no SHA is invented, and unanswerable ancestry is false. */
const HEAD = headSha(ROOT);

function resolved(): StatusResult[] {
  return resolveAll(loadRunRecords(ROOT), HEAD, (a, d) => containsCommit(a, d, ROOT));
}

function shortSha(sha: string | null): string {
  return sha ? `\`${sha.slice(0, 12)}\`` : "—";
}

function renderBody(todayStr: string, results: StatusResult[]): string {
  /*
   * The denominator floor (RULING 159): an empty registry would render a
   * ledger claiming the project asserts nothing, which is a false zero, not a
   * measurement. The population must be earned.
   */
  if (CAPABILITY_REGISTRY.length === 0) {
    throw new Error(
      "CAPABILITY_REGISTRY in lib/ops/capability-registry.ts is empty — refusing to render a " +
        "status ledger that would report zero capability rows as though it had looked (RULING 159)",
    );
  }

  const out: string[] = [];
  const byState = (state: StatusResult["state"]) => results.filter((r) => r.state === state);
  const proven = byState("PROVEN");
  const failing = byState("FAILING");
  const stale = byState("STALE");
  const unproven = byState("UNPROVEN");

  out.push("## What this is");
  out.push("");
  out.push(
    "One row per capability the project currently asserts. The claim and the check that " +
      "proves it are CURATED in `lib/ops/capability-registry.ts`. The result beside it is " +
      "DERIVED, by `lib/ops/status-result.ts`, from a run record an instrument actually " +
      "wrote — a gate run, a walk run, a reader-suite run, or the post-deploy observer.",
  );
  out.push("");
  out.push(
    "**No typed string anywhere can produce a green row.** The registry has no field to " +
      "write a result into. A capability whose check has no run record renders UNPROVEN; one " +
      "whose newest record measured a tree this release does not contain renders STALE. Both " +
      "are facts about our instrumentation, never verdicts on the capability, and neither is " +
      "softened here.",
  );
  out.push("");
  out.push("The four states:");
  out.push("");
  out.push("- `PROVEN` — a current run record says the named check passed.");
  out.push("- `FAILING` — a current run record says the named check did not pass.");
  out.push(
    "- `STALE` — a record exists but measured a tree the release does not contain, or names " +
      "no tested SHA at all.",
  );
  out.push("- `UNPROVEN` — no run record names this check, or no check is named.");
  out.push("");
  out.push(
    "`proofClass` is DERIVED too. A canonical suite or walk execution against a committed " +
      "head is `INDEPENDENTLY_REPRODUCED` — reproduction by an instrument rather than by the " +
      "implementing session's own one-off observation. Nothing else earns a proof class.",
  );
  out.push("");
  out.push(
    `**${results.length} capability row(s) stated — ${proven.length} PROVEN, ` +
      `${failing.length} FAILING, ${stale.length} STALE, ${unproven.length} UNPROVEN. The ` +
      `tables below render exactly ${results.length} row(s) in total.**`,
  );
  out.push("");

  function table(title: string, rows: StatusResult[], note?: string): void {
    out.push(`## ${title} — ${rows.length} row(s)`);
    out.push("");
    if (note) {
      out.push(note);
      out.push("");
    }
    if (rows.length === 0) {
      out.push("_None._");
      out.push("");
      return;
    }
    out.push(
      "| capability | check | what the record says | proof class | target | run | ran at | SHA |",
    );
    out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const check =
        r.entry.provenBy === null
          ? cell(r.entry.neededCheck ?? "(none stated — a defect in this registry)")
          : cell(JSON.stringify(r.entry.provenBy));
      out.push(
        `| ${cell(r.entry.capability)} | ${check} | ${cell(r.detail)} | ` +
          `${r.proofClass ?? "—"} | ${r.entry.target ?? "—"} | ${cell(r.runId ?? "—")} | ` +
          `${cell(r.ranAt ?? "—")} | ${shortSha(r.testedSha)} |`,
      );
    }
    out.push("");
    out.push("Evidence, per row (committed locations only):");
    out.push("");
    for (const r of rows) {
      out.push(`- ${cell(r.entry.capability).slice(0, 96)}… → ${cell(r.entry.evidence)}`);
    }
    out.push("");
  }

  table("PROVEN", proven);
  table(
    "FAILING",
    failing,
    "A named check ran and did not pass. This is a claim the project is currently making " +
      "that its own instrument contradicts.",
  );
  table(
    "STALE",
    stale,
    "A record exists and cannot be read as describing this tree. An old green is evidence " +
      "about an old day; a green on another tree is evidence about other code.",
  );
  table(
    "UNPROVEN",
    unproven,
    "UNPROVEN means no run record proves this claim. It is a fact about the project's " +
      "instrumentation, never a verdict on the capability.",
  );

  out.push("## Where the rows came from");
  out.push("");
  out.push(
    "The hand-written current-status surfaces retired on 2026-08-30: docs/state.md §2, §3 " +
      "and §7 (each carries a retirement note pointing here; the prior text is in git " +
      "history) and README.md's capability prose. On 2026-08-30 the single " +
      "`lib/ops/status-ledger.ts` array was split into the curated registry and the derived " +
      "result (A.1 WI6), retiring its hand-typed `lastResult`, `proofClass`, `asOf` and " +
      "`sha` fields. Edit the registry, run the checks, then run `pnpm status:ledger`.",
  );
  out.push("");

  return `${out.map((l) => annotateFutureDates(l, todayStr)).join("\n")}\n`;
}

/** The full document, with the carried-stamp rule applied. */
function renderDocument(results: StatusResult[]): { next: string; carried: boolean } {
  const body = renderBody(today(), results);
  if (existsSync(DOC)) {
    const committed = readFileSync(DOC, "utf8");
    const at = committed.indexOf(STAMP_END);
    if (at >= 0) {
      const committedBody = committed.slice(at + STAMP_END.length).replace(/^\r?\n\r?\n/, "");
      if (committedBody === body) return { next: committed, carried: true };
    }
  }
  const head = [
    "# Status ledger",
    "",
    GENERATED_HEADER,
    "",
    `Generated ${generatedAtEastern()} by \`pnpm status:ledger\`. HEAD \`${HEAD ?? "unknown"}\`.`,
    "",
    STAMP_END,
    "",
    "",
  ].join("\n");
  return { next: `${head}${body}`, carried: false };
}

/**
 * The ledger's own recorded HEAD, read back out of the stamp.
 *
 * A ledger stamped with a commit that is not the generating HEAD describes a
 * tree that is not this one. That is not a formatting difference and it is not
 * repaired by carrying the stamp — it is the defect the committed `e62c420`
 * stamp WAS, and `--check` goes red on it.
 */
function recordedHead(document: string): string | null {
  return document.match(/HEAD `([0-9a-f]{7,40})`/)?.[1] ?? null;
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("status-ledger.mts");
if (invoked) {
  const results = resolved();
  const { next, carried } = renderDocument(results);
  const committed = existsSync(DOC) ? readFileSync(DOC, "utf8") : null;
  const counts = (rs: StatusResult[]) =>
    `${rs.filter((r) => r.state === "PROVEN").length} PROVEN, ` +
    `${rs.filter((r) => r.state === "FAILING").length} FAILING, ` +
    `${rs.filter((r) => r.state === "STALE").length} STALE, ` +
    `${rs.filter((r) => r.state === "UNPROVEN").length} UNPROVEN`;

  if (process.argv.includes("--check")) {
    // --check NEVER writes. Stale is reported and left stale.
    const stampedHead = committed === null ? null : recordedHead(committed);
    if (committed !== null && HEAD !== null && stampedHead !== null && stampedHead !== HEAD) {
      console.error(
        `docs/status-ledger.md records HEAD ${stampedHead.slice(0, 12)} and the generating ` +
          `HEAD is ${HEAD.slice(0, 12)}. A status surface stamped with a different commit ` +
          "describes a tree that is not this one. Run: pnpm status:ledger",
      );
      process.exit(1);
    }
    if (committed === next) {
      console.log(
        `docs/status-ledger.md is current — ${results.length} row(s) (${counts(results)}), ` +
          `stamp ${carried ? "carried" : "fresh"}`,
      );
    } else {
      const a = (committed ?? "").split("\n");
      const b = next.split("\n");
      let firstDiff = 0;
      while (firstDiff < Math.min(a.length, b.length) && a[firstDiff] === b[firstDiff]) firstDiff++;
      console.error(
        committed === null
          ? "docs/status-ledger.md does not exist. Run: pnpm status:ledger"
          : `docs/status-ledger.md is STALE against the capability registry and the run ` +
            `records — committed ${a.length} line(s), regenerated ${b.length} line(s), first ` +
            `difference at line ${firstDiff + 1}. Run: pnpm status:ledger (--check repairs nothing)`,
      );
      process.exit(1);
    }
  } else if (committed === next) {
    console.log(`docs/status-ledger.md unchanged — ${results.length} row(s), stamp carried`);
  } else {
    writeFileSync(DOC, next, "utf8");
    console.log(
      `docs/status-ledger.md written — ${results.length} row(s): ${counts(results)}, ` +
        `stamp ${carried ? "carried" : "fresh"}`,
    );
  }
}
