/**
 * `pnpm assets` — content-addressed storage for portraits and PDF corpora
 * (RULING 20, Prompt C item 14, 2026-08-20).
 *
 *   pnpm assets migrate [--dry]   copy every tracked binary into the store and
 *                                 write the committed manifest
 *   pnpm assets verify            every manifest row still resolves, by HASH
 *   pnpm assets restore [--dry]   materialize the working tree from the store
 *
 * ## Why anything moved at all
 *
 * 938 tracked images and PDFs, **177.1 MB**, and the corpus this product wants
 * is an ingest-volume one: every agenda PDF for every body it watches. Git
 * keeps every version of every one of them forever, so the size is not the
 * current number — it is that number times every re-fetch, and it cannot be
 * undone afterwards.
 *
 * ## What content-addressed means here, and what it protects
 *
 * A file is stored under the SHA-256 of its own bytes:
 * `<store>/ab/cdef…jpg`. The repo commits the manifest — logical path, hash,
 * size, and the provenance the photo rule requires (which of the four doors it
 * shipped through, its source URL, its licence). So:
 *
 *   - **Provenance survives**, because it was never in the bytes; it was
 *     always in a row beside them.
 *   - **Reproducibility survives**, because a hash is a stronger identity than
 *     a path: two rows pointing at the same hash ARE the same picture, and a
 *     file whose bytes changed cannot silently keep its old row.
 *   - **The bytes stop growing the repo.**
 *
 * ## WHAT THIS SESSION DELIBERATELY DID NOT DO, and it is a decision
 *
 * **The committed portraits were NOT deleted.** They are served from
 * `public/officials/` by the deploy, and the store lives on a local path that
 * Netlify cannot reach. Deleting them today would blank every candidate and
 * official card in production — a reader-facing regression shipped to save
 * repository size, which is exactly the trade this product does not make.
 *
 * So the mechanism is built, the store is populated, the hashes are committed,
 * and the guard refuses NEW binaries from here. Emptying the repo of the
 * existing ones waits on one decision: WHERE the store
 * lives such that a Netlify build can restore from it. `R57` carries that.
 *
 * ## The store's location
 *
 * `WTP_ASSET_STORE`, defaulting to `../we-the-people-assets` beside the repo —
 * outside it, which is the whole point, and not inside any synced folder by
 * default because 177 MB of content-addressed blobs is not what a document
 * mirror is for.
 */

import { createHash } from "node:crypto";
import { STAYS_IN_REPO } from "../lib/ops/asset-scope.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import { assetRemoteBase, fetchAssetFromRemote } from "../lib/ops/asset-remote.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { today } from "./doc-dates.mjs";

const MODE = process.argv[2];
const DRY = process.argv.includes("--dry");
/**
 * `--no-remote` keeps a restore purely local. The default is remote-enabled,
 * because a restore path that has to be asked for is a restore path a Netlify
 * build will not take (`R57`, 2026-08-24).
 */
const NO_REMOTE = process.argv.includes("--no-remote");

const STORE = resolve(
  process.env.WTP_ASSET_STORE ?? join(process.cwd(), "..", "we-the-people-assets"),
);
const MANIFEST = join(process.cwd(), "data", "assets", "manifest.json");

/** What the store holds: portraits and document corpora, never source. */
const BINARY = /\.(jpg|jpeg|png|webp|gif|pdf)$/i;

/**
 * Paths whose binaries are part of the REPO rather than a corpus, and stay.
 *
 * A favicon is chrome, three screenshots are a session's own evidence of a
 * layout, and the design tokens' assets are the product's own furniture. The
 * rule is about CORPORA — 900 portraits and an ingest-volume document set —
 * and a rule applied past its reason costs more than it saves.
 */
/*
 * `docs/feedback/` added 2026-08-23 (RULING 104) — the author's walkthrough
 * captures are an INPUT a session must reach, not a corpus. Mirrored in
 * `tests/asset-store.test.ts`, which carries the full reasoning.
 */

interface ManifestRow {
  path: string;
  sha256: string;
  bytes: number;
  storedAt: string;
}

interface Manifest {
  writtenAt: string;
  note: string;
  store: string;
  counts: { rows: number; bytes: number; distinctHashes: number };
  rows: ManifestRow[];
}

function trackedBinaries(): string[] {
  // WHAT WOULD BE COMMITTED, not what already was — see lib/ops/repo-files.ts.
  return filesThatWouldBeCommitted({ cwd: process.cwd() })
    .filter((p) => BINARY.test(p))
    .filter((p) => !STAYS_IN_REPO.some((re) => re.test(p)))
    .sort();
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function storePath(hash: string, ext: string): string {
  return join(STORE, hash.slice(0, 2), `${hash}${ext.toLowerCase()}`);
}

function readManifest(): Manifest | null {
  if (!existsSync(MANIFEST)) return null;
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

/* ========================================================================== */

if (MODE === "migrate") {
  const files = trackedBinaries();
  if (files.length === 0) {
    console.error(
      "REFUSED: zero tracked binaries found. A zero-row migration is a failed " +
        "migration, never an empty store.",
    );
    process.exit(1);
  }

  const rows: ManifestRow[] = [];
  const hashes = new Set<string>();
  let copied = 0;
  let alreadyPresent = 0;
  let bytes = 0;

  for (const file of files) {
    const hash = sha256(file);
    const size = statSync(file).size;
    bytes += size;
    hashes.add(hash);
    rows.push({ path: file, sha256: hash, bytes: size, storedAt: today() });

    const dest = storePath(hash, extname(file));
    if (existsSync(dest)) {
      alreadyPresent += 1;
      continue;
    }
    if (!DRY) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
    }
    copied += 1;
  }

  const manifest: Manifest = {
    writtenAt: today(),
    note:
      "RULING 20 (Prompt C item 14). Portraits and document corpora are stored by " +
      "the SHA-256 of their own bytes, outside the repo; this manifest is what git " +
      "carries. THE COMMITTED COPIES WERE NOT DELETED — the deploy serves " +
      "public/officials/ and the store is a local path Netlify cannot reach, so " +
      "removing them would blank every card in production. See R57. Reference " +
      "data, per-zip snapshots and all provenance stay in git and are not here.",
    store: STORE,
    counts: { rows: rows.length, bytes, distinctHashes: hashes.size },
    rows,
  };

  if (!DRY) {
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`, "utf8");
  }

  console.log(`MIGRATE${DRY ? " (DRY — nothing written)" : ""}`);
  console.log(`  store:                 ${STORE}`);
  console.log(`  tracked binaries:      ${files.length}`);
  console.log(`  bytes:                 ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`  copied into the store: ${copied}`);
  console.log(`  already present:       ${alreadyPresent}`);
  console.log(`  distinct hashes:       ${hashes.size}`);
  console.log(
    `  DUPLICATE BYTES:       ${files.length - hashes.size} file(s) share a hash with ` +
      "another — the same picture under two paths, which a path-keyed store cannot see",
  );

  if (!DRY) {
    const back = readManifest();
    console.log(`  manifest re-read:      ${back?.rows.length ?? 0} row(s)`);
    if (!back || back.rows.length !== rows.length) {
      console.error("REFUSED: the manifest did not read back with the same row count.");
      process.exit(1);
    }
  }
} else if (MODE === "verify") {
  const manifest = readManifest();
  if (!manifest) {
    console.error(`CANNOT RUN: no manifest at ${MANIFEST}. Run \`pnpm assets migrate\` first.`);
    process.exit(1);
  }
  let inStore = 0;
  let inTree = 0;
  const missing: string[] = [];
  const changed: string[] = [];
  for (const row of manifest.rows) {
    if (existsSync(storePath(row.sha256, extname(row.path)))) inStore += 1;
    else missing.push(row.path);
    if (existsSync(row.path)) {
      inTree += 1;
      /*
       * BY HASH, never by size or date. A file whose bytes changed cannot
       * silently keep its old row — that is the whole reason the identity is
       * the content rather than the path.
       */
      if (sha256(row.path) !== row.sha256) changed.push(row.path);
    }
  }
  console.log(`VERIFY`);
  console.log(`  manifest rows:      ${manifest.rows.length}`);
  console.log(`  present in store:   ${inStore}`);
  console.log(`  present in tree:    ${inTree}`);
  console.log(`  MISSING from store: ${missing.length}${missing.length ? ` — ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}` : ""}`);
  console.log(`  CHANGED in tree:    ${changed.length}${changed.length ? ` — ${changed.slice(0, 5).join(", ")}` : ""}`);
  if (changed.length > 0) process.exit(1);
} else if (MODE === "restore") {
  const manifest = readManifest();
  if (!manifest) {
    console.error(`CANNOT RUN: no manifest at ${MANIFEST}.`);
    process.exit(1);
  }
  let restored = 0;
  let alreadyRight = 0;
  let fromRemote = 0;
  const unavailable: string[] = [];
  const refusals: string[] = [];
  for (const row of manifest.rows) {
    const ext = extname(row.path);
    const src = storePath(row.sha256, ext);

    if (existsSync(row.path) && sha256(row.path) === row.sha256) {
      alreadyRight += 1;
      continue;
    }

    if (existsSync(src)) {
      if (!DRY) {
        mkdirSync(dirname(row.path), { recursive: true });
        copyFileSync(src, row.path);
      }
      restored += 1;
      continue;
    }

    /*
     * Not in the local store. THE REMOTE IS A RUNG, not a fallback that
     * silently changes what the run means: it is reported on its own line with
     * its own count, and every byte it returns is proved against the hash the
     * row was requested under before anything is written.
     */
    if (NO_REMOTE) {
      unavailable.push(row.path);
      continue;
    }
    const remote = await fetchAssetFromRemote(row.sha256, ext);
    if (!remote.ok || !remote.body) {
      unavailable.push(row.path);
      refusals.push(`${row.path}: ${remote.refusal ?? "no body"}`);
      continue;
    }
    if (!DRY) {
      mkdirSync(dirname(row.path), { recursive: true });
      writeFileSync(row.path, remote.body);
      const dest = storePath(row.sha256, ext);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, remote.body);
    }
    restored += 1;
    fromRemote += 1;
  }
  console.log(`RESTORE${DRY ? " (DRY — nothing written)" : ""}`);
  console.log(`  rows:                ${manifest.rows.length}`);
  console.log(`  already correct:     ${alreadyRight}`);
  console.log(`  restored:            ${restored}`);
  console.log(
    `  — of those, remote:  ${fromRemote}` +
      (NO_REMOTE
        ? "  (--no-remote: the remote rung was not walked)"
        : `  from ${assetRemoteBase()}`),
  );
  console.log(
    `  NOT IN THE STORE:    ${unavailable.length}` +
      (unavailable.length
        ? ` — ${unavailable.slice(0, 5).join(", ")}. This is a CANNOT RUN for those rows, ` +
          "never a decision to serve nothing."
        : ""),
  );
  for (const refusal of refusals.slice(0, 10)) console.log(`    REFUSED  ${refusal}`);
} else if (MODE === "prove-remote") {
  /*
   * **The restore path is PROVEN, not assumed** (`R57`, Sean's decision of
   * 2026-08-24; RULING 113 — a step whose product is observable is observed at
   * the step).
   *
   * A sample of real manifest rows is fetched from the public store and each
   * one is verified BY HASH, plus a CONTROL: a well-formed hash the store does
   * not hold, which must be REFUSED. Without the control this would be a check
   * that passes because the host answers, rather than because the host answers
   * with the right thing.
   */
  const manifest = readManifest();
  if (!manifest) {
    console.error(`CANNOT RUN: no manifest at ${MANIFEST}.`);
    process.exit(1);
  }
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 7);
  const bySize = [...manifest.rows].sort((a, b) => a.bytes - b.bytes);
  const picks = [
    bySize[0],
    bySize[Math.floor(bySize.length / 2)],
    bySize[bySize.length - 1],
    ...manifest.rows.filter((_, i) => i % Math.max(1, Math.floor(manifest.rows.length / sample)) === 0),
  ]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .slice(0, Math.max(3, sample));

  console.log(`PROVE-REMOTE  ${assetRemoteBase()}`);
  let ok = 0;
  let refused = 0;
  let bytes = 0;
  for (const row of picks) {
    const result = await fetchAssetFromRemote(row.sha256, extname(row.path));
    if (result.ok) {
      ok += 1;
      bytes += result.bytes;
      console.log(`  OK       ${String(result.bytes).padStart(9)}  ${row.path}`);
    } else {
      refused += 1;
      console.log(`  REFUSED  ${row.path} — ${result.refusal}`);
    }
  }
  console.log(`  fetched and HASH-VERIFIED: ${ok} of ${picks.length}; refused ${refused}; ${bytes} byte(s)`);

  // The control. A hash of the right SHAPE that the store does not hold.
  const control = `${"0".repeat(63)}1`;
  const controlResult = await fetchAssetFromRemote(control, ".jpg");
  console.log(
    `  CONTROL (a hash the store does not hold): ok=${controlResult.ok} ` +
      `status=${controlResult.status} — ${controlResult.refusal ?? "answered!"}`,
  );
  if (controlResult.ok) {
    console.error("REFUSED: the store answered for a hash it does not hold — this check proves nothing.");
    process.exit(1);
  }
  if (refused > 0 || ok === 0) process.exit(1);
} else {
  console.error("usage: pnpm assets <migrate|verify|restore|prove-remote> [--dry] [--no-remote]");
  process.exit(2);
}
