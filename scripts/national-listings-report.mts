/** Sean's post-release per-state contact report, read from the published reader inventory. */
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { attachGovernmentDomains, readDotGovProjection } from "../lib/civic-data/dotgov.ts";

console.log("state,status,governments,address,website,gov_domain");
for (const { state } of REGISTRATION_TARGETS) {
  let governments = 0, address = 0, website = 0, domain = 0;
  try {
    const domains = await readDotGovProjection({ state });
    const registration = await readRegistrationProjection(state);
    if (registration.kind !== "PROMOTED") {
      console.log(`${state},${registration.kind},,,,`);
      continue;
    }
    const inventory = registration.value.governments ?? [];
    const records = domains.kind === "PROMOTED" ? attachGovernmentDomains(inventory, domains.value) : inventory;
    for (const row of records) {
      if (row.kind !== "GOVERNMENT") continue;
      governments++;
      if (row.mailingAddress || row.officeAddress) address++;
      if (row.website) website++;
      if (row.govDomains?.length) domain++;
    }
    console.log(`${state},HELD,${governments},${address},${website},${domains.kind === "PROMOTED" ? domain : ""}`);
  } catch {
    console.log(`${state},UNAVAILABLE,,,,`);
    process.exitCode = 1;
  }
}
