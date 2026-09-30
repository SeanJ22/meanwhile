/**
 * **THE REGISTER OF GENERATED ARTIFACTS.**
 *
 * Lifted out of `tests/generated-artifacts.test.ts` on 2026-08-23 (RULING 102)
 * so that the guard and the regeneration tool read the SAME list. Two copies of
 * one register is how five scripts came to be unaccounted for in the browser
 * census, and it is not a mistake worth making twice.
 *
 * **RULING 92** says fix the generator, never the artifact. **RULING 102** adds
 * the completion condition it never had: each row's generator SOURCE is
 * digested into `tests/generator-digests.json`, and a generator whose digest
 * has moved fails the build until `pnpm regen` regenerates its artifact and
 * records the new digest. The machinery is `lib/ops/generator-digest.ts`.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface GeneratedArtifact {
  /** Repo-relative path of the committed output. */
  path: string;
  /** The command that writes it. A reader must be able to run this verbatim. */
  command: string;
  /**
   * True when every input is committed, so the output is reproducible and the
   * guard re-runs it. False for a generator that reads the network or a clock.
   */
  pure: boolean;
  /** Why it is not pure, when it is not. Stated rather than implied. */
  impurity?: string;
  /** A read-only freshness check for a generator that checks its whole output set. */
  checkCommand?: string;
}

/**
 * **The register.** Adding a generator means adding a row here, in the same
 * commit — the same discipline `tests/guard-census.json` applies to guards.
 */
export const GENERATED: GeneratedArtifact[] = [
  {
    path: "lib/control-plane/expansion/reference/census-dependent-school-territories.json",
    command: "corepack pnpm territory:dependent-schools",
    pure: true,
  },
  {
    path: "lib/control-plane/expansion/reference/census-school-intersections.json",
    command: "corepack pnpm territory:school-observations --evidence-root=../meanwhile-evidence/85635-preparation-20260925 --zip=85635 --stamp=20260926",
    pure: false,
    impurity: "Reuses retained full Census response and GEOS area receipts outside the repository; the ZIP, observation date and evidence directory must identify the source observation being imported.",
  },
  ...readdirSync(fileURLToPath(new URL("../../docs/states/", import.meta.url)))
    .filter((name) => /^[a-z]{2}\.md$/.test(name)).sort().map((name) => ({
      path: `docs/states/${name}`,
      command: "corepack pnpm state-manifest",
      checkCommand: "corepack pnpm state-manifest --check",
      pure: true,
    })),
  {
    path: "docs/branch-manifest.md",
    command: "corepack pnpm manifest:doc",
    pure: true,
  },
  {
    /*
     * AGENTS.md's project-law portion is a byte-exact mirror of CLAUDE.md
     * (provider transition, 2026-09-02; lib/ops/agents-mirror.mjs). A coding
     * agent that is not Claude Code reads AGENTS.md first, so the constitution
     * travels there mechanically rather than by a second hand-written copy —
     * the shape that once let docs/rulings.md diverge from CLAUDE.md on 87 of
     * 90 rulings. The generator preserves the Next.js-owned block and never
     * invents it. Pure: it reads CLAUDE.md and the existing AGENTS.md, nothing
     * else.
     */
    path: "AGENTS.md",
    command: "corepack pnpm agents:sync",
    pure: true,
  },
  {
    /*
     * The governance views (2026-08-26, the governance remediation).
     *
     * `docs/rulings.md` STOPPED BEING AN AUTHORITY on this date. It was a
     * second hand-maintained record of decisions, written by hand in the same
     * session that wrote them into `CLAUDE.md`, with nothing checking that the
     * two agreed — and measured on migration, 87 of the 90 rulings held in both
     * files had DIVERGED, with 697 substantial sentences living only in one and
     * 699 only in the other.
     *
     * It is generated now, from `docs/governance/ledger.jsonl`, and kept so
     * every `RULING n` reference in this repository still resolves. Since
     * 2026-09-25 it is written to `docs/governance/rulings-index.md`:
     * `docs/rulings.md` now holds Sean's adopted standing decisions and is
     * not generated.
     *
     * Pure: after the 2026-09-03 cutover the compiler reads the committed
     * ledger and nothing else — no overlay module, no clock, no network — and
     * never writes the ledger back.
     */
    path: "docs/governance/rulings-index.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/history.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    /*
     * The autonomous-system brief. Since 2026-09-25 it is `docs/rulings.md`
     * (Sean's standing decisions) verbatim under a fixed header, so autonomous
     * briefs follow the same decisions as Claude and Codex. Pure: it reads the
     * committed `docs/rulings.md` and nothing else, so an edit to that file
     * without a recompile shows here as a stale artifact.
     */
    path: "docs/governance/constitution.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/current-decisions.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/index.json",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  /*
   * The nine domain policy modules. Each is a VIEW of the current law for one
   * domain, generated from the ledger — never a second copy somebody
   * maintains, which is what makes "one canonical source per rule" checkable
   * rather than aspirational.
   *
   * Registered individually rather than by prefix so that a policy which stops
   * being generated, or one that appears without a generator, is a diff.
   */
  {
    path: "docs/governance/policies/discovery.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/rendering-neutrality.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/data-privacy.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/sources-licensing.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/shipping-ci.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/tracker-workflow.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/visual-feedback.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/business.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    path: "docs/governance/policies/meta-governance.md",
    command: "corepack pnpm governance:compile",
    pure: true,
  },
  {
    /*
     * The question set as a document (2026-08-23, the questionnaire brief).
     * A HAND-WRITTEN copy of the questions is a second copy that can disagree
     * with the one candidates are actually asked, which is the drift the
     * constitution names when it says a stale copy is worse than a short one.
     * Pure: it reads `lib/questionnaire/instrument.ts` and nothing else.
     */
    path: "docs/candidate-questionnaire.md",
    command: "corepack pnpm questionnaire:doc --write",
    pure: true,
  },
  {
    /*
     * **Registered 2026-08-23 (item 2), and it was generated all along.**
     *
     * `pnpm schools:classify` writes the INDEPENDENT / DEPENDENT stamp every
     * school-district card's class definition is chosen from. It was not in
     * this register, so RULING 102's digest never watched it — and item 2
     * rewrote its generator wholesale, replacing an intersection lookup that
     * had been returning `UNCLASSIFIED` for 219 of 514 districts. That is
     * exactly the event the digest exists to catch: a generator moves and its
     * committed output silently does not.
     *
     * Pure: both Census files and the crosswalk are committed, so it reads no
     * network and no clock beyond `pnpm stamp`'s date.
     */
    path: "data/derived/school-district-dependency.json",
    command: "corepack pnpm schools:classify",
    pure: true,
  },
  {
    /*
     * The form stamp (2026-08-23, the questionnaire brief item 3). Pure: it
     * reads the committed registry, TIGER's legal type codes and the committed
     * Census school-dependency stamp. No network, no clock, no statute read.
     */
    path: "data/derived/body-forms.json",
    command: "corepack pnpm forms:stamp --write",
    pure: true,
  },
  {
    /*
     * The class-stamp sweep (`NH106`, 2026-08-23, RULING 114). Pure: it reads
     * the committed stamp file, the committed registry and the committed 2022
     * Census of Governments roster. No network and no clock — the date is
     * passed in from `pnpm stamp`.
     *
     * Registered here rather than merely runnable, because
     * `tests/class-stamp-sweep.test.ts` asserts against the ARTIFACT. Without
     * a digest on the sweep's own source, an edit to the comparison logic
     * would leave the suite grading a verdict the current code no longer
     * produces — a guard checking a stale answer, which reads green.
     */
    path: "data/derived/class-stamp-sweep.json",
    command: "corepack pnpm class:sweep",
    pure: true,
  },
  {
    path: "lib/registry/rosters-nj-morris.ts",
    command: "corepack pnpm nj:wire",
    pure: true,
  },
  {
    /*
     * **NH232, 2026-08-27.** This file was generated for its whole life and was
     * never registered here, and the two facts are the same fact: nothing
     * checked that its generator owned it, so three other scripts appended to
     * it in place. `pnpm registry:build` then deleted 731 verified bodies —
     * every lead-promoted and census-gap-promoted row, which IS the coverage
     * numerator the governance snapshot reports — and no check went red.
     *
     * Registering it closes the second half of that hole. `pnpm regen` now
     * notices when the generator moves and the artifact does not; the first
     * time it ran after this repair it found the registry already stale against
     * RULING 121, still carrying two duplicate rows for bodies that had been
     * collapsed into `alsoServesOcdIds` a week earlier.
     *
     * The ownership half lives in `tests/registry-ownership.test.ts`, which is
     * the guard that fails if any path other than the generator writes it.
     */
    /*
     * **NH233, registered the same day it was created.** The whole lesson of
     * NH232 one row above is that a generated artifact nobody registered is an
     * artifact three scripts can write; this one is registered before anything
     * else can reach it.
     */
    path: "data/states/az/geo/body-territories.geojson",
    command: "corepack pnpm cfd:territory --geojson data/states/az/geo/body-territories.geojson",
    pure: false,
    impurity:
      "reads Pima County's ArcGIS Subdivisions layer for the recorded plat polygons and the Census " +
      "Bureau's TIGERweb ZCTA service to point-test them. Both are live services, and the county " +
      "re-recording a plat is a real change this artifact should pick up.",
  },
  {
    path: "data/states/nj/hunt/nj-morris-municipal-sites.json",
    command: "corepack pnpm nj:rosters --index",
    pure: false,
    impurity:
      "reads the county's Cities-and-Towns page over the network. THE ARTIFACT THIS " +
      "GUARD WAS BUILT OVER: it sat five municipalities deep in wrong governments while " +
      "its generator had already been fixed.",
  },
  {
    path: "data/states/nj/hunt/muni-sites-nj-morris.json",
    command:
      "corepack pnpm muni:sites --wiki data/states/nj/hunt/wikipedia-nj-morris.json " +
      "--state-directory data/hunt/tier-directories.json --county data/states/nj/hunt/nj-morris-municipal-sites.json " +
      "--out data/states/nj/hunt/muni-sites-nj-morris.json",
    pure: false,
    impurity: "control-checks every candidate URL live — a municipality's site may move or refuse",
  },
  {
    path: "data/states/nj/hunt/roster-pages-muni-sites-nj-morris.json",
    command: "corepack pnpm roster:hunt --index data/states/nj/hunt/muni-sites-nj-morris.json",
    pure: false,
    impurity: "walks each body's own site — the roster changes when the body changes",
  },
  {
    path: "data/hunt/tier-directories.json",
    command: "corepack pnpm tier:directory",
    pure: false,
    impurity: "walks USA.gov and the state directories live",
  },
  {
    path: "data/states/nj/hunt/nj-morris-certified-winners.json",
    command: "corepack pnpm nj:winners",
    pure: false,
    impurity: "fetches the county clerk's certified PDFs; a new cycle adds a document",
  },
  {
    path: "data/states/nj/hunt/wikipedia-nj-morris.json",
    command: "corepack pnpm wiki:muni --state NJ --county Morris --confirm",
    pure: false,
    impurity: "reads the encyclopedia and fetches every citation — both move",
  },
  {
    path: "docs/evidence/njhunt6-morris-rosters.jsonl",
    command: "corepack pnpm nj:wire",
    pure: false,
    impurity:
      "a retrieval ledger records the bytes a body sent on a DATE. Regenerating it from " +
      "today's artifacts is correct; demanding byte-equality with a past walk is not.",
  },
  {
    /*
     * **Registered 2026-08-30, the same commit that created it** (Session A,
     * Work Item 6 — the status-generation ruling: status is GENERATED, never
     * asserted). The hand-written current-status surfaces in docs/state.md §2,
     * §3 and §7 retired into this ledger the same day.
     */
    path: "docs/status-ledger.md",
    command: "corepack pnpm status:ledger",
    pure: false,
    impurity:
      "reads HEAD SHA and the wall clock for its generated-at stamp; the carried-stamp rule " +
      "keeps it idempotent when the rendered body is unchanged, so only a changed body earns " +
      "a fresh stamp.",
  },
  {
    /*
     * **Registered 2026-08-30, the same commit that created it** (Session A,
     * Work Item 7). The mechanical repo inventory, joined to the Drive mirror
     * via scripts/mirror-set.mjs.
     */
    path: "docs/repo-inventory.md",
    command: "corepack pnpm repo-map",
    pure: false,
    impurity:
      "reads Git's would-be-committed file list; output depends only on those paths, " +
      "so content edits, new commits and elapsed time leave the inventory unchanged.",
  },
];

/** Where the recorded generator digests live. Repo-relative. */
export const DIGEST_FILE = "tests/generator-digests.json";

export interface DigestRecord {
  /** sha256 of the generator's whole source closure at the last regeneration. */
  digest: string;
  /** How many files were in that closure — a census, so a collapsed walk shows. */
  files: number;
  /** The entry script, so a reader can see what was digested. */
  entry: string;
  /** The date the artifact was last regenerated, from `pnpm stamp`. */
  regeneratedOn: string;
}

export type DigestFile = Record<string, DigestRecord>;
