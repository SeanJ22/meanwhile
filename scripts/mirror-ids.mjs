/**
 * REFRESH THE DRIVE ID MAP — `pnpm mirror:ids <listing.json>`
 *
 * ## Why this is a separate command and not part of handoff
 *
 * `pnpm handoff` maintains the mirror with `copyFileSync` into a Google Drive
 * for Desktop folder. There is no Drive API in this repo and this script does
 * not add one — building API credentials into the repo to service a read path
 * for a reviewer would be a much larger security surface than the problem
 * deserves, and the brief said not to.
 *
 * So the ids come from whoever has live Drive access: the author, or a session
 * with the Drive connector attached. That party lists the folder and saves the
 * listing; this script merges it in, verifies it, and writes
 * `docs/mirror-code-ids.json`. Handoff only ever READS that file, which is also
 * what keeps handoff from dirtying the tree on every run.
 *
 * ## The listing it expects
 *
 * A JSON array of `{ id, title }` — exactly what the Drive `search_files`
 * response gives for `parentId = '<folder>'`, and again for the `code`
 * subfolder. Extra fields are ignored. Pass `--code` when the listing is the
 * code subfolder rather than the top-level document folder.
 *
 *   pnpm mirror:ids listing.json           # the ten documents
 *   pnpm mirror:ids listing.json --code    # the <mirror>/code/ subfolder
 *
 * ## The hard stop
 *
 * The brief asked that a recorded id which resolves to a DIFFERENT file be a
 * hard stop rather than a warning, because writing to it would overwrite an
 * unrelated file. This is where that check can actually mean something: the
 * copy in `mirror-code.mjs` addresses files by path and never by id, so it has
 * no way to mis-address a write, but a WRONG RECORD sends the reviewer to the
 * wrong file just as effectively. A mismatch exits non-zero and writes nothing
 * — a partially-corrected map is worse than a stale one, because it looks
 * fresh.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";
import { flatten, verifyIdMap, ID_MAP_PATH } from "./mirror-code.mjs";
import { MIRRORED_DOCS } from "./mirror-set.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2).filter((a) => a !== "--code");
const IS_CODE = process.argv.includes("--code");
const listingPath = args[0];

if (!listingPath) {
  console.error(
    "usage: pnpm mirror:ids <listing.json> [--code]\n" +
      "  listing.json is a JSON array of { id, title } read from LIVE Drive.",
  );
  process.exit(2);
}
if (!existsSync(listingPath)) {
  console.error(`listing not found: ${listingPath}`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(listingPath, "utf8"));
const listing = Array.isArray(raw) ? raw : (raw.files ?? []);
if (listing.length === 0) {
  // An operation that can return nothing must be asked what it returned. An
  // empty listing is not "the folder is empty" — far more often it is a query
  // that matched nothing, and adopting it would erase every recorded id.
  console.error(
    "the listing holds 0 entries — refusing to treat that as an empty folder. " +
      "Check the query before re-running.",
  );
  process.exit(1);
}

/** id → title, from the folder's LIVE contents. Never from the recorded map. */
const live = Object.fromEntries(listing.map((f) => [f.id, f.title]));

const mapPath = join(ROOT, ID_MAP_PATH);
const current = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, "utf8")) : {};
current.docs ??= {};
current.code ??= {};

const section = IS_CODE ? current.code : current.docs;
const verdict = verifyIdMap(section, live);

if (!verdict.safe) {
  console.error("\nHARD STOP — a recorded id resolves to a different file:\n");
  for (const m of verdict.mismatch) {
    console.error(`  ${m.key}`);
    console.error(`    recorded id ${m.id}`);
    console.error(`    expected    ${m.expected}`);
    console.error(`    resolves to ${m.actual}`);
  }
  console.error(
    "\nNothing was written. Correct the record by hand, or delete the offending " +
      "entries and re-run so they are re-learned from the live folder.\n",
  );
  process.exit(1);
}

/* ------------------------------------------------------------- merge in --- */

const byTitle = new Map(listing.map((f) => [f.title, f.id]));
const changed = [];
const learned = [];
const unmatched = [];

if (IS_CODE) {
  const allowlist = JSON.parse(readFileSync(join(ROOT, "docs/mirror-code.json"), "utf8"));
  const paths = (allowlist.files ?? []).map((e) => (typeof e === "string" ? e : e.path));
  for (const repoPath of paths) {
    const title = flatten(repoPath);
    const id = byTitle.get(title);
    if (!id) {
      unmatched.push(`${repoPath} (expected ${title})`);
      continue;
    }
    const prev = current.code[repoPath];
    const prevId = typeof prev === "string" ? prev : prev?.id;
    if (prevId && prevId !== id) {
      changed.push(`${repoPath}: ${prevId} -> ${id}`);
      current.code[repoPath] = { id, title, previousId: prevId, changedOn: today() };
    } else if (!prevId) {
      learned.push(repoPath);
      current.code[repoPath] = { id, title, recordedOn: today() };
    } else {
      current.code[repoPath] = { ...prev, id, title };
    }
  }
  // The manifest is mirrored beside the code and is worth an id of its own.
  const manifestId = byTitle.get("code-manifest.md");
  if (manifestId) current.code["docs/code-manifest.md"] = { id: manifestId, title: "code-manifest.md", recordedOn: today() };
} else {
  for (const doc of MIRRORED_DOCS) {
    const id = byTitle.get(doc.mirrorName);
    if (!id) {
      unmatched.push(doc.mirrorName);
      continue;
    }
    const prevId = current.docs[doc.mirrorName];
    if (prevId && prevId !== id) changed.push(`${doc.mirrorName}: ${prevId} -> ${id}`);
    else if (!prevId) learned.push(doc.mirrorName);
    current.docs[doc.mirrorName] = id;
  }
}

current.verifiedAgainstLiveDriveOn = today();

writeFileSync(mapPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

/* --------------------------------------------------------------- report --- */

const scope = IS_CODE ? "code" : "documents";
console.log(`\nmirror:ids — ${scope}\n`);
console.log(`  listing entries      ${listing.length}`);
console.log(`  ids verified         ${verdict.ok.length} resolve to the expected title`);
console.log(`  ids newly learned    ${learned.length}${learned.length ? ` — ${learned.join(", ")}` : ""}`);
console.log(`  ids CHANGED          ${changed.length}${changed.length ? ` — ${changed.join("; ")}` : ""}`);
console.log(`  recorded but gone    ${verdict.gone.length}${verdict.gone.length ? ` — ${verdict.gone.map((g) => g.key).join(", ")}` : ""}`);
console.log(
  `  expected, not found  ${unmatched.length}${unmatched.length ? ` — ${unmatched.join(", ")}` : ""}`,
);
console.log(`\n  written to ${ID_MAP_PATH}, verified ${today()}\n`);

// "Expected but not in the folder" is a real finding, not a clean run.
process.exit(unmatched.length > 0 ? 1 : 0);
