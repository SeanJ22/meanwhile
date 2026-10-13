/**
 * A deploy may not cross its own migrations. Pure: takes the committed
 * journal, the phase declarations, the `created_at` values production has
 * applied and the tags this change introduces, and names every migration on
 * the wrong side of the deploy.
 *
 *   - an EXPAND migration must precede its serving code; still pending after
 *     the deploy fails;
 *   - a CONTRACT migration may not precede its code; one introduced by this
 *     change and already applied fails.
 *
 * Only changes to the schema contract need the database; an unreadable
 * changed-path list counts as involved.
 */

import { compareSchemaState, type JournalEntry, type SchemaState } from "./schema-state.ts";
import { MIGRATION_SQL_PATH } from "./migration-immutability.ts";
import {
  declaredPhase,
  PHASE_ORDERING,
  type MigrationPhase,
  type PhaseDeclaration,
} from "./migration-phases.ts";

/** When the gate is being asked. */
export type ShipMoment = "pre-deploy" | "post-deploy";

/**
 * Paths whose change means the schema contract itself moved: the generated
 * migrations and journal, and the schema they are generated from.
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
 * Whether a change touches the schema contract. `null` means the list could
 * not be computed, not that nothing changed, and returns involved.
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
    .map((p) => MIGRATION_SQL_PATH.exec(p)?.[1])
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
  /** Expand migrations pending for the production build to apply before serving. */
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
 * The whole verdict, from the four inputs. No I/O. A migration with no
 * declaration is never given a phase by default; it fails on its own.
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
        (input.moment === "pre-deploy" && expandNotApplied.length > 0
          ? `; ${expandNotApplied.length} expand migration(s) pending for the production build: ${expandNotApplied.join(", ")}`
          : "") +
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
