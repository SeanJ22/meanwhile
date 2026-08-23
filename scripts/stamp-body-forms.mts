/**
 * **STAMP THE FORM ON EVERY BODY, AND NAME EVERY ONE THAT CANNOT BE.**
 * (The questionnaire-and-corpora brief, item 3, 2026-08-23.)
 *
 * ```
 * corepack pnpm forms:stamp            # report only
 * corepack pnpm forms:stamp --write    # write data/derived/body-forms.json
 * ```
 *
 * Reads only committed data — `lib/registry/registry.json` for the bodies and
 * their divisions, TIGER's legal type code for the municipal layer, and the
 * Census independent/dependent classification for school districts. **No
 * network, no clock, no statute read.**
 *
 * The number this exists to move is the 1,037 bodies that carry a class
 * definition and no form-specific one. Stamping the form does not write those
 * definitions — it bounds them, so the statute read that follows is once per
 * distinct FORM rather than once per body.
 *
 * RULING 105: the report is a three-way split. What is stamped, what is out of
 * scope with the reason, and what is in scope and still unstampable — each one
 * named, because a count cannot tell a decision from a failure.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import { formFor, knownForms, type FormStamp } from "../lib/officials/body-form.ts";
import type { BodyDivisionType } from "../lib/officials/body-blurbs.ts";
import { schoolDependency } from "../lib/officials/school-dependency.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "data/derived/body-forms.json");

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
  const write = process.argv.includes("--write");
  const registry = JSON.parse(
    readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
  ) as { divisions: Division[]; bodies: Body[] };

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

  if (!write) {
    console.log("\n(report only — pass --write to write the artifact)");
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        formatVersion: 1,
        generatedBy: "scripts/stamp-body-forms.mts",
        note:
          "The FORM of each body's government, stamped from committed data alone — TIGER's " +
          "legal type code for the municipal layer, the Census independent/dependent " +
          "classification for school districts, the division type for counties. It is NOT a " +
          "form-specific definition: it names which form a body is, so the charter or statute " +
          "read that writes those definitions is done once per distinct form rather than once " +
          "per body. Every unstampable body is named with the input that was missing.",
        counts: {
          bodiesWithADivision: rows.length,
          alreadyCarryingAFormDefinition: rows.length - owed.length,
          owedAFormDefinition: owed.length,
          stamped: stamped.length,
          unstampable: unstampable.length,
          distinctForms: byForm.size,
        },
        distinctForms: Object.fromEntries([...byForm].sort((a, b) => b[1] - a[1])),
        unstampable: unstampable.map((r) => ({
          bodyId: r.bodyId,
          bodyName: r.bodyName,
          ocdId: r.ocdId,
          divisionLabel: r.divisionLabel,
          reason: r.stamp.unstampableReason,
          basisDetail: r.stamp.basisDetail,
        })),
        rows: rows.map((r) => ({
          bodyId: r.bodyId,
          ocdId: r.ocdId,
          hasFormDefinition: r.hasFormDefinition,
          formKey: r.stamp.formKey,
          basis: r.stamp.basis,
          basisDetail: r.stamp.basisDetail,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

main();
