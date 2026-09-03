/**
 * `pnpm acquire:az-sos-candidates` — **ACQUIRE THE ARIZONA SECRETARY OF STATE'S
 * 2026 CANDIDATE FILING LIST AS A CORPUS.**
 * (Session C final, lane 1, 2026-09-01. RULING 205, RULING 229.)
 *
 * ```
 *   pnpm acquire:az-sos-candidates                write the corpus from the live document
 *   pnpm acquire:az-sos-candidates --dry          fetch, parse, print, write nothing
 *   pnpm acquire:az-sos-candidates --fixture      parse the committed fixture, no network
 * ```
 *
 * ## What this closes
 *
 * `data/states/az/jurisdictions/az.json` carried
 * `BALLOT_AND_CANDIDATES:STATEWIDE:arizona-secretary-of-state` as
 * `DISCOVERY_OWED`, owed: *"acquire the Secretary of State's full 2026
 * candidate-filing list as DATA. The 2026 filings PDF was read for the Pima
 * projection only; the statewide list is the acquisition denominator and is not
 * held as a corpus."* This is that acquisition.
 *
 * ## `@freshness-reads-here` — RULING 107
 *
 * `retrievedAt` is stamped from the clock at the moment `fetchFilingList`
 * returns, in the same expression as the retrieval it describes, and it is
 * carried into the corpus and the fixture's retrieval record together with the
 * HTTP status, the byte count, the `last-modified` header and the sha256 of the
 * bytes. This file IS the reading path, which is the rule being obeyed rather
 * than an exemption from it. `--fixture` stamps NOTHING: it reads the recorded
 * retrieval back and refuses to run if the bytes on disk no longer hash to it.
 *
 * ## The held population is OFFERED to the normalizer, never merged after
 *
 * `data/states/az/ballot/az-pima-2026.json` is passed in so the name join happens while
 * the corpus is being built. Every enrichment finding this project holds is
 * keyed to those 55 candidacies; a corpus that minted its own splits would give
 * one person two canonical identities and the enrichment scheduler would hunt
 * a campaign site we already have. The join is exact-form only — see
 * `lib/sources/az-sos-candidate-filings/index.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildCorpusDocument,
  extractFilingRows,
  fetchFilingList,
  FILING_LIST_URL,
  upsertCorpus,
  type FetchedDocument,
  type HeldCandidacy,
  normalizeFilingRows,
} from "../lib/sources/az-sos-candidate-filings/index.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const DRY = process.argv.includes("--dry");
const FIXTURE = process.argv.includes("--fixture");
const GENERATOR = "scripts/acquire-az-sos-candidate-filings.mts";

/** The committed copy, so the parse is reproducible with no network at all. */
const FIXTURE_PATH = join(ROOT, "tests", "fixtures", "az-sos-2026-candidate-filings.pdf");
const FIXTURE_META = join(ROOT, "tests", "fixtures", "az-sos-2026-candidate-filings.retrieval.json");

/** The held Arizona candidacies, offered to the name join. */
function heldCandidacies(): HeldCandidacy[] {
  const path = join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json");
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    contests: { id: string; ocdId: string; title: string; type: string }[];
    candidacies: { id: string; contestId: string; familyName: string; givenName: string }[];
  };
  const byId = new Map(doc.contests.map((c) => [c.id, c]));
  const out: HeldCandidacy[] = [];
  for (const cand of doc.candidacies) {
    const contest = byId.get(cand.contestId);
    if (!contest) continue;
    out.push({
      id: cand.id,
      ocdId: contest.ocdId,
      officeTitle: contest.title,
      familyName: cand.familyName,
      givenName: cand.givenName,
    });
  }
  if (out.length === 0) {
    throw new Error(
      "data/states/az/ballot/az-pima-2026.json offered ZERO held candidacies. That is a failed read of the " +
        "held population, not a ballot with nobody on it, and continuing would mint a second " +
        "canonical identity for every candidate this project already knows.",
    );
  }
  return out;
}

async function acquire(): Promise<FetchedDocument> {
  if (FIXTURE) {
    if (!existsSync(FIXTURE_PATH)) {
      throw new Error(`--fixture: ${FIXTURE_PATH} is absent. Run without --fixture to acquire it.`);
    }
    const meta = JSON.parse(readFileSync(FIXTURE_META, "utf8")) as Omit<FetchedDocument, "bytes">;
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH));
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== meta.sha256) {
      throw new Error(
        `--fixture: ${FIXTURE_PATH} hashes ${sha256}, but its recorded retrieval says ${meta.sha256}. ` +
          "The bytes on disk are not the bytes that were retrieved, and a corpus built from them " +
          "would cite a document nobody read.",
      );
    }
    console.log(`  fixture   ${FIXTURE_PATH}`);
    console.log(`            retrieved ${meta.retrievedAt}, ${meta.byteLength} B, sha256 ${sha256}`);
    return { ...meta, bytes };
  }
  console.log(`  GET       ${FILING_LIST_URL}`);
  const doc = await fetchFilingList({ retrievedAt: new Date().toISOString() });
  console.log(
    `            HTTP ${doc.httpStatus}, ${doc.byteLength} B, ${doc.contentType ?? "no content-type"}`,
  );
  console.log(`            last-modified ${doc.lastModified ?? "not stated"} · sha256 ${doc.sha256}`);
  /* The retrieval record travels with the bytes. A fixture without it is a PDF
     nobody can say where they got. */
  const { bytes: _drop, ...meta } = doc;
  writeFileSync(FIXTURE_PATH, doc.bytes);
  writeFileSync(FIXTURE_META, `${JSON.stringify(meta, null, 1)}\n`, "utf8");
  console.log(`            vaulted   ${FIXTURE_PATH}`);
  return doc;
}

console.log(`acquire:az-sos-candidates · cycle 2026, as of ${AS_OF}\n`);

const document = await acquire();
const { rows, reconciliation } = await extractFilingRows(document.bytes, document.url);

console.log(
  `\n  extraction  positional ${reconciliation.positionalRows} · textual ${reconciliation.textualRows} · ` +
    `${reconciliation.agree ? "AGREE" : "DISAGREE"} over ${reconciliation.pages} page(s), ` +
    `${reconciliation.headerRowsRemoved} header row(s) removed`,
);

const held = heldCandidacies();
const normalized = normalizeFilingRows({
  rows,
  reconciliation,
  sourceUrl: document.url,
  collectedAt: AS_OF,
  held,
});

console.log(
  `  name join   ${normalized.nameJoin.joined} of ${normalized.nameJoin.heldCandidaciesOffered} held ` +
    `candidacies joined by EXACT name form · ${normalized.nameJoin.joinedUnderADifferentSplit} of them ` +
    "under a family/given split the two authorities disagree on",
);
for (const c of normalized.candidacies) {
  const join = c.heldIdentityJoin;
  if (!join) continue;
  /* The Secretary printed `Family, Given`; the held ballot split it elsewhere.
     Both strings are printed so the join is read rather than trusted. */
  if (c.publishedName !== `${c.familyName}, ${c.givenName}`) {
    console.log(
      `      SOS "${c.publishedName}"  <->  held "${join.heldPublishedName}"  ` +
        `via ${join.rule} on "${join.matchedForm}"`,
    );
  }
}
const unjoinedHeld = held.filter(
  (h) => !normalized.candidacies.some((c) => c.heldIdentityJoin?.heldCandidacyId === h.id),
);
if (unjoinedHeld.length > 0) {
  console.log(
    `  NOT ON THE FILING LIST — ${unjoinedHeld.length} held candidac(ies) the Secretary's PARTISAN ` +
      "filing list does not carry. That is a fact about THIS DOCUMENT, never about the ballot:",
  );
  for (const h of unjoinedHeld) console.log(`      ${h.givenName} ${h.familyName} — ${h.officeTitle}`);
}

/*
 * THE DENOMINATOR FLOORS (RULING 159). Every number below is a count over a
 * population, and a population that came back empty is a FAILED READ of the
 * Secretary's document rather than a measurement of Arizona.
 */
console.log(
  `\n  ${floorLine(
    floored(
      "filing rows carried into the corpus",
      "the Secretary of State's 2026 partisan candidate filing list",
      reconciliation.positionalRows,
      normalized.candidacies.length,
      "the filing list produced no rows at all",
    ),
  )}`,
);
console.log(
  `  ${floorLine(
    floored(
      "contests named by the Secretary",
      "the contests appearing on the filing list",
      normalized.contests.length,
      normalized.contests.length,
      "the filing list named no contests",
    ),
  )}`,
);

const federal = normalized.contests.filter((c) => c.level === "FEDERAL").length;
console.log(
  `  contests    ${normalized.contests.length} (${federal} federal, ${normalized.contests.length - federal} state)`,
);

const corpus = buildCorpusDocument({
  document,
  normalized,
  generatedBy: GENERATOR,
  generatedOn: AS_OF,
});

if (DRY) {
  console.log("\n  --dry: nothing written.\n");
} else {
  const written = await upsertCorpus(corpus, ROOT);
  console.log(`\n  wrote ${written.path} (${written.bytes} B)\n`);
  console.log(
    "  NEXT: `pnpm candidates:universe` re-derives the acquisition denominator from every committed\n" +
      "  source, and this corpus is now one of them.\n",
  );
}
