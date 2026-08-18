/**
 * THE CODE MIRROR — a read path for the strategic reviewer (R30).
 *
 * `pnpm handoff` runs this after the document mirror, on every path.
 * `--no-code` skips it.
 *
 * ## What this is, and what it is not
 *
 * The reviewer reads session reports and writes briefs without ever seeing
 * source, which is how a brief ends up full of NAMED SUSPECTS where a verified
 * cause would do. Mirroring a small curated set of files fixes that
 * permanently: the reviewer reads them at orientation the same way it reads
 * `context.md`.
 *
 * It is a READ path. It is **not a backup**, **not a deployment**, and **not a
 * second source of truth**. The repository is the only source of truth. A copy
 * in Drive is stale the moment `main` moves, and the manifest's commit SHA is
 * what makes that staleness visible rather than misleading.
 *
 * ## How the mirror is actually maintained — the thing to know first
 *
 * There is no Drive API anywhere in this repo, and this script does not add
 * one. `G:/My Drive/we-the-people` is a **Google Drive for Desktop folder on
 * the local filesystem**, and `scripts/handoff.mjs` maintains it with
 * `copyFileSync`. Google Drive syncs it afterwards and assigns the file IDs.
 *
 * Two consequences run through everything below:
 *
 *   1. **This script cannot know a Drive file ID at write time.** A file
 *      created this run has no ID until Drive has synced it. The manifest says
 *      so per row rather than inventing one.
 *   2. **Writing to the wrong file by ID is structurally impossible here.**
 *      Every write is `copyFileSync` to a PATH. The brief asked for a hard stop
 *      when a recorded ID resolves to a different file; that stop belongs where
 *      the risk is, which is `verifyIdMap()` below and the refresher that calls
 *      it — not on a write that never takes an ID as input.
 *
 * ## The ID-instability premise, checked rather than assumed
 *
 * The brief recorded that the reviewer's stored ID for `CLAUDE.md` had come to
 * resolve to `git-state.txt`, and asked that the mechanism be established
 * before anything was built on ID stability. It was checked against live Drive
 * on 2026-08-17, and the folder does not support a swap:
 *
 *   - Drive holds exactly ONE `CLAUDE.md` (`1xRIB7Cq…`, created
 *     2026-08-11T08:13:10Z) and exactly ONE `git-state.txt` (`1P_r7BWB…`,
 *     created 2026-08-13T00:15:57Z). No duplicates, no trashed twins.
 *   - Every one of the ten documents has a `createdTime` days older than its
 *     `modifiedTime`. That is the signature of **update in place**: Drive for
 *     Desktop turns a `copyFileSync` overwrite into a new revision of the same
 *     file, keeping the ID. Delete-and-recreate would reset `createdTime` on
 *     every run.
 *
 * So the document mirror does NOT recreate files, IDs have held for six days
 * across every handoff run in that window, and the code mirror inherits the
 * same mechanism because it writes the same way. What could not be reproduced
 * is the reviewer's specific observation — and that is reported as
 * unreproduced, not as refuted: the recorded ID it refers to was not available
 * to check, so the honest reading is that the fault was in the recording rather
 * than in the folder. `verifyIdMap()` exists regardless. The premise turned out
 * to be wrong, but verification is cheap and an assumption nobody re-checks is
 * how it got recorded as fact in the first place.
 *
 * ## Layout
 *
 * Files land FLAT in `<mirror>/code/`, with `/` encoded as `__`, so
 * `components/map/map-canvas.tsx` becomes `components__map__map-canvas.tsx`.
 * Flat because two files can share a basename (`snapshot.ts` is not unique in
 * this repo) and a collision in the mirror would silently serve the reviewer
 * one file under another's name. The manifest carries the real repo path.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";
import { generatedAtEastern } from "./generated-at.mjs";
import { MIRRORED_DOCS, MIRRORED_DOC_NAMES, MIRRORED_DOC_REPO_PATHS } from "./mirror-set.mjs";

/** The subfolder inside the mirror. Kept out of the ten documents deliberately. */
export const CODE_DIR = "code";

export const ALLOWLIST_PATH = "docs/mirror-code.json";
export const MANIFEST_PATH = "docs/code-manifest.md";
export const ID_MAP_PATH = "docs/mirror-code-ids.json";

/**
 * 200 KB per file, 1.5 MB total. Binary KB, stated so the number is checkable.
 *
 * The per-file cap was 120 KB for one day. `app/globals.css` shipped at 120,124
 * bytes against a 122,880-byte ceiling — 2,756 bytes of headroom, so the design
 * tokens would have fallen out of the reviewer's reach on their next edit. The
 * author raised it to 200 KB on 2026-08-17 rather than watch that happen.
 */
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;

/* ------------------------------------------------------- hard exclusions --- */

/**
 * Refused by PATH, whatever the allowlist says.
 *
 * The allowlist is a request. These are the answer to it, and they are in code
 * rather than in the JSON because a rule the author can edit in the same file
 * as the request is not a rule.
 */
export const EXCLUDED_PATHS = [
  { name: ".env file", re: /(^|\/)\.env(\.|$)/ },
  { name: "private key (.pem)", re: /\.pem$/i },
  { name: "private key (.key)", re: /\.key$/i },
  { name: "credentials in the name", re: /credential/i },
  { name: "secret in the name", re: /secret/i },
  { name: "node_modules", re: /(^|\/)node_modules(\/|$)/ },
  { name: "build output (.next)", re: /(^|\/)\.next(\/|$)/ },
  { name: "build output", re: /(^|\/)(out|build|dist|coverage)(\/|$)/ },
  { name: "the mirror's own staging directory", re: /(^|\/)\.mirror(\/|$)/ },
  {
    name: "lockfile",
    re: /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
  },
];

/**
 * Refused by CONTENT. A path can be innocent and the bytes not be.
 *
 * `sk-` is anchored, and that anchoring was measured rather than preferred: a
 * bare `sk-` substring matches `.ask-pill` in `app/globals.css` (six times) and
 * `ask-box` in `docs/DESIGN.md`, so the unanchored form would have refused two
 * of the twelve seeded files over CSS class names. `\bsk-` alone still fails to
 * fire on `ask-` because the character before `sk` is a word character, and the
 * length floor removes the rest. Every other pattern is left deliberately loose
 * — over-refusing something credential-shaped costs the reviewer one file and
 * says so out loud, while under-refusing puts a live secret in Drive.
 *
 * The connection-string patterns are not hypothetical caution. `.env.local` in
 * this repo holds the PRODUCTION Neon connection string, and a connection
 * string reaching Drive is a live production credential leaving the repo.
 */
export const CREDENTIAL_PATTERNS = [
  { name: "ANTHROPIC_API_KEY", re: /ANTHROPIC_API_KEY/ },
  { name: "LEGISCAN_API_KEY", re: /LEGISCAN_API_KEY/ },
  { name: "DATABASE_URL assignment", re: /DATABASE_URL\s*=/ },
  { name: "Anthropic-style key", re: /\bsk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: "sk- style key", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "GitHub token (ghp_)", re: /\bghp_[A-Za-z0-9]{16,}/ },
  { name: "GitHub token (github_pat_)", re: /\bgithub_pat_[A-Za-z0-9_]{16,}/ },
  { name: "AWS access key id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key", re: /aws_secret_access_key/i },
  { name: "Postgres connection string", re: /postgres(ql)?:\/\//i },
  { name: "Neon host", re: /[A-Za-z0-9-]+\.neon\.tech/i },
];

/* ------------------------------------------------------------------ util --- */

/** `components/map/map-canvas.tsx` → `components__map__map-canvas.tsx`. */
export function flatten(repoPath) {
  return repoPath.replace(/\//g, "__");
}

function sha12(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

/** Accepts a bare path string or `{ path, why }`. */
function readAllowlist(root) {
  const path = join(root, ALLOWLIST_PATH);
  if (!existsSync(path)) {
    return { error: `${ALLOWLIST_PATH} not found — nothing is mirrored without it`, entries: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: `${ALLOWLIST_PATH} is not valid JSON — ${error.message}`, entries: [] };
  }
  const raw = Array.isArray(parsed) ? parsed : (parsed.files ?? []);
  const entries = raw.map((e) =>
    typeof e === "string" ? { path: e, why: "" } : { path: e.path, why: e.why ?? "" },
  );
  return { error: null, entries, seededOn: parsed.seededOn ?? null };
}

export function readIdMap(root) {
  const path = join(root, ID_MAP_PATH);
  if (!existsSync(path)) return { docs: {}, code: {}, verifiedOn: null, folderId: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      docs: parsed.docs ?? {},
      code: parsed.code ?? {},
      verifiedOn: parsed.verifiedAgainstLiveDriveOn ?? null,
      folderId: parsed.folderId ?? null,
    };
  } catch {
    return { docs: {}, code: {}, verifiedOn: null, folderId: null, malformed: true };
  }
}

/* ------------------------------------------------------------ id safety --- */

/**
 * The hard stop, placed where the risk actually is.
 *
 * `live` is a `{ id → title }` map read from the folder's LIVE contents, never
 * from any recorded list — the brief was explicit about that, and a map built
 * from the thing it is meant to check would confirm itself.
 *
 * Three outcomes per entry, and they are kept apart on purpose: `ok` (the ID
 * resolves to the title we expect), `gone` (the ID resolves to nothing — the
 * file was removed, which is recoverable by re-recording), and `mismatch` (the
 * ID resolves to a DIFFERENT file). A mismatch is a hard stop, never a warning:
 * treating it as a warning is how a stale ID gets written to and an unrelated
 * file gets overwritten.
 */
export function verifyIdMap(recorded, live) {
  const ok = [];
  const gone = [];
  const mismatch = [];

  for (const [key, value] of Object.entries(recorded)) {
    const id = typeof value === "string" ? value : value?.id;
    const expected =
      typeof value === "string" ? key : (value?.title ?? flatten(key));
    if (!id) continue;

    const actual = live[id];
    if (actual === undefined) gone.push({ key, id, expected });
    else if (actual !== expected) mismatch.push({ key, id, expected, actual });
    else ok.push({ key, id, expected });
  }

  return { ok, gone, mismatch, safe: mismatch.length === 0 };
}

/* ---------------------------------------------------------------- mirror --- */

/**
 * Copy the allowlisted files into `<mirror>/code/`, write the manifest.
 *
 * Never throws for an ordinary refusal — a refusal is a RESULT, and the caller
 * prints it. It returns counts for everything, because an operation that can
 * return nothing must be asked what it returned: `mirrored`, `skipped` and
 * `removed` are integers on every path, including the paths that did no work.
 */
export function mirrorCode({ root, mirrorPath, checkOnly = false, headSha = null }) {
  const stampedToday = today();
  // R18: this is the generated-at instant on a generated document, so Eastern.
  // `stampedToday` beside it stays America/Phoenix — the session DAY, which is
  // a different question with a different rule.
  const generatedAt = generatedAtEastern();

  const { error, entries, seededOn } = readAllowlist(root);
  if (error) {
    return { level: "fail", detail: error, mirrored: 0, skipped: 0, removed: 0, rows: [] };
  }

  const idMap = readIdMap(root);
  const rows = [];
  let runningBytes = 0;

  for (const entry of entries) {
    const repoPath = entry.path;
    const row = { repoPath, why: entry.why, mirrorName: flatten(repoPath) };

    const refuse = (reason) => {
      row.skipped = true;
      row.reason = reason;
      rows.push(row);
    };

    // Duplicate refusal, first — before anything reads the file. `CLAUDE.md`
    // and `types.ts` are already in the folder as documents, and mirroring
    // either again would put two copies under two Drive IDs, which diverge.
    if (MIRRORED_DOC_REPO_PATHS.has(repoPath)) {
      const doc = MIRRORED_DOCS.find((d) => d.repoPath === repoPath);
      refuse(
        `refused — the document mirror already carries this as ${doc.mirrorName}; two copies under two Drive IDs diverge`,
      );
      continue;
    }
    if (MIRRORED_DOC_NAMES.has(row.mirrorName)) {
      refuse(
        `refused — its mirror name collides with the document ${row.mirrorName}`,
      );
      continue;
    }

    const excluded = EXCLUDED_PATHS.find((x) => x.re.test(repoPath));
    if (excluded) {
      refuse(`refused — ${excluded.name}`);
      continue;
    }

    const from = join(root, repoPath);
    if (!existsSync(from)) {
      refuse("not found in the repo at this commit");
      continue;
    }

    const stat = statSync(from);
    if (stat.isDirectory()) {
      refuse("refused — a directory; the allowlist names files");
      continue;
    }

    row.bytes = stat.size;
    if (stat.size > MAX_FILE_BYTES) {
      refuse(
        `refused — ${stat.size} bytes is over the ${MAX_FILE_BYTES}-byte per-file cap`,
      );
      continue;
    }

    const buf = readFileSync(from);
    const text = buf.toString("utf8");
    const hit = CREDENTIAL_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      refuse(`refused — contents match a credential pattern (${hit.name})`);
      continue;
    }

    if (runningBytes + stat.size > MAX_TOTAL_BYTES) {
      refuse(
        `refused — would take the payload past the ${MAX_TOTAL_BYTES}-byte total cap (${runningBytes} already)`,
      );
      continue;
    }

    runningBytes += stat.size;
    row.skipped = false;
    row.sha12 = sha12(buf);

    // A file close to the cap is announced BEFORE it falls off, not after.
    // `app/globals.css` shipped at 120,124 bytes against a 122,880 cap — 2.2%
    // of headroom. The refusal when it crosses would be loud, but the first
    // anybody hears of it would be the reviewer's design tokens gone, so the
    // warning belongs on the runs where the file is still making it.
    if (stat.size > MAX_FILE_BYTES * 0.9) {
      row.nearCap = MAX_FILE_BYTES - stat.size;
    }

    const recorded = idMap.code[repoPath];
    row.driveId = typeof recorded === "string" ? recorded : (recorded?.id ?? null);
    row.previousDriveId = recorded?.previousId ?? null;
    row.idChangedOn = recorded?.changedOn ?? null;
    rows.push(row);
  }

  const keep = rows.filter((r) => !r.skipped);
  const skipped = rows.filter((r) => r.skipped);

  // Nothing below this line touches the filesystem under --check.
  if (checkOnly) {
    return {
      level: skipped.length ? "warn" : "ok",
      detail: `skipped (--check) — ${keep.length} would be mirrored, ${skipped.length} refused`,
      mirrored: 0,
      skipped: skipped.length,
      removed: 0,
      wouldMirror: keep.length,
      bytes: runningBytes,
      rows,
      stampedToday,
    };
  }

  if (!existsSync(mirrorPath)) {
    return {
      level: "warn",
      detail: "mirror drive not reachable — the code mirror did not run",
      mirrored: 0,
      skipped: skipped.length,
      removed: 0,
      rows,
      stampedToday,
      unreachable: true,
    };
  }

  const codeDir = join(mirrorPath, CODE_DIR);
  mkdirSync(codeDir, { recursive: true });

  const wanted = new Set(keep.map((r) => r.mirrorName));
  wanted.add("code-manifest.md");

  // A file struck from the allowlist is removed from Drive and struck from the
  // map — but the removal is NAMED in the manifest. A copy that just stops
  // being there reads to the reviewer as a file that never existed.
  const removed = [];
  for (const name of readdirSync(codeDir)) {
    if (wanted.has(name)) continue;
    if (statSync(join(codeDir, name)).isDirectory()) continue;
    rmSync(join(codeDir, name), { force: true });
    removed.push(name);
  }

  let copied = 0;
  for (const row of keep) {
    copyFileSync(join(root, row.repoPath), join(codeDir, row.mirrorName));
    copied++;
  }

  const manifest = renderManifest({
    rows,
    removed,
    headSha,
    stampedToday,
    generatedAt,
    seededOn,
    idMap,
    totalBytes: runningBytes,
  });

  writeFileSync(join(root, MANIFEST_PATH), manifest, "utf8");
  writeFileSync(join(codeDir, "code-manifest.md"), manifest, "utf8");

  return {
    level: skipped.length ? "warn" : "ok",
    detail:
      `${copied} mirrored, ${skipped.length} refused, ${removed.length} removed, ` +
      `${(runningBytes / 1024).toFixed(1)} KB at ${headSha ? headSha.slice(0, 7) : "unknown commit"}`,
    mirrored: copied,
    skipped: skipped.length,
    removed: removed.length,
    bytes: runningBytes,
    rows,
    removedNames: removed,
    stampedToday,
  };
}

/* -------------------------------------------------------------- manifest --- */

/**
 * The reviewer's entry point — the cheap file read before any source.
 *
 * The head sentence is load-bearing. Without it the folder presents twelve
 * source files with no indication that they are copies, that they may be
 * behind `main`, or that the repo is where the truth is.
 */
function renderManifest({
  rows,
  removed,
  headSha,
  stampedToday,
  generatedAt,
  seededOn,
  idMap,
  totalBytes,
}) {
  const kept = rows.filter((r) => !r.skipped);
  const skipped = rows.filter((r) => r.skipped);
  const L = [];

  L.push("# Code manifest — the mirrored source, and what it is");
  L.push("");
  L.push(
    "**These are READ-ONLY COPIES of repository files as they stood at the commit named below.** " +
      "The repository is the only source of truth. A copy here is stale whenever this manifest's " +
      "commit differs from `main` — check that first, and read nothing here as current until you have. " +
      "This mirror is not a backup and not a deployment; it exists so source can be read at orientation " +
      "instead of inferred from reports.",
  );
  L.push("");
  L.push(
    "The mirror updates at the END of each session, as part of `pnpm handoff`. It does not stream " +
      "during a build and is not expected to. Mid-session these copies reflect the last handoff.",
  );
  L.push("");
  /*
   * g12 (2026-08-17): THE INSTANT COULD FAIL THE PROJECT'S OWN DATE GATE.
   *
   * R18 made this instant Eastern deliberately, and that stays. But Eastern
   * runs three hours ahead of Phoenix, so any handoff after 21:00 local writes
   * an instant whose DATE is tomorrow — g11's run stamped
   * `2026-08-18 00:03:24 EDT` on the session day 2026-08-17. `tests/doc-dates`
   * scans every `docs/*.md` for dates ahead of the Phoenix clock and correctly
   * called that a future date, so the suite went red on a document the handoff
   * itself had just written, for a timestamp that was not wrong.
   *
   * It is annotated rather than changed, because the instant is TRUE and the
   * gate is RIGHT: this is exactly the case the expected-future marker exists
   * for. The marker is emitted only when the two zones actually disagree — an
   * annotation on a date that is not in the future would be noise, and the
   * next reader would not know which kind of claim it was.
   */
  const easternDay = generatedAt.slice(0, 10);
  const zoneNote =
    easternDay > stampedToday
      ? ` <!-- expected-future: the generated-at instant is America/New_York (R18) and the session day is America/Phoenix; after 21:00 local the Eastern date is the next day. Verified against \`pnpm stamp\`, which printed ${stampedToday}. -->`
      : "";
  L.push(
    `- Mirrored on: **${stampedToday}** (\`pnpm stamp\`, America/Phoenix); instant \`${generatedAt}\`${zoneNote}`,
  );
  L.push(`- Repository commit at mirror time: \`${headSha ?? "unknown — git could not be read"}\``);
  L.push(`- Files mirrored: **${kept.length}**; refused: **${skipped.length}**; removed this run: **${removed.length}**`);
  L.push(`- Total mirrored payload: **${totalBytes} bytes** (cap ${MAX_TOTAL_BYTES}); per-file cap ${MAX_FILE_BYTES} bytes`);
  L.push(`- Allowlist: \`${ALLOWLIST_PATH}\`${seededOn ? ` (seeded ${seededOn})` : ""} — nothing is mirrored that is not named there`);
  L.push("");
  L.push("## Drive file IDs");
  L.push("");
  if (idMap.verifiedOn) {
    L.push(
      `Recorded in \`${ID_MAP_PATH}\`, last verified against the folder's live contents on **${idMap.verifiedOn}**. ` +
        "IDs are not re-verified by `handoff` itself: the mirror is a filesystem copy into a Drive for Desktop " +
        "folder and this machine has no Drive API access, so every write here is by PATH and never by ID. " +
        "Writing to a wrong ID is therefore not a failure mode of the copy — it is one of the ID record, and " +
        "that is what the verification step checks.",
    );
  } else {
    L.push(
      `No IDs recorded yet in \`${ID_MAP_PATH}\`. Drive assigns an ID after it syncs a newly created file, ` +
        "so files first mirrored in this run have no ID until the next verification pass. " +
        "A blank ID below means **not yet recorded**, never **no such file**.",
    );
  }
  L.push("");
  L.push("## Mirrored");
  L.push("");
  L.push("| repo path | drive file id | bytes | sha256[:12] |");
  L.push("| --- | --- | --- | --- |");
  for (const r of kept) {
    const id = r.driveId
      ? (r.previousDriveId
          ? `\`${r.driveId}\` (**changed** from \`${r.previousDriveId}\` on ${r.idChangedOn ?? "an unrecorded date"})`
          : `\`${r.driveId}\``)
      : "_not yet recorded_";
    L.push(`| \`${r.repoPath}\` | ${id} | ${r.bytes} | \`${r.sha12}\` |`);
  }
  L.push("");

  L.push("## Refused");
  L.push("");
  if (skipped.length === 0) {
    L.push("Nothing was refused this run. Every path in the allowlist was mirrored.");
  } else {
    L.push(
      "A refused file stays listed here with its reason. It never simply disappears from the manifest — " +
        "a missing row and a refused row would otherwise read the same, and only one of them is a finding.",
    );
    L.push("");
    L.push("| repo path | reason |");
    L.push("| --- | --- |");
    for (const r of skipped) L.push(`| \`${r.repoPath}\` | ${r.reason} |`);
  }
  L.push("");

  L.push("## Removed from Drive this run");
  L.push("");
  if (removed.length === 0) {
    L.push("Nothing was removed.");
  } else {
    for (const name of removed) {
      L.push(`- \`${name}\` — struck from the allowlist, deleted from the folder`);
    }
  }
  L.push("");

  L.push("## Why each file is here");
  L.push("");
  for (const r of kept) {
    L.push(`- \`${r.repoPath}\` — ${r.why || "no reason recorded in the allowlist"}`);
  }
  L.push("");
  return L.join("\n");
}
