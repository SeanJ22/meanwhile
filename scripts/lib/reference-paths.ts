import { join } from "node:path";
import type { REFERENCE_JSON_DATASETS, ReferenceDataset } from "../../lib/reference/index.ts";

type ReferenceJsonDataset = (typeof REFERENCE_JSON_DATASETS)[number];

export const REFERENCE_DIR = join(process.cwd(), "data", "reference");

export function dataPath(dataset: ReferenceDataset): string {
  return join(REFERENCE_DIR, `${dataset}.csv`);
}

export function notePath(dataset: ReferenceDataset | ReferenceJsonDataset): string {
  return join(REFERENCE_DIR, `${dataset}.md`);
}
