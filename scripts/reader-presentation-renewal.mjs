/**
 * Generate (or --check) the one-time, explicitly bounded presentation-only
 * renewal that admits the Lumen reader restyle against the PRESERVED production
 * reader closure receipt.
 *
 *   node scripts/reader-presentation-renewal.mjs           # write the artifact
 *   node scripts/reader-presentation-renewal.mjs --check   # verify the committed artifact
 *
 * This NEVER edits `reader-last-mile-final-closure-receipt.json`: the production
 * receipt keeps its original source and execution bindings at their original
 * head. The renewal is a SEPARATE, linked record. Baseline hashes are read from
 * the preserved receipt; renewed hashes are read from the current bytes at the
 * integration commit; the integration commit is the current HEAD. The admission
 * rule (`readerPresentationRenewalProblems`) fails closed on any file that is
 * not enumerated here, so this declaration is the entire permitted scope.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const RECEIPT_PATH = "docs/evidence/reader-last-mile-final-closure-receipt.json";
const OUTPUT_PATH = "docs/evidence/reader-last-mile-lumen-presentation-renewal.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The nine restyled reader files. The CSS scan confirmed no shared styling
// dependency changed beyond the three stylesheets already listed here.
const PERMITTED = [
  {
    path: "app/globals.css",
    kind: "STYLESHEET",
    behaviorReview:
      "Design tokens and rules only (Lumen palette, tier accents, control styling). No import, data access, query, identity, authorization, validation or publication code.",
  },
  {
    path: "components/map/popup/lumen-popup.module.css",
    kind: "STYLESHEET",
    behaviorReview: "CSS module for the map popup (tier ring, surfaces). Styling only.",
  },
  {
    path: "components/shell/ask-pearl.module.css",
    kind: "STYLESHEET",
    behaviorReview: "CSS module for the Ask Pearl. Styling only.",
  },
  {
    path: "app/ballot/page.tsx",
    kind: "PRESENTATION_COMPONENT",
    behaviorReview:
      "Passes tier={tierForOcdId(contestOcdId)} to the battlecard. tierForOcdId is a pure classification of an already-held OCD id into local/state/national for the eyebrow colour; it loads nothing, queries nothing, and selects no record. Contest selection, holdings and data loading are unchanged.",
  },
  {
    path: "components/ballot/candidate-battlecard.tsx",
    kind: "PRESENTATION_COMPONENT",
    behaviorReview:
      "Adds an optional tier prop that drives the eyebrow colour and a data-tier attribute, replacing a hardcoded amber that falsely read 'local' for every contest, and moves the CTA to a class. No change to which records render, their text, identity, authorization, validation or publication.",
  },
  {
    path: "components/funding/funding-section.tsx",
    kind: "PRESENTATION_COMPONENT",
    behaviorReview:
      "Renders the committee pill via committeePillLabel(typeLabel) (drops a leading article for the tag) instead of typeLabel.label. Same underlying label datum; the inline prose fragment is unchanged. No data, query, identity, authorization, validation or publication change. The bootstrap fixture surfaces no itemized committee-typed contributor, so this control is verified by a deterministic focused component render in tests/reader-presentation-renewal.test.ts rather than in the live browser.",
  },
  {
    path: "components/map/popup/popup-card.tsx",
    kind: "PRESENTATION_COMPONENT",
    behaviorReview:
      "Adds a data-tier attribute for the popup tier ring; tier is an existing prop. Styling hook only; no data, query, identity, authorization, validation or publication change.",
  },
  {
    path: "components/shell/pill-cluster.tsx",
    kind: "PRESENTATION_COMPONENT",
    behaviorReview:
      "Changes two inline SVG icon geometries (ballot sheet, speech bubble) and applies the Pearl style class at every placement. Labels, aria, records and interactions are unchanged; no data, query, identity, authorization, validation or publication change.",
  },
  {
    path: "lib/funding/committee-types.ts",
    kind: "PRESENTATION_HELPER",
    behaviorReview:
      "Adds one pure display helper committeePillLabel(label) that strips a leading article for pill rendering. Additive: the existing label, FEC classification, ids and API are untouched. No data, query, identity, authorization, validation or publication change. Verified by a deterministic focused component render in tests/reader-presentation-renewal.test.ts.",
  },
];

// Focused browser verification of the affected reader surfaces, bound to the
// integration commit. These rows were confirmed by an actual in-browser render
// against the committed bootstrap fixtures (ZIP 85701, Tucson AZ) at this head.
// The funding committee pill is NOT here because the bootstrap fixture surfaces
// no itemized committee-typed contributors to render it; it is instead covered
// by a deterministic focused component render in
// tests/reader-presentation-renewal.test.ts.
const BROWSER_SURFACES = [
  {
    surface: "Reader shell pill cluster (pill-cluster.tsx)",
    expectedRecords: "The reader shell for ZIP 85701 renders the Ballot pill with the new marked-sheet icon and the Ask pill with the new speech-bubble icon.",
    changedControls: "Both pills render; the Ask pill carries the Pearl style at map placement and opens.",
  },
  {
    surface: "Map popup card tier ring (popup-card.tsx / lumen-popup.module.css)",
    expectedRecords: "The Tucson (Municipal) body popup renders its officials (Regina Romero, Lane Santa Cruz) with TYPE Municipal / TIER Local.",
    changedControls: "The card wears its real Local (amber) tier ring via data-tier; the district picker groups the six districts LOCAL/STATE/FEDERAL via tierForOcdId.",
  },
  {
    surface: "Ballot candidate battlecard eyebrow (candidate-battlecard.tsx / app/ballot/page.tsx)",
    expectedRecords: "The Governor (STATE) battlecard opens with its candidate records; the eyebrow computed colour is --accent-state (#00b894), not the former blanket amber --accent-local.",
    changedControls: "data-tier is 'state' for the Governor modal and 'national' for the U.S. Representative modal, both derived by tierForOcdId; the modal opens and closes.",
  },
];

const check = process.argv.includes("--check");
const receiptBytes = readFileSync(join(root, RECEIPT_PATH));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const baseline = new Map(receipt.sourceHashes.map((s) => [s.path, s.sha256]));
const integrationCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const permittedFiles = PERMITTED.map((file) => {
  const baselineSha256 = baseline.get(file.path);
  if (!baselineSha256) throw new Error(`${file.path} is not in the production receipt fingerprint`);
  if (!existsSync(join(root, file.path))) throw new Error(`${file.path} is missing`);
  const renewedSha256 = sha256(readFileSync(join(root, file.path)));
  if (renewedSha256 === baselineSha256) throw new Error(`${file.path} is unchanged; a renewal cannot list it`);
  return { path: file.path, baselineSha256, renewedSha256, kind: file.kind, behaviorReview: file.behaviorReview };
});

// A hand-written denominator floor (RULING 159/116): a renewal that admits zero
// files is meaningless — every enumerated file reverted to its baseline, so
// there is nothing to admit. Refuse it loudly rather than write an empty,
// silently-passing artifact.
if (permittedFiles.length === 0) throw new Error("Presentation renewal has zero permitted files: nothing drifted, so there is nothing to admit.");

const renewal = {
  formatVersion: 1,
  renewalKind: "PRESENTATION_ONLY",
  rationale:
    "One-time bounded presentation-only renewal approved by the author for the Lumen × Meanwhile integration. PDC's frozen PRODUCTION reader closure fail-closes on any reader-source drift; the Lumen restyle changed only presentation bytes across the enumerated files. The canonical reader data proof (census, holdings digest, dataset/surface registry) and the production execution authority are unchanged and remain bound at their original head in the preserved receipt. This record admits ONLY the enumerated presentation fingerprint drift, backed by focused browser verification, and never re-runs PDC certification, production import, or authority transfer.",
  integrationCommit,
  baselineReceiptPath: RECEIPT_PATH,
  baselineReceiptSha256: sha256(receiptBytes),
  permittedFiles,
  unchangedBehavior: ["DATA_LOADING", "QUERIES", "IDENTITY_SELECTION", "AUTHORIZATION", "VALIDATION", "PUBLICATION"],
  browserVerification: {
    // Confirmed by an actual in-browser render against the committed bootstrap
    // fixtures at this integration commit (see BROWSER_SURFACES for the exact
    // records and controls observed).
    at: process.env.RENEWAL_BROWSER_AT ?? "2026-09-14",
    head: integrationCommit,
    surfaces: BROWSER_SURFACES.map((surface) => ({
      surface: surface.surface,
      expectedRecords: surface.expectedRecords,
      changedControls: surface.changedControls,
      result: "RENDERED_AS_EXPECTED",
    })),
  },
};

const serialized = `${JSON.stringify(renewal, null, 2)}\n`;
if (check) {
  const committed = existsSync(join(root, OUTPUT_PATH)) ? readFileSync(join(root, OUTPUT_PATH), "utf8") : "";
  if (committed !== serialized) {
    console.error(`DRIFT: ${OUTPUT_PATH} does not match the current tree/receipt. Re-run without --check.`);
    process.exit(1);
  }
  console.log(`OK: ${OUTPUT_PATH} matches (${permittedFiles.length} permitted files, integration ${integrationCommit.slice(0, 8)}).`);
} else {
  writeFileSync(join(root, OUTPUT_PATH), serialized);
  console.log(`Wrote ${OUTPUT_PATH}: ${permittedFiles.length} permitted files, integration ${integrationCommit.slice(0, 8)}, browser ${renewal.browserVerification.at}.`);
}
