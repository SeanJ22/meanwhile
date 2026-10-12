/**
 * `pnpm office:audit` — which bodies have the wrong person in the
 * runs-it-day-to-day slot, or in the presiding slot? Walks every body in the
 * registry and reports each as:
 *
 * - CORRECT — the slot holds the person the body's own titles say it should.
 * - OUT OF SCOPE, with the reason — the body publishes no executive title at all.
 * - WRONG — a subordinate or lesser office occupies a slot a senior title in the
 *   same roster should hold; every instance is named.
 *
 * A registry that failed to load fails the run rather than reporting zero wrong.
 */
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { topOfficesFor } from "../lib/officials/top-offices.ts";

/** The senior word for each slot, in the order the slot prefers them. */
const EXECUTIVE_SENIORITY = [/\bsuperintendent\b/i, /\bexecutive director\b/i, /\b(county|city|town) executive\b/i];
const EXECUTIVE_LESSER = [/\b(administrator|manager)\b/i];
const SUBORDINATE = /\b(vice|deputy|assistant)\b/i;

export interface OfficeAuditRow {
  bodyId: string;
  bodyName: string;
  verdict: "CORRECT" | "OUT_OF_SCOPE" | "WRONG";
  reason: string;
  slotHolder: string | null;
  shouldBe: string | null;
}

export function auditTopOffices(rosters = BODY_ROSTERS): OfficeAuditRow[] {
  const out: OfficeAuditRow[] = [];
  for (const roster of rosters) {
    const holders = (roster.members ?? []) as unknown as Parameters<typeof topOfficesFor>[0];
    const top = topOfficesFor(holders);
    const dayToDay = top.find((o) => o.role === "Runs it day to day") ?? null;

    const titles = holders.map((h) => ({ h, title: h.officeTitle ?? "" }));
    const seniorAvailable = titles.find(
      (t) => EXECUTIVE_SENIORITY.some((re) => re.test(t.title)) && !SUBORDINATE.test(t.title),
    );

    if (!seniorAvailable && !EXECUTIVE_LESSER.some((re) => titles.some((t) => re.test(t.title)))) {
      out.push({
        bodyId: roster.bodyId,
        bodyName: roster.bodyName,
        verdict: "OUT_OF_SCOPE",
        reason: "the body publishes no executive title at all — there is no slot to get wrong",
        slotHolder: dayToDay?.holder.name ?? null,
        shouldBe: null,
      });
      continue;
    }

    // A senior executive exists in the roster and somebody else is standing in the slot.
    if (seniorAvailable && dayToDay && dayToDay.holder.id !== seniorAvailable.h.id) {
      out.push({
        bodyId: roster.bodyId,
        bodyName: roster.bodyName,
        verdict: "WRONG",
        reason: `the slot holds "${dayToDay.holder.officeTitle ?? "?"}" while the roster also publishes "${seniorAvailable.title}"`,
        slotHolder: dayToDay.holder.name,
        shouldBe: seniorAvailable.h.name,
      });
      continue;
    }

    if (seniorAvailable && !dayToDay) {
      out.push({
        bodyId: roster.bodyId,
        bodyName: roster.bodyName,
        verdict: "WRONG",
        reason: `the roster publishes "${seniorAvailable.title}" and the slot is EMPTY`,
        slotHolder: null,
        shouldBe: seniorAvailable.h.name,
      });
      continue;
    }

    out.push({
      bodyId: roster.bodyId,
      bodyName: roster.bodyName,
      verdict: "CORRECT",
      reason: dayToDay
        ? `"${dayToDay.holder.officeTitle ?? "?"}" is the most senior executive title in the roster`
        : "only a lesser executive title is published, and it holds the slot",
      slotHolder: dayToDay?.holder.name ?? null,
      shouldBe: null,
    });
  }
  return out;
}

if (import.meta.filename === process.argv[1]) {
  const rows = auditTopOffices();
  const wrong = rows.filter((r) => r.verdict === "WRONG");
  const outOfScope = rows.filter((r) => r.verdict === "OUT_OF_SCOPE");
  const correct = rows.filter((r) => r.verdict === "CORRECT");

  const measured = floored(
    "bodies with the WRONG person in the runs-it-day-to-day slot",
    "lib/registry/body-rosters.ts",
    rows.length,
    wrong.length,
  );

  console.log("OFF-7 top-office audit — every body in the registry, all four zips\n");
  console.log(`  RENDERING CORRECTLY   ${correct.length} of ${rows.length}`);
  console.log(`  OUT OF SCOPE          ${outOfScope.length} of ${rows.length}  (no executive title published)`);
  console.log(`  WRONG                 ${wrong.length} of ${rows.length}`);
  console.log(`\n  ${floorLine(measured)}`);
  if (wrong.length > 0) {
    console.log("\n  WRONG, by name:");
    for (const r of wrong) {
      console.log(`    ${r.bodyName}`);
      console.log(`      slot: ${r.slotHolder ?? "<empty>"}  should be: ${r.shouldBe ?? "?"}`);
      console.log(`      ${r.reason}`);
    }
    process.exitCode = 1;
  }
}
