/**
 * DB-57: a repair agent gets only the broken part.
 *
 * When the engineer repairs a door kind it is given that kind's adapter folder
 * (`lib/sources/<kind>/`), the failing example (the saved page bytes and the
 * failure) and that kind's own tests (the ones DB-49 selects), and it may write
 * only inside that folder, that kind's fixtures and those tests. Anything else
 * it proposes is refused by name, so a repair shows up as a change to one
 * adapter folder, checked by that kind's tests alone.
 *
 * PURE: the caller reads files and hands them in.
 */

import { adapterTestSelection } from "../../ops/adapter-test-selection.ts";

/** Kinds that are shared plumbing, not one adapter's folder: never a repair target. */
const NOT_A_KIND = new Set(["composite", "platform-adapters", "mock", "snapshot"]);

export interface FailingExample {
  /** The saved page bytes the adapter could not read, as text. */
  readonly savedBytes: string;
  /** What the adapter said when it failed, in the words it used. */
  readonly failure: string;
  /** Where the bytes were saved, for the record. */
  readonly savedAt?: string | null;
}

export interface RepairScope {
  readonly kind: string;
  /** Every path the repair may write: the folder, the kind's fixtures, and its own tests. */
  readonly writable: { readonly folder: string; readonly fixtures: string; readonly tests: readonly string[] };
  /** The adapter's files, which are all the code the agent is shown. */
  readonly files: readonly { readonly path: string; readonly content: string }[];
  /** The kind's own tests, which are all that run to check the repair. */
  readonly testFiles: readonly string[];
  readonly example: FailingExample;
}

export type RepairScopeResult = { readonly ok: true; readonly scope: RepairScope } | { readonly ok: false; readonly why: string };

export function repairScope(input: {
  readonly kind: string;
  readonly example: FailingExample;
  /** Tracked files, as repo paths. */
  readonly paths: readonly string[];
  readonly readText: (path: string) => string;
}): RepairScopeResult {
  const kind = input.kind.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kind) || NOT_A_KIND.has(kind)) return { ok: false, why: `"${input.kind}" is not one adapter kind with a folder of its own` };
  const folder = `lib/sources/${kind}/`;
  const files = input.paths.filter((p) => p.startsWith(folder) && /\.(?:ts|mts|mjs|json)$/.test(p)).sort();
  if (files.length === 0) return { ok: false, why: `there is no adapter folder ${folder}` };
  const tests = input.paths.filter((p) => /^tests\/[^/]+\.test\.(?:ts|mts|mjs)$/.test(p));
  // The same question DB-49 asks: which tests name this kind's folder, plus the composite check.
  const selected = adapterTestSelection({ changed: [`${folder}${files[0]!.slice(folder.length)}`], tests, readText: input.readText });
  if (selected === null) return { ok: false, why: `no test names ${folder} together with the composite check, so the repair cannot be checked by this kind's tests alone` };
  if (input.example.savedBytes.trim() === "" || input.example.failure.trim() === "") return { ok: false, why: "a repair needs the saved page and the failure it caused" };
  return {
    ok: true,
    scope: {
      kind,
      writable: { folder, fixtures: `tests/fixtures/${kind}/`, tests: selected.files },
      files: files.map((path) => ({ path, content: input.readText(path) })),
      testFiles: selected.files,
      example: input.example,
    },
  };
}

/** The paths a repair proposed that it may not write; empty when every one is inside its scope. */
export function outOfScope(scope: RepairScope, proposed: readonly string[]): string[] {
  return proposed.filter((raw) => {
    const path = raw.replace(/\\/g, "/");
    if (path.includes("..") || path.startsWith("/")) return true;
    return !(path.startsWith(scope.writable.folder) || path.startsWith(scope.writable.fixtures) || scope.writable.tests.includes(path));
  });
}

/** The brief the engineer reads: only the broken part, nothing else of the repository. */
export function repairBrief(scope: RepairScope): string {
  return [
    `Repair the ${scope.kind} adapter. You may change only files under ${scope.writable.folder}, ${scope.writable.fixtures} and these tests: ${scope.writable.tests.join(", ")}.`,
    "The failing example:",
    `Failure: ${scope.example.failure.trim()}`,
    `Saved page${scope.example.savedAt ? ` (${scope.example.savedAt})` : ""}:`,
    scope.example.savedBytes,
    "The adapter's files:",
    ...scope.files.map((f) => `--- ${f.path}\n${f.content}`),
    `It is checked by these tests alone: ${scope.testFiles.join(", ")}.`,
  ].join("\n");
}
