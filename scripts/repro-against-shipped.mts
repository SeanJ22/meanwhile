/**
 * REPRODUCE A FINDING AGAINST THE CODE AS SHIPPED, NOT AGAINST THE FIX.
 *
 * Session: audit-remediation-0824. Claim served: A-003 — "the production
 * 403-retry path returns body text on a browser-header 200 without the
 * `notADocument` check" — reproduced before it was fixed, as the brief's law
 * requires. The output is quoted in the close-out.
 *
 * ## The technique, which is the part worth keeping (RULING 76)
 *
 * A remediation session has a problem no ordinary session has: by the time it
 * can run a test, it has usually already written the fix. Asserting that the
 * new code passes says nothing about whether the old code failed, and "a fix
 * for a misread is a new bug with paperwork".
 *
 * So the old module is MATERIALISED FROM GIT at run time — `git show
 * <rev>:<path>` into a scratch file whose relative imports are re-pointed at
 * the live tree — and the finding is driven against that. Nothing stale is
 * committed, the revision is named on the command line, and re-running it
 * after the fix is one flag.
 *
 * The second technique, and it is the half specific to A-003: the escalation
 * ladder in `politeGetText` is gated on `!options.fetchImpl`, so it CANNOT be
 * reached by injection — that unreachability is itself part of the finding.
 * Replacing `globalThis.fetch` gets underneath the gate instead, so the real
 * ladder runs with doubles beneath it. Any finding that lives in a
 * deliberately-uninjectable branch can be reached the same way.
 *
 *   pnpm tsx scripts/repro-against-shipped.mts            # against HEAD's parent
 *   pnpm tsx scripts/repro-against-shipped.mts --rev 336a3eb
 *   pnpm tsx scripts/repro-against-shipped.mts --live     # against the working tree
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const argAt = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const LIVE = process.argv.includes("--live");
const REV = argAt("--rev") ?? "HEAD";
const TARGET = "lib/sources/http.ts";

/**
 * Materialise one file from a revision, with its relative imports re-pointed
 * at the live tree so its siblings resolve.
 *
 * The scratch file goes in the OS temp dir rather than the repo: a copy of an
 * old module sitting in `lib/` would be swept by every file-walking guard in
 * the suite and would type-check as though it were current.
 */
function materialise(rev: string, repoPath: string): string {
  const source = execFileSync("git", ["show", `${rev}:${repoPath}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const dir = mkdtempSync(join(tmpdir(), "wtp-shipped-"));
  const here = join(ROOT, repoPath, "..").replace(/\\/g, "/");
  const rewritten = source.replace(
    /from "(\.\.?\/[^"]+)"/g,
    (_m, spec: string) => `from "${new URL(spec, pathToFileURL(here + "/")).href}"`,
  );
  const file = join(dir, "shipped.ts");
  writeFileSync(file, rewritten, "utf8");
  return file;
}

const modulePath = LIVE
  ? join(ROOT, TARGET)
  : materialise(REV, TARGET);

const { politeGetText } = (await import(pathToFileURL(modulePath).href)) as {
  politeGetText: (
    url: string,
    options: Record<string, unknown>,
  ) => Promise<{ status: number; contentType: string; text: string }>;
};

/*
 * The case, exactly as the auditor described it: the index-profile GET is
 * refused with 403, and the browser-header retry answers 200 with a page that
 * is not the feed. The URL asks for an `.ics`; the body is an HTML 404.
 */
const HTML_404 = "<html><body><h1>404 Not Found</h1></body></html>";
let call = 0;
globalThis.fetch = (async () => {
  call += 1;
  if (call === 1) return new Response("forbidden", { status: 403 });
  return new Response(HTML_404, { status: 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

console.log(`\nA-003 · driving the 403 ladder against ${LIVE ? "the working tree" : `${REV}:${TARGET}`}\n`);

try {
  const got = await politeGetText("https://town.example/export.ics", {
    expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
  });
  console.log(`  RETURNED AS A DOCUMENT — status ${got.status}, ${got.text.length} bytes`);
  console.log(`  body: ${JSON.stringify(got.text.slice(0, 60))}`);
  console.log(
    "\n  A-003 REPRODUCED: rung 3 handed back an HTML 404 page as an .ics feed.\n" +
      "  The same bytes on rung 2 are refused by notADocument, two screens above.\n",
  );
  process.exitCode = 1;
} catch (error) {
  console.log(`  REFUSED: ${(error as Error).message}`);
  console.log("\n  A-003 does not reproduce here — every rung passes the finalizer.\n");
} finally {
  if (!LIVE) rmSync(join(modulePath, ".."), { recursive: true, force: true });
}
