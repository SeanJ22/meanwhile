import { buildRegistry, registryLines } from "./lib/control-plane/scheduler/registry.ts";
import { meetingsProvider } from "./lib/control-plane/scheduler/providers/meetings.ts";
import { campaignFinanceProvider } from "./lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "./lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "./lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { candidateEnrichmentProvider } from "./lib/control-plane/scheduler/providers/candidate-enrichment.ts";

const pass = buildRegistry(
  [
    meetingsProvider(),
    campaignFinanceProvider(),
    trackerIntakeProvider(),
    localJurisdictionsProvider(),
    candidateEnrichmentProvider(),
  ],
  { root: process.cwd(), nowIso: new Date().toISOString() },
);
for (const l of registryLines(pass)) console.log(l);
const byClass = new Map<string, number>();
for (const u of pass.units) byClass.set(u.obligation.recordClass, (byClass.get(u.obligation.recordClass) ?? 0) + 1);
console.log([...byClass].sort());
console.log("sample jurisdiction ids:");
for (const u of pass.units.filter((x) => x.providerId === "local-jurisdictions").slice(0, 5)) console.log("  ", u.obligation.id);
console.log("sample candidate ids:");
for (const u of pass.units.filter((x) => x.providerId === "candidate-enrichment").slice(0, 5)) console.log("  ", u.obligation.id);
