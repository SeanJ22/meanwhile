/**
 * `pnpm acs:population` — acquire Census ACS B01003 total population by ZCTA
 * and by state into the committed reference tables. (ADM-23, 9.4.26 evening.)
 *
 * Two API calls, two CSVs, one source note each. Run with the environment
 * loaded (`node --env-file=.env.local`); the key is read from `CENSUS_API_KEY`
 * and never printed. The row counts are printed with their denominators and
 * the tables' row counts are pinned in `lib/reference/index.ts`, so a fetch
 * that came back short fails `tests/reference-data.test.ts` rather than
 * quietly shrinking the country.
 */
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { fetch as acsFetch, normalize, upsert, DATASET, describeUrl, KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
import { dataPath } from "../lib/reference/index.ts";
import { ACS_STATE_DATASET, ACS_ZCTA_DATASET } from "../lib/reference/acs-population.ts";

const ROOT = process.cwd();
const key = process.env[KEY_VAR];

function say(line: string): void {
  console.log(`acs:population · ${line}`);
}

async function main(): Promise<void> {
  say(DATASET);
  for (const [scope, dataset] of [["zcta", ACS_ZCTA_DATASET], ["state", ACS_STATE_DATASET]] as const) {
    const started = Date.now();
    const fetched = await acsFetch(scope, key);
    const rows = normalize(fetched);
    const path = dataPath(dataset);
    const bytes = upsert(rows, scope, path);
    const zeroes = rows.filter((r) => r.population === 0).length;
    const returned = fetched.rows.length - 1;
    // RULING 159: every count is reported against what it was taken over.
    const written = floored(`${scope} rows written`, "the Census Data API response", returned, rows.length);
    const empty = floored(`${scope} rows with a population of 0`, "the rows written", rows.length, zeroes);
    say(
      `${scope}: ${describeUrl(scope)} → HTTP ${fetched.status}; ${floorLine(written)}; ${floorLine(empty)}; ` +
        `${path.replace(`${join(ROOT)}\\`, "").replace(`${ROOT}/`, "")} (${bytes} bytes) in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }
  say("done — commit the two tables with their notes; the readiness publisher reads them on its next run");
}

await main();
