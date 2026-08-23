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
}

/**
 * **The register.** Adding a generator means adding a row here, in the same
 * commit — the same discipline `tests/guard-census.json` applies to guards.
 */
export const GENERATED: GeneratedArtifact[] = [
  {
    path: "docs/branch-manifest.md",
    command: "corepack pnpm manifest:doc",
    pure: true,
  },
  {
    path: "lib/registry/rosters-nj-morris.ts",
    command: "corepack pnpm nj:wire",
    pure: true,
  },
  {
    path: "data/hunt/nj-morris-municipal-sites.json",
    command: "corepack pnpm nj:rosters --index",
    pure: false,
    impurity:
      "reads the county's Cities-and-Towns page over the network. THE ARTIFACT THIS " +
      "GUARD WAS BUILT OVER: it sat five municipalities deep in wrong governments while " +
      "its generator had already been fixed.",
  },
  {
    path: "data/hunt/muni-sites-nj-morris.json",
    command:
      "corepack pnpm muni:sites --wiki data/hunt/wikipedia-nj-morris.json " +
      "--state-directory data/hunt/tier-directories.json --county data/hunt/nj-morris-municipal-sites.json " +
      "--out data/hunt/muni-sites-nj-morris.json",
    pure: false,
    impurity: "control-checks every candidate URL live — a municipality's site may move or refuse",
  },
  {
    path: "data/hunt/roster-pages-muni-sites-nj-morris.json",
    command: "corepack pnpm roster:hunt --index data/hunt/muni-sites-nj-morris.json",
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
    path: "data/hunt/nj-morris-certified-winners.json",
    command: "corepack pnpm nj:winners",
    pure: false,
    impurity: "fetches the county clerk's certified PDFs; a new cycle adds a document",
  },
  {
    path: "data/hunt/wikipedia-nj-morris.json",
    command: "corepack pnpm wiki:muni --state NJ --county Morris --confirm",
    pure: false,
    impurity: "reads the encyclopedia and fetches every citation — both move",
  },
  {
    /*
     * FOUND BY THIS GUARD ON ITS FIRST RUN — it declared itself generated and
     * was in no register, which is precisely the state a hand-edit becomes
     * permanent in.
     */
    path: "lib/officials/directory-source.ts",
    command: "corepack pnpm congress:migrate",
    pure: false,
    impurity:
      "pins a SHA of the unitedstates/congress-legislators repository and stamps the date it " +
      "was read; re-running it legitimately moves both.",
  },
  {
    path: "docs/evidence/njhunt6-morris-rosters.jsonl",
    command: "corepack pnpm nj:wire",
    pure: false,
    impurity:
      "a retrieval ledger records the bytes a body sent on a DATE. Regenerating it from " +
      "today's artifacts is correct; demanding byte-equality with a past walk is not.",
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
