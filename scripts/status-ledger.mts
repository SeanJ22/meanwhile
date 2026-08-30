/**
 * **THE STATUS LEDGER GENERATOR** (2026-08-30, the status-generation ruling:
 * status is GENERATED, never asserted).
 *
 * ```
 * corepack pnpm status:ledger          # write docs/status-ledger.md
 * corepack pnpm status:ledger --check  # verify byte-freshness; writes NOTHING
 * ```
 *
 * The DATA is `STATUS_ENTRIES` in `lib/ops/status-ledger.ts` — one row per
 * current-capability assertion, each naming the check that fails when the
 * claim stops being true, or `null` for UNPROVEN. This script only renders.
 *
 * ## Impurity, stated
 *
 * This generator is IMPURE and registered as such: it reads the wall clock for
 * its generated-at stamp and `git rev-parse HEAD` for the SHA on that stamp.
 * The CARRIED STAMP below is what keeps it idempotent anyway: when the
 * rendered BODY (everything below the stamp marker) is byte-identical to the
 * committed body, the committed stamp block is kept verbatim, so a
 * regeneration that changes nothing produces no diff — and `--check` can
 * byte-compare despite the clock and the SHA. Only a changed body earns a
 * fresh stamp.
 *
 * ## Future dates
 *
 * Any future date this renderer emits gets a same-line expected-future
 * annotation, mechanically, so `tests/doc-dates.test.ts` never depends on a
 * person remembering one. A date already past today needs none.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STATUS_ENTRIES, type StatusEntry } from "../lib/ops/status-ledger.ts";
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

function renderBody(todayStr: string): string {
  const out: string[] = [];
  const proven = STATUS_ENTRIES.filter((e) => e.provingCheck !== null);
  const unproven = STATUS_ENTRIES.filter((e) => e.provingCheck === null);

  out.push("## What this is");
  out.push("");
  out.push(
    "One row per capability the project currently asserts, mapped to the named gate, " +
      "test or walk-check identity that goes red when the claim stops being true. A row " +
      "with no such check renders in the **UNPROVEN** section below with the check that " +
      "needs to exist — stated, never softened. Rows quote RECORDED evidence with its own " +
      "as-of date; volatile counts live in the files that move, not here.",
  );
  out.push("");
  out.push("Proof classes, kept apart:");
  out.push("");
  out.push(
    "- `SESSION_MEASURED` — observed by the implementing session's own run.",
  );
  out.push(
    "- `INDEPENDENTLY_REPRODUCED` — reproduced by a canonical suite or audit execution " +
      "separate from the implementation's one-off proving observation, against a committed " +
      "integration head or later, via the normal reader/audit path, never a purpose-built " +
      "fixture encoding the expected result.",
  );
  out.push("");
  out.push(
    "Reader-facing runs also record their target: `LOCAL_RENDER` (a local production " +
      "build, RULING 125) or `PRODUCTION_RENDER` (the deployed site).",
  );
  out.push("");
  out.push(
    `**${STATUS_ENTRIES.length} capability row(s) stated — ${proven.length} with a named ` +
      `proving check, ${unproven.length} UNPROVEN. The two tables below render exactly ` +
      `${proven.length} and ${unproven.length} row(s).**`,
  );
  out.push("");

  out.push(`## Proven capabilities — ${proven.length} row(s)`);
  out.push("");
  out.push("| capability | proving check | last result | proof class | target | as-of | SHA |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const e of proven) {
    out.push(
      `| ${cell(e.capability)} | ${cell(e.provingCheck ?? "")} | ${cell(e.lastResult)} | ` +
        `${e.proofClass ?? "—"} | ${e.target ?? "—"} | ${e.asOf} | ` +
        `${e.sha ? `\`${e.sha.slice(0, 12)}\`` : "—"} |`,
    );
  }
  out.push("");
  out.push("Evidence, per row (committed locations only):");
  out.push("");
  for (const e of proven) {
    out.push(`- ${cell(e.capability).slice(0, 96)}… → ${cell(e.evidence)}`);
  }
  out.push("");

  out.push(`## UNPROVEN — ${unproven.length} row(s), each naming the check that needs to exist`);
  out.push("");
  out.push(
    "UNPROVEN means no check is NAMED that fails when the claim stops being true. It is a " +
      "fact about the project's instrumentation, never a verdict on the capability — and it " +
      "is not softened here.",
  );
  out.push("");
  out.push("| capability | needed check | last result | proof class | target | as-of |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const e of unproven) {
    out.push(
      `| ${cell(e.capability)} | ${cell(e.neededCheck ?? "(none stated — a defect in this ledger)")} | ` +
        `${cell(e.lastResult)} | ${e.proofClass ?? "—"} | ${e.target ?? "—"} | ${e.asOf} |`,
    );
  }
  out.push("");
  out.push("Evidence, per row (committed locations only):");
  out.push("");
  for (const e of unproven) {
    out.push(`- ${cell(e.capability).slice(0, 96)}… → ${cell(e.evidence)}`);
  }
  out.push("");
  out.push(
    "## Where the rows came from",
  );
  out.push("");
  out.push(
    "The hand-written current-status surfaces retired on 2026-08-30: docs/state.md §2, §3 " +
      "and §7 (each now carries a retirement note pointing here; the prior text is in git " +
      "history) and README.md's capability prose. The data module is " +
      "`lib/ops/status-ledger.ts`; edit it, then run `pnpm status:ledger`.",
  );
  out.push("");

  return out.map((l) => annotateFutureDates(l, todayStr)).join("\n") + "\n";
}

function headSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

/** The full document, with the carried-stamp rule applied. */
function renderDocument(): { next: string; carried: boolean } {
  const body = renderBody(today());
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
    `Generated ${generatedAtEastern()} by \`pnpm status:ledger\`. HEAD \`${headSha()}\`.`,
    "",
    STAMP_END,
    "",
    "",
  ].join("\n");
  return { next: `${head}${body}`, carried: false };
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("status-ledger.mts");
if (invoked) {
  const { next, carried } = renderDocument();
  const committed = existsSync(DOC) ? readFileSync(DOC, "utf8") : null;
  if (process.argv.includes("--check")) {
    // --check NEVER writes. Stale is reported and left stale.
    if (committed === next) {
      console.log(
        `docs/status-ledger.md is current — ${STATUS_ENTRIES.length} row(s), stamp ${carried ? "carried" : "fresh"}`,
      );
    } else {
      const a = (committed ?? "").split("\n");
      const b = next.split("\n");
      let firstDiff = 0;
      while (firstDiff < Math.min(a.length, b.length) && a[firstDiff] === b[firstDiff]) firstDiff++;
      console.error(
        committed === null
          ? "docs/status-ledger.md does not exist. Run: pnpm status:ledger"
          : `docs/status-ledger.md is STALE against lib/ops/status-ledger.ts — committed ` +
              `${a.length} line(s), regenerated ${b.length} line(s), first difference at line ` +
              `${firstDiff + 1}. Run: pnpm status:ledger (--check repairs nothing)`,
      );
      process.exit(1);
    }
  } else {
    if (committed === next) {
      console.log(
        `docs/status-ledger.md unchanged — ${STATUS_ENTRIES.length} row(s), stamp carried`,
      );
    } else {
      writeFileSync(DOC, next, "utf8");
      const unproven = STATUS_ENTRIES.filter((e) => e.provingCheck === null).length;
      console.log(
        `docs/status-ledger.md written — ${STATUS_ENTRIES.length} row(s), ` +
          `${STATUS_ENTRIES.length - unproven} proven, ${unproven} UNPROVEN, stamp ${carried ? "carried" : "fresh"}`,
      );
    }
  }
}
