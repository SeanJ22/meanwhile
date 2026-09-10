import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readReaderEvidence,
  componentRequirements,
  importReachability,
  type ReaderCensus,
  type ReaderComponentCase,
} from "../../lib/holdings/reader-census.ts";
import { READER_SURFACES } from "../../lib/holdings/datasets.ts";

const DEFAULT_CENSUS = "docs/evidence/reader-last-mile-current.json";
const DEFAULT_COMPONENTS = [
  "docs/evidence/reader-last-mile-current-components.json",
  "docs/evidence/reader-last-mile-bodies.json",
] as const;
const DEFAULT_OUTPUT = "docs/evidence/reader-last-mile-witness-requirements.json";

function configuredPath(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: string,
): string {
  if (!(name in environment)) return fallback;
  const value = environment[name]?.trim();
  assert.ok(value, `${name} is present but empty`);
  return value;
}

export function readerWitnessRequirementPaths(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): {
  readonly census: string;
  readonly components: readonly string[];
  readonly output: string;
} {
  const configuredComponents = environment.READER_COMPONENT_EVIDENCE;
  const components = configuredComponents === undefined
    ? [...DEFAULT_COMPONENTS]
    : configuredComponents.split(",").map((path) => path.trim());
  assert.ok(components.length > 0, "READER_COMPONENT_EVIDENCE is present but empty");
  assert.ok(components.every(Boolean), "READER_COMPONENT_EVIDENCE contains an empty component artifact");
  assert.equal(new Set(components).size, components.length, "READER_COMPONENT_EVIDENCE repeats a component artifact");
  return {
    census: configuredPath(environment, "READER_FINAL_PREPARED_CENSUS", DEFAULT_CENSUS),
    components,
    output: configuredPath(environment, "READER_WITNESS_REQUIREMENTS_OUTPUT", DEFAULT_OUTPUT),
  };
}

export function generateReaderWitnessRequirements(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  root = process.cwd(),
): void {
  const paths = readerWitnessRequirementPaths(environment);
  const census = JSON.parse(readReaderEvidence(root, paths.census).toString()) as ReaderCensus;
  const cases = paths.components.flatMap((path) =>
    (JSON.parse(readReaderEvidence(root, path).toString()) as { cases: ReaderComponentCase[] }).cases
  );
  const records = new Map(census.records.map((record) => [record.auditId, record]));
  const requirements = new Map<string, {
    surface: string;
    component: string;
    families: Set<string>;
    ids: Set<string>;
    selectors: Set<string>;
    importReach: boolean;
  }>();
  for (const row of census.rows) {
    for (const id of row.applicableEligibleRecordIds ?? row.eligibleRecordIds) {
      const record = records.get(id);
      assert.ok(record, `${row.id}: applicable Reader record is absent from the prepared census`);
      for (const component of componentRequirements(record)) {
        const key = `${row.readerSurface}#${component}`;
        let entry = requirements.get(key);
        if (!entry) {
          const surface = READER_SURFACES.find((candidate) => candidate.id === row.readerSurface);
          assert.ok(surface, `${row.id}: Reader surface is not declared`);
          entry = {
            surface: row.readerSurface,
            component,
            families: new Set(),
            ids: new Set(),
            selectors: new Set(),
            importReach: importReachability(root, surface.path, component).reached,
          };
          requirements.set(key, entry);
        }
        entry.families.add(row.datasetFamily);
        entry.ids.add(id);
      }
    }
  }
  for (const componentCase of cases) {
    for (const requirement of requirements.values()) {
      if (componentCase.component === requirement.component && requirement.ids.has(componentCase.auditId)) {
        requirement.selectors.add(componentCase.selector);
      }
    }
  }
  const result = [...requirements.values()].map((requirement) => ({
    surface: requirement.surface,
    component: requirement.component,
    families: [...requirement.families],
    recordObligations: requirement.ids.size,
    selectorClasses: [...requirement.selectors],
    importReach: requirement.importReach,
  }));
  writeFileSync(resolve(root, paths.output), JSON.stringify({
    rule: "Actual component classes needing in-situ execution. Non-reachable API/Ask classes need their actual route record proofs instead of a manufactured visual witness. Counts use current applicability and will refresh after final selector repair.",
    requirements: result,
  }, null, 2) + "\n");
  console.log(JSON.stringify(result.filter((requirement) => requirement.importReach).map(({ selectorClasses, ...requirement }) => ({
    ...requirement,
    selectorClasses: selectorClasses.length,
  })), null, 2));
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) generateReaderWitnessRequirements();
