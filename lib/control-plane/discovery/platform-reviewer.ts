import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoCrosswalkReviewerId } from "./auto-crosswalk.ts";

/** A repaired matcher or changed held directory reopens its standing work. */
export function platformReviewer(root = process.cwd()) {
  const hash = createHash("sha256");
  for (const file of ["auto-crosswalk.ts", "platform-registration.ts", "platform-catalog.ts", "platform-government.ts", "platform-legistar.ts", "platform-civicplus.ts", "platform-calendar-reading.ts", "derived-wiring.ts", "derived-wiring-reading.ts"])
    hash.update(readFileSync(join(root, "lib/control-plane/discovery", file)));
  for (const file of ["derived-door-kinds.ts", "meeting-body-crosswalk.ts"])
    hash.update(readFileSync(join(root, "lib/civic-data", file)));
  hash.update(readFileSync(join(root, "lib/doors/platform-census.ts")));
  return autoCrosswalkReviewerId(hash.digest("hex"));
}

export function heldPlatformDirectoryVersion(root = process.cwd()) {
  const hash = createHash("sha256");
  for (const file of ["civicplus_tenants.csv", "granicus_legistar_tenants.csv", "boarddocs_tenants.csv"])
    hash.update(readFileSync(join(root, "data/reference", file)));
  return hash.digest("hex");
}
