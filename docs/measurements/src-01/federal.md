# FAC and OpenFEMA publication replay

The production failures were the first pending-page checkpoints, before any source facts could publish. FAC `cv-56023d9489f1c171d5befd31048e8550` and OpenFEMA `cv-f5e44118eba0755372c2ee89eb9e5c35` both hashed an optional `since: undefined` cursor field. Persistence removed that field. Restoring it reproduces each supplied bad hash exactly; building the durable projection before hashing fixes both.

The next production-data replay exposed FAC's `GSA_MIGRATION` placeholder in its legacy UEI field. It is now represented as a missing UEI, retaining report, DUNS and EIN identifiers. Other malformed UEIs still reach validation.

FAC's official `auditee_state` locates an audit on the corresponding state card. The join requires the source's reported state to equal the record's state and resolves it through the existing USPS/FIPS state reference. Findings inherit location only through the exact native report ID. This creates no government recipient or body match. Body cards retain their exact-recipient filter. The page says `Auditee location: DE`.

Inputs came from the production Neon project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, using role `readonly`, plus read-only publisher GETs. FAC's [captured official response](https://api.fac.gov/general?auditee_state=eq.DE&order=report_id.asc&limit=100&offset=0) still had the exact production capture hash. OpenFEMA's response metadata changed; its exact persisted failed checkpoint was replayed separately, and fresh official source bytes supplied the record replay.

The connected path was scheduled source acquisition → registered promotion and bounded `FEDERAL_MONEY` partitions → reader artifacts → `readFederalMoneyForPlace` → the actual `Card` and `FederalMoneySection` components.

| Source | Initial replay | Controlled next-day run | Reader result |
| --- | --- | --- | --- |
| OpenFEMA, Florida | 500 records, 479 geographic joins | Actual saved `$skip=500` continuation: 1,000 records, 961 geographic joins | Alachua County disaster card, with its source link |
| FAC, Delaware | 100 reports located in Delaware, zero body matches | Actual saved findings continuation: 309 records located in Delaware | State card with audits and findings, zero fabricated recipient matches |

Registered typed-reader checks passed. Both next-day readers retained the initial accepted record through pagination. The local browser proof used accepted artifacts and the actual components; first usable content took 362 ms for OpenFEMA and 363 ms for FAC. Sources opened correctly. Both screenshots were inspected. The local proof page uses minimal styling.

The five focused federal refresh, PostgreSQL, joins, reader and edge files produced 56 passing checks and one outdated join-count assertion. That assertion was updated to check the new exact state association and zero body matches; its focused rerun passed. Earlier hash and acquisition regressions reproduced the original failures before their fixes.

Machine-readable results: [federal-read-only.json](federal-read-only.json). Screenshots: [OpenFEMA](openfema-card.png), [FAC](federal-audit-clearinghouse-card.png).

There were zero production writes. October 24 was a controlled replay against real retained and subsequent publisher data. This proves continuation and reader behavior; observing an automatic post-shipping production run remains a separate live check.
