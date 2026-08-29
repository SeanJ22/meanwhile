/**
 * **AMENDING WHAT AN EXISTING ENTRY ASSERTS, WITHOUT REWRITING IT.**
 * (2026-08-28.)
 *
 * `learnBatch` is how a route ENTERS project knowledge. This is the other half:
 * how an entry that is already inherited gains its claim classes, and how one
 * of those claims is WITHDRAWN when stronger evidence contradicts it.
 *
 * It is a separate path on purpose. Learning increments the method version,
 * because a new route is a new avenue and a new avenue reopens prior
 * conclusions (RULING 178). **An amendment adds no avenue and must NOT bump the
 * version** — doing so would mechanically reopen every conclusion earned under
 * the old version on the strength of nothing having been discovered, which
 * would turn the reopening machinery into noise and teach sessions to ignore
 * it.
 *
 * Three properties, each of which the Pima case needed:
 *
 * 1. **Additive.** Claims are attached, never replaced. Retraction adds a
 *    record to a claim and removes nothing. Re-running says "already".
 * 2. **The route survives.** Nothing here can retire, delete or narrow a route.
 *    Withdrawing a coverage claim or a derived conclusion leaves the route it
 *    rested on exactly as usable as it was, which is the property the whole
 *    exercise exists for.
 * 3. **It refuses to write a store it just broke.** The amendment is validated
 *    after application, and a run that would introduce a NEW validator issue
 *    writes nothing and says which issue. Correct first.
 */

import { issueKey, readMethodStore, writeMethodStore } from "./candidate.ts";
import {
  attachClaims,
  findDependencyFlags,
  retractClaim,
  type ClaimRetraction,
  type MethodClaim,
} from "./claims.ts";
import { validateKnowledge, type MethodKnowledge } from "./knowledge.ts";

export interface ClaimAmendment {
  /** A one-line name for the run, printed so a log says what was applied. */
  name: string;
  /** Claims to attach to routes that already exist. */
  attach: ReadonlyArray<{ routeId: string; claims: readonly MethodClaim[] }>;
  /** Claims to withdraw. The claim is kept; its currency changes. */
  retract: ReadonlyArray<{ claimId: string; retraction: ClaimRetraction }>;
}

export interface AmendResult {
  knowledge: MethodKnowledge;
  versionBefore: number;
  versionAfter: number;
  routesBefore: number;
  routesAfter: number;
  claimsAdded: string[];
  claimsAlready: string[];
  retracted: string[];
  retractionsAlready: string[];
  /** Route ids the amendment named that project knowledge does not hold. */
  unknownRoutes: string[];
  /** Claim ids the amendment tried to retract and could not find. */
  unknownClaims: string[];
  log: string[];
}

export function applyClaimAmendment(k: MethodKnowledge, a: ClaimAmendment): AmendResult {
  let routes = k.routes;
  const claimsAdded: string[] = [];
  const claimsAlready: string[] = [];
  const retracted: string[] = [];
  const retractionsAlready: string[] = [];
  const unknownRoutes: string[] = [];
  const unknownClaims: string[] = [];
  const log: string[] = [];

  for (const step of a.attach) {
    const res = attachClaims(routes, step.routeId, step.claims);
    if (res.missingRoute) {
      unknownRoutes.push(step.routeId);
      log.push(`  UNKNOWN ROUTE   ${step.routeId} — nothing attached, nothing invented`);
      continue;
    }
    routes = res.routes;
    claimsAdded.push(...res.added);
    claimsAlready.push(...res.already);
    for (const id of res.added) log.push(`  claim attached  ${id}`);
    for (const id of res.already) log.push(`  already present ${id}`);
  }

  for (const step of a.retract) {
    const res = retractClaim(routes, step.claimId, step.retraction);
    routes = res.routes;
    if (res.retracted) {
      retracted.push(step.claimId);
      log.push(`  WITHDRAWN       ${res.reason}`);
    } else if (res.reason.startsWith("already retracted")) {
      retractionsAlready.push(step.claimId);
      log.push(`  already withdrawn ${step.claimId}`);
    } else {
      unknownClaims.push(step.claimId);
      log.push(`  UNKNOWN CLAIM   ${step.claimId} — ${res.reason}`);
    }
  }

  // The version is DELIBERATELY unchanged. See the module note.
  const knowledge: MethodKnowledge = { ...k, routes };
  return {
    knowledge,
    versionBefore: k.version,
    versionAfter: knowledge.version,
    routesBefore: k.routes.length,
    routesAfter: knowledge.routes.length,
    claimsAdded,
    claimsAlready,
    retracted,
    retractionsAlready,
    unknownRoutes,
    unknownClaims,
    log,
  };
}

export interface RunAmendmentOptions {
  /**
   * The method version this caller believes the store is at. Defaults to the
   * version this call reads. Supplying it lets a caller that read the store
   * earlier refuse rather than overwrite work done in between.
   */
  readonly expectedVersion?: number;
}

/**
 * Read the store, apply the amendment, report, and write only if the result is
 * no worse than what was read.
 *
 * `storePath` is an argument rather than a constant so the run can be proved
 * against a THROWAWAY COPY before it ever touches the canonical store.
 *
 * The write goes through `writeMethodStore`, which re-runs the same check as a
 * backstop and adds the version precondition. The report below stays here
 * because it is what a person reads; the gate is what a store gets.
 */
export function runClaimAmendment(
  storePath: string,
  amendment: ClaimAmendment,
  stamp: string,
  options: RunAmendmentOptions = {},
): void {
  const before = readMethodStore(storePath);
  const beforeIssues = new Set(validateKnowledge(before).map(issueKey));

  const r = applyClaimAmendment(before, amendment);
  console.log(`amendment: ${amendment.name}`);
  for (const line of r.log) console.log(line);

  const after = validateKnowledge(r.knowledge);
  const introduced = after.filter((i) => !beforeIssues.has(issueKey(i)));

  const flags = findDependencyFlags(r.knowledge);
  console.log("");
  console.log(`method version ${r.versionBefore} -> ${r.versionAfter}   (an amendment adds no avenue and bumps nothing)`);
  console.log(`routes         ${r.routesBefore} -> ${r.routesAfter}   (an amendment adds no route)`);
  console.log(`claims         ${r.claimsAdded.length} attached, ${r.claimsAlready.length} already present`);
  console.log(`withdrawn      ${r.retracted.length} retracted, ${r.retractionsAlready.length} already withdrawn`);
  console.log(`dependency flags after: ${flags.length}` +
    `  (${flags.filter((f) => f.status === "STALE").length} STALE, ${flags.filter((f) => f.status === "DISPOSITIONED").length} dispositioned)`);
  for (const f of flags) console.log(`  ${f.status.padEnd(14)} ${f.dependent}  <- ${f.upstream}`);

  if (r.unknownRoutes.length > 0 || r.unknownClaims.length > 0) {
    console.error(
      `\nREFUSED — the amendment names ids project knowledge does not hold: ` +
        `${[...r.unknownRoutes, ...r.unknownClaims].join(", ")}. Nothing written.`,
    );
    process.exitCode = 1;
    return;
  }
  if (introduced.length > 0) {
    console.error(`\nREFUSED — applying this amendment would introduce ${introduced.length} validator issue(s):`);
    for (const i of introduced.slice(0, 20)) console.error(`  ${i.id} ${i.rule}: ${i.detail}`);
    console.error("Nothing written. Correct first.");
    process.exitCode = 1;
    return;
  }

  const receipt = writeMethodStore(storePath, r.knowledge, {
    expectedVersion: options.expectedVersion ?? before.version,
    stamp,
  });
  console.log(
    `\nwritten to ${receipt.path}   —  validator issues: ${after.length}, ${receipt.bytes} bytes, ` +
      `method version ${receipt.version}`,
  );
}
