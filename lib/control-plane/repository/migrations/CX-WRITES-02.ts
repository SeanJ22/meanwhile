import { readFileSync, readdirSync } from "node:fs";
import { pgEnsureOnlineIndex, type Sql } from "../pg-store.ts";
import { CAMPAIGN_PUBLICATION_INDEXES } from "../pg-schema.ts";
import { CONTROL_PLANE_REQUEST_BOUNDS_MS } from "../request-bounds.ts";

/** Extract the three small metadata fields together, without decompressing a large source body for each path. */
const migrationDirectory=new URL("../../../db/migrations/",import.meta.url);
const schemaName=readdirSync(migrationDirectory).find(name=>name.endsWith(".sql")&&readFileSync(new URL(name,migrationDirectory),"utf8").includes("-- CX-WRITES-02 source clock class."));
if(!schemaName)throw Error("The source clock metadata function is missing");
export const SOURCE_CLOCK_CLASS_SOURCE=`lib/db/migrations/${schemaName}`;
export const SOURCE_CLOCK_CLASS_DDL=readFileSync(new URL(schemaName,migrationDirectory),"utf8")
  .split("--> statement-breakpoint").find(statement=>statement.includes("-- CX-WRITES-02 source clock class."))!;
export const SOURCE_CLOCK_INDEX_SOURCE="lib/db/migrations/online/CX-WRITES-02_source_clock.sql";

const SOURCE_CLOCK_INDEX={name:"civic_data_candidates_source_clock",inProgressCode:"CONTROL_PLANE_INDEX_BUILD_IN_PROGRESS",
  ddl:readFileSync(new URL("../../../db/migrations/online/CX-WRITES-02_source_clock.sql",import.meta.url),"utf8")};

export function campaignPublicationIndexesDefinition(): string {
  return JSON.stringify({control:CAMPAIGN_PUBLICATION_INDEXES.map(index=>index.ddl),reader:[SOURCE_CLOCK_CLASS_DDL,SOURCE_CLOCK_INDEX.ddl]});
}

export async function buildCampaignPublicationIndexes(sql:Sql,reader:Sql):Promise<string>{
  const bounds={...CONTROL_PLANE_REQUEST_BOUNDS_MS,POINT:900_000};
  for(const index of CAMPAIGN_PUBLICATION_INDEXES)await pgEnsureOnlineIndex(sql,index,bounds);
  await reader.query(SOURCE_CLOCK_CLASS_DDL);
  await pgEnsureOnlineIndex(reader,SOURCE_CLOCK_INDEX,bounds);
  return `${CAMPAIGN_PUBLICATION_INDEXES.length} campaign publication indexes and one source clock index`;
}
