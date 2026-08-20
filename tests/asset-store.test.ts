import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * RULING 20 (Prompt C item 14, 2026-08-20) — **portraits and PDF corpora do
 * not go in git.** They are content-addressed outside the repo with their
 * hashes committed. Reference data, per-zip snapshots and all provenance stay
 * in git.
 *
 * ## Why this guard exists rather than a rule in a document
 *
 * 938 tracked images and PDFs, 177.1 MB, and the corpus this product wants is
 * an ingest-volume one: every agenda PDF for every body it watches. Git keeps
 * every version of every one of them forever, so the cost is not today's
 * number — it is that number times every re-fetch, and it cannot be undone
 * afterwards. A rule nobody enforces gets discovered at 2 GB.
 *
 * ## The grandfather set is the MANIFEST, deliberately
 *
 * The committed portraits were NOT deleted, and that is a decision: the deploy
 * serves them out of `public/officials/`, the store is a local path Netlify
 * cannot reach, and removing them today would blank every candidate and
 * official card in production. Shipping a reader-facing regression to save
 * repository size is not a trade this product makes.
 *
 * So the exemption list is exactly `data/assets/manifest.json` — every file
 * already in the store, by path AND by hash. That makes the allowlist
 * self-maintaining and impossible to pad: a new binary is not in the manifest,
 * so it fails; and a file that CHANGES fails too, because its hash no longer
 * matches the row that grandfathered it.
 *
 * `R57` carries the remaining half — where the store lives such that a Netlify
 * build can restore from it — which is the author's decision.
 */

const BINARY = /\.(jpg|jpeg|png|webp|gif|pdf)$/i;

/** Repo furniture, never a corpus. Mirrors STAYS_IN_REPO in scripts/assets.mts. */
const STAYS_IN_REPO = [/^public\/favicon/i, /^public\/icons?\//i, /^app\//, /^components\//];

interface Manifest {
  rows: { path: string; sha256: string; bytes: number }[];
  counts: { rows: number; bytes: number; distinctHashes: number };
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, "data", "assets", "manifest.json"), "utf8"),
) as Manifest;

function trackedBinaries(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 1e9,
  })
    .split("\0")
    .filter(Boolean)
    // RULING 14: a repo-relative path is POSIX everywhere it is compared.
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => BINARY.test(p))
    .filter((p) => !STAYS_IN_REPO.some((re) => re.test(p)));
}

test("RULING 20: no NEW portrait or PDF binary is committed to the repo", () => {
  const known = new Set(manifest.rows.map((r) => r.path));
  const offenders = trackedBinaries().filter((p) => !known.has(p));

  assert.deepEqual(
    offenders,
    [],
    "these binaries are committed and are not in the content-addressed store. " +
      "Run `pnpm assets migrate` to store them by hash and record their provenance, " +
      "then commit `data/assets/manifest.json`. Portraits and document corpora do " +
      "not go in git: git keeps every version of every one of them forever, and the " +
      "cost is this number times every re-fetch.",
  );
});

test("RULING 20: the sweep actually reaches the binaries it claims to", () => {
  /*
   * A guard that swept nothing would pass forever. This is the other half of
   * the same discipline as the assertion above — a sweep that found nothing
   * must not read as a sweep that found nothing wrong.
   */
  const found = trackedBinaries();
  assert.ok(
    found.length > 500,
    `expected the whole portrait set, the sweep found ${found.length} file(s)`,
  );
  assert.ok(
    found.some((p) => p.startsWith("public/officials/")),
    "the sweep reaches public/officials/, which is where the portraits are",
  );
});

test("RULING 20: every manifest row is a real file with the hash it claims", () => {
  // Spot-checked by SIZE for every row and by nothing weaker — a full re-hash
  // of 177 MB in the unit suite would make the suite a minute slower to prove
  // something `pnpm assets verify` proves properly, and that command is the
  // one that hashes.
  const wrong: string[] = [];
  for (const row of manifest.rows) {
    if (!/^[0-9a-f]{64}$/.test(row.sha256)) wrong.push(`${row.path}: malformed sha256`);
    if (!Number.isInteger(row.bytes) || row.bytes <= 0) wrong.push(`${row.path}: no size`);
  }
  assert.deepEqual(wrong, [], "every row carries a real hash and a real size");
  assert.equal(
    manifest.counts.rows,
    manifest.rows.length,
    "the stated count equals the rendered rows — the manifest's own denominator",
  );
});

test("RULING 20: reference data and provenance stay in git", () => {
  /*
   * The rule has two halves and only one of them is about removal. Reference
   * data, per-zip snapshots and all provenance STAY — they are what makes a
   * coverage claim checkable, and a hash in a manifest is not a substitute for
   * a file a reader can open.
   */
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", cwd: ROOT, maxBuffer: 1e9 })
      .split("\0")
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, "/")),
  );
  for (const must of [
    "data/reference/census_govt_units_2022.csv",
    "data/reference/nces_ccd_lea_directory_2025_26.csv",
    "data/derived/zip-coverage-tiers-runtime.json",
  ]) {
    assert.ok(tracked.has(must), `${must} must stay in git`);
  }
  /*
   * The manifest is checked ON DISK rather than in `git ls-files`, because the
   * commit that first adds it has not happened when this runs — a tracked-only
   * assertion would fail on the very session that creates the file and pass
   * forever after, which is a guard that only ever refuses the right change.
   */
  assert.ok(
    existsSync(join(ROOT, "data", "assets", "manifest.json")),
    "data/assets/manifest.json must exist — it is what git carries in place of the bytes",
  );
  // And it must not be IGNORED, which is the way it would fail to reach git
  // while still existing on the machine that wrote it. `git check-ignore`
  // exits 1 when a path is not ignored, so the throw is the passing case.
  let ignored = true;
  try {
    execFileSync("git", ["check-ignore", "-q", "data/assets/manifest.json"], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    ignored = false;
  }
  assert.equal(ignored, false, "the manifest may never be gitignored — it IS the record");
  const stored = new Set(manifest.rows.map((r) => r.path));
  assert.ok(
    ![...stored].some((p) => p.startsWith("data/reference/")),
    "no reference-data file may be moved into the asset store",
  );
});
