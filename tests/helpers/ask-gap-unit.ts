import assert from "node:assert/strict";

import type { RegistryPass } from "../../lib/control-plane/scheduler/registry.ts";

/** The registered unit of one body's Ask-gap obligation for one code, or a named failure listing what the pass holds. */
export function unitOf(pass: Pick<RegistryPass, "units">, bodyId: string, code: string): RegistryPass["units"][number] {
  const unit = pass.units.find((u) => u.obligation.id === `freshness:ask-gap:${bodyId}#${code}`);
  assert.ok(unit, `no ${code} obligation for ${bodyId}; have ${pass.units.map((u) => u.obligation.id).join(", ")}`);
  return unit;
}
