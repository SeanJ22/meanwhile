/**
 * **THE SHIPPING INVARIANT — A DEPLOY MAY NOT CROSS ITS OWN MIGRATIONS.**
 * (2026-08-28, the P0 schema-drift incident. Intake tripwire run 33211710028.)
 *
 * ## What actually happened, stated once, here
 *
 * `0021_mixed_red_ghost` created `ask_interactions`. `0022_adorable_hemingway`
 * added five evidence columns to it. Both merged — `e937958` and `dcdaac4`,
 * two squash merges on 2026-08-28 — and both DEPLOYED. Production's schema was
 * never advanced, because **nothing in this repository has ever applied a
 * migration automatically.** `git log -S` over `.github/` and `netlify.toml`
 * across the whole history returns no commit that ever ran `db:apply`,
 * `drizzle-kit migrate` or `apply-migrations` in CI or in the deploy. Applying
 * has always been a person, at a terminal, remembering.
 *
 * The daily schema gate in `intake-tripwire.yml` caught it the next morning and
 * caught it correctly. **That is discovery after the fact.** It stays — it is
 * the only thing that can catch drift arising from outside a pull request — but
 * a defect found the morning after a deploy is a defect that shipped.
 *
 * ## What this module is
 *
 * Pure. No database, no network, no filesystem. It takes the committed journal,
 * the phase declaration, the `created_at` values production says it has
 * applied, and the migration tags this change introduces — and returns a
 * verdict naming every migration on the wrong side of the deploy.
 *
 * `scripts/db-shipping-gate.mts` supplies those four inputs and prints the
 * verdict; `tests/migration-shipping-invariant.test.ts` supplies them from
 * fixtures.
 *
 * ## BOTH ORDERINGS ARE EXPRESSED, and the unsafe one is what fails
 *
 * `lib/db/migration-phases.ts` carries the reasoning. In one line:
 *
 *   - an **EXPAND** migration MAY (and must) precede its code — an expand
 *     migration still pending at deploy time FAILS;
 *   - a **CONTRACT** migration may NOT precede its code — a contract migration
 *     introduced by this change and ALREADY APPLIED FAILS.
 *
 * A gate that assumed migrate-always-first would refuse the `0013`/`0014` pair
 * this repository split on purpose, so it is not assumed.
 *
 * ## AND IT ASKS THE DATABASE ONLY WHEN THE SCHEMA CONTRACT MOVED
 *
 * A docs-only change cannot make the deployed code disagree with the deployed
 * schema, and gating it on a database round trip would put a network call
 * between a typo fix and `main`. `schemaInvolvement` decides that from the
 * changed-path list alone — and an UNREADABLE path list is treated as involved,
 * because a check that cannot reach its subject must never behave like one that
 * did (RULING 24).
 */

import { compareSchemaState, type JournalEntry, type SchemaState } from "./schema-state.ts";
import {
  declaredPhase,
  PHASE_ORDERING,
  type MigrationPhase,
  type PhaseDeclaration,
} from "./migration-phases.ts";

/** When the gate is being asked. */
export type ShipMoment = "pre-deploy" | "post-deploy";

/**
 * Paths whose change means the schema contract itself moved.
 *
 * DELIBERATELY NARROW, and narrow in the direction that costs a round trip
 * rather than the one that skips it: `lib/db/migrations/` covers every
 * generated `.sql` and the journal, and `lib/db/schema.ts` is the declaration
 * they are generated from. A change to either is the only way a committed
 * migration can appear, disappear or change identity.
 */
export const SCHEMA_CONTRACT_PATHS: readonly { readonly prefix: string; readonly why: string }[] = [
  {
    prefix: "lib/db/migrations/",
    why: "The committed migrations and their journal. A migration can only enter or leave the shipping head through here.",
  },
  {
    prefix: "lib/db/schema.ts",
    why: "The Drizzle schema the migrations are generated from. A column added here without its migration is the 0011 shape.",
  },
];

export interface SchemaInvolvement {
  /** Does this change require asking production what it has applied? */
  readonly involved: boolean;
  /** True when the changed-path list could not be read at all. */
  readonly cannotTell: boolean;
  /** The changed paths that made it involved. */
  readonly paths: string[];
  /** One sentence for the log. */
  readonly reason: string;
}

const normalisePath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * Whether a change touches the schema contract.
 *
 * `changed` of `null` means the list could not be computed — NOT that nothing
 * changed. The two are kept apart, and `null` returns involved, so an
 * unreadable diff costs one database read rather than silently skipping the
 * only check that would have caught the incident.
 */
export function schemaInvolvement(changed: readonly string[] | null): SchemaInvolvement {
  if (changed === null) {
    return {
      involved: true,
      cannotTell: true,
      paths: [],
      reason:
        "the changed-path list could not be read, so whether the schema contract moved is UNKNOWN — " +
        "asking production is the answer to a question that cannot be answered locally",
    };
  }
  const paths = changed
    .map(normalisePath)
    .filter((p) => SCHEMA_CONTRACT_PATHS.some(({ prefix }) => (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix)));
  if (paths.length === 0) {
    return {
      involved: false,
      cannotTell: false,
      paths: [],
      reason: `none of the ${changed.length} changed path(s) touch the schema contract`,
    };
  }
  return {
    involved: true,
    cannotTell: false,
    paths,
    reason: `${paths.length} changed path(s) touch the schema contract`,
  };
}

/** The migration tags a changed-path list introduces or rewrites. */
export function migrationTagsIn(changed: readonly string[]): string[] {
  const tags = changed
    .map(normalisePath)
    .map((p) => /^lib\/db\/migrations\/([0-9]{4}_[A-Za-z0-9_]+)\.sql$/.exec(p)?.[1])
    .filter((t): t is string => typeof t === "string");
  return [...new Set(tags)].sort();
}

/** One committed migration, with everything the verdict needs to name it. */
export interface MigrationStanding {
  readonly tag: string;
  readonly when: number;
  readonly applied: boolean;
  readonly phase: MigrationPhase | null;
  readonly declaration: PhaseDeclaration | null;
  /** Introduced by the change being shipped. */
  readonly introduced: boolean;
}

export interface ShippingInvariantInput {
  readonly journal: readonly JournalEntry[];
  /** `created_at` values production reports, the same join key `db:check` uses. */
  readonly appliedWhen: readonly number[];
  /** Migration tags this change introduces. */
  readonly introduced: readonly string[];
  readonly moment: ShipMoment;
}

export interface ShippingInvariantVerdict {
  readonly verdict: "pass" | "fail";
  readonly moment: ShipMoment;
  /** The plain delta, unchanged from what `pnpm db:check` reports. */
  readonly delta: SchemaState;
  readonly standing: readonly MigrationStanding[];
  /** Committed migrations with no phase declaration at all. */
  readonly undeclared: string[];
  /** Expand migrations not yet on production. The deploy would outrun them. */
  readonly expandNotApplied: string[];
  /** Contract migrations from THIS change already applied. The unsafe ordering. */
  readonly contractAppliedEarly: string[];
  /** Contract migrations owed from an earlier deploy. Reported, not fatal here. */
  readonly contractOwed: string[];
  /** After the deploy, everything committed must be applied. */
  readonly notAppliedAfterDeploy: string[];
  /** One sentence per failure, each naming its migrations. */
  readonly failures: string[];
  readonly summary: string;
}

/**
 * The whole verdict, from the four inputs. No I/O.
 *
 * A migration with no declaration is never given a phase by default. Assuming
 * `expand` is what would order a contract migration ahead of its code, which is
 * the failure the phase declaration exists to prevent — so an undeclared
 * migration fails on its own and is left out of every phase bucket.
 */
export function evaluateShippingInvariant(
  input: ShippingInvariantInput,
): ShippingInvariantVerdict {
  const applied = new Set(input.appliedWhen.map(Number));
  const introduced = new Set(input.introduced);

  const standing: MigrationStanding[] = input.journal.map((entry) => {
    const declaration = declaredPhase(entry.tag);
    return {
      tag: entry.tag,
      when: entry.when,
      applied: applied.has(entry.when),
      phase: declaration ? declaration.phase : null,
      declaration,
      introduced: introduced.has(entry.tag),
    };
  });

  const undeclared = standing.filter((s) => s.phase === null).map((s) => s.tag);
  const expandNotApplied = standing
    .filter((s) => s.phase === "expand" && !s.applied)
    .map((s) => s.tag);
  const contractAppliedEarly = standing
    .filter((s) => s.phase === "contract" && s.introduced && s.applied)
    .map((s) => s.tag);
  const contractOwed = standing
    .filter((s) => s.phase === "contract" && !s.applied && !s.introduced)
    .map((s) => s.tag);
  const notAppliedAfterDeploy = standing.filter((s) => !s.applied).map((s) => s.tag);

  const failures: string[] = [];

  if (undeclared.length > 0) {
    failures.push(
      `${undeclared.length} committed migration(s) declare no phase: ${undeclared.join(", ")}. ` +
        "Add each to MIGRATION_PHASES in lib/db/migration-phases.ts with the reason it is expand " +
        "or contract. There is no default: assuming expand is what orders a contract migration " +
        "ahead of the code that is live.",
    );
  }

  if (input.moment === "pre-deploy") {
    if (expandNotApplied.length > 0) {
      failures.push(
        `${expandNotApplied.length} EXPAND migration(s) are committed and NOT applied to ` +
          `production: ${expandNotApplied.join(", ")}. ${PHASE_ORDERING.expand.sentence} ` +
          "Deploying first is the 2026-08-28 incident: every insert names a column production " +
          "does not have, the route catches the error and serves the page, and the loss is " +
          "invisible from every surface. Run: corepack pnpm db:apply --target=production" +
          (contractOwed.length > 0
            ? ` --upto=${lastExpandBefore(standing, expandNotApplied)}`
            : ""),
      );
    }
    if (contractAppliedEarly.length > 0) {
      failures.push(
        `${contractAppliedEarly.length} CONTRACT migration(s) introduced by this change are ` +
          `ALREADY APPLIED to production: ${contractAppliedEarly.join(", ")}. ` +
          `${PHASE_ORDERING.contract.sentence} The build serving readers right now still writes ` +
          "the old shape, so this ordering is breaking it.",
      );
    }
  } else {
    if (notAppliedAfterDeploy.length > 0) {
      failures.push(
        `${notAppliedAfterDeploy.length} committed migration(s) are still NOT applied after the ` +
          `deploy: ${notAppliedAfterDeploy.join(", ")}. Post-deploy, both phases are owed — the ` +
          "contract half of a two-sided change is the half that is easy to forget.",
      );
    }
  }

  const delta = compareSchemaState([...input.journal], input.appliedWhen);

  const summary =
    failures.length === 0
      ? `shipping invariant HOLDS at ${input.moment}: ${delta.appliedCount} of ${delta.codeCount} ` +
        `committed migration(s) applied, head ${delta.codeHead}` +
        (contractOwed.length > 0
          ? `; ${contractOwed.length} contract migration(s) owed from an earlier deploy and reported: ${contractOwed.join(", ")}`
          : "")
      : `shipping invariant REFUSED at ${input.moment}: ${failures.length} failure(s)`;

  return {
    verdict: failures.length === 0 ? "pass" : "fail",
    moment: input.moment,
    delta,
    standing,
    undeclared,
    expandNotApplied,
    contractAppliedEarly,
    contractOwed,
    notAppliedAfterDeploy,
    failures,
    summary,
  };
}

/**
 * The last expand migration in journal order among those still pending.
 *
 * Used only to suggest an `--upto=` when a contract migration is also pending:
 * applying everything would drag that contract across the deploy it is supposed
 * to follow, which is the ordering `pnpm db:apply --upto=` exists for.
 */
function lastExpandBefore(standing: readonly MigrationStanding[], pendingExpand: readonly string[]): string {
  let last = "";
  for (const s of standing) {
    if (s.phase === "contract" && !s.applied) break;
    if (s.phase === "expand" && !s.applied) last = s.tag;
  }
  return last !== "" ? last : (pendingExpand[pendingExpand.length - 1] ?? "");
}
