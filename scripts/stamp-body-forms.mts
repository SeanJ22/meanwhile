/**
 * Reports the form of government for every body and names each one that
 * cannot be stamped, from committed data alone (no network, no clock).
 *
 * ```
 * corepack pnpm forms:stamp
 * ```
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import { withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";
import { formFor, knownForms, type FormStamp } from "../lib/officials/body-form.ts";
import type { BodyDivisionType } from "../lib/officials/body-description.ts";
import { schoolDependency } from "../lib/officials/school-dependency.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Division {
  ocdId: string;
  divisionType: string;
  label: string;
  lsad: string | null;
}
interface Body {
  id: string;
  ocdId: string | null;
  name: string;
}

function main(): void {
  // A body minted on a Census "no district here" placeholder is not a government, so it is never stamped.
  const registry = withoutPlaceholderBodies(JSON.parse(
    readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
  ) as { divisions: Division[]; bodies: Body[] });

  const byId = new Map(registry.divisions.map((d) => [d.ocdId, d]));
  const bodies = registry.bodies.filter((b) => b.ocdId !== null && byId.has(b.ocdId));

  const rows: Array<{
    bodyId: string;
    bodyName: string;
    ocdId: string;
    divisionLabel: string;
    hasFormDefinition: boolean;
    stamp: FormStamp;
  }> = [];

  for (const body of bodies) {
    const division = byId.get(body.ocdId as string) as Division;
    const definitions = definitionsForBody({
      bodyId: body.id,
      ocdId: body.ocdId,
      divisionType: division.divisionType as BodyDivisionType,
      lsad: division.lsad,
      schoolDependency: schoolDependency(body.ocdId),
    });
    rows.push({
      bodyId: body.id,
      bodyName: body.name,
      ocdId: body.ocdId as string,
      divisionLabel: division.label,
      hasFormDefinition: definitions.formDefinition !== null,
      stamp: formFor({
        ocdId: body.ocdId,
        divisionType: division.divisionType as BodyDivisionType,
        lsad: division.lsad,
        schoolDependency: schoolDependency(body.ocdId),
      }),
    });
  }

  /* ------------------------------------------------------ the denominator --- */
  const owed = rows.filter((r) => !r.hasFormDefinition);
  const stamped = owed.filter((r) => r.stamp.formKey !== null);
  const unstampable = owed.filter((r) => r.stamp.formKey === null);

  console.log("body forms — stamped from committed data alone");
  console.log(`  bodies with a division                 ${rows.length}`);
  console.log(`  already carrying a FORM definition     ${rows.length - owed.length} of ${rows.length}`);
  console.log(`  owed a form-specific definition        ${owed.length} of ${rows.length}`);
  console.log(`  STAMPED with a form                    ${stamped.length} of ${owed.length}`);
  console.log(`  UNSTAMPABLE                            ${unstampable.length} of ${owed.length}`);

  /* --------------------------------------- the bounded list, with counts --- */
  const byForm = new Map<string, number>();
  for (const row of stamped) {
    const key = row.stamp.formKey as string;
    byForm.set(key, (byForm.get(key) ?? 0) + 1);
  }
  console.log(`\n  THE DISTINCT FORMS — ${byForm.size}, against ${owed.length} bodies`);
  for (const [key, count] of [...byForm].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key.padEnd(36)} ${String(count).padStart(4)}`);
  }

  /* ----------------------------------------- every unstampable one, NAMED --- */
  if (unstampable.length > 0) {
    console.log(`\n  UNSTAMPABLE, EACH NAMED — ${unstampable.length}`);
    const byReason = new Map<string, typeof unstampable>();
    for (const row of unstampable) {
      const reason = row.stamp.unstampableReason as string;
      const bucket = byReason.get(reason);
      if (bucket) bucket.push(row);
      else byReason.set(reason, [row]);
    }
    for (const [reason, group] of byReason) {
      console.log(`\n    ${group.length} · ${reason}`);
      for (const row of group) {
        console.log(
          `        ${row.divisionLabel} — ${row.bodyName ?? row.bodyId}  [${row.stamp.basisDetail}]`,
        );
      }
    }
  }

  /* -------------------------------- what a label is written for, and not --- */
  const unlabelled = stamped.filter((r) => r.stamp.label === null);
  console.log(
    `\n  forms carrying a reader-facing label   ${byForm.size - new Set(unlabelled.map((r) => r.stamp.formKey)).size} of ${byForm.size}`,
  );
  console.log(`  forms this file can name in total      ${knownForms().length}`);
}

main();
