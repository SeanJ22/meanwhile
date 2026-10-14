/** Source-to-reader coverage observations. This command never acquires or publishes data. */
import { pathToFileURL } from "node:url";
import { readFile,writeFile } from "node:fs/promises";
import { collectPeopleCoverage, comparePeopleCoverage } from "../lib/officials/people-coverage-report.ts";
export async function main(args:readonly string[]) {
  if(args.some(arg=>!arg.startsWith("--output=")&&!arg.startsWith("--before=")))throw Error("SL03_REPORT_ARGUMENT_INVALID");
  const connection=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if(!connection)throw Error("WTP_PRODUCTION_DATABASE_URL_READONLY is required for this read-only report");
  process.env.DATABASE_URL=connection;
  const after=await collectPeopleCoverage();
  const before=args.find(arg=>arg.startsWith("--before="))?.slice(9);
  const report=before?comparePeopleCoverage(JSON.parse(await readFile(before,"utf8")),after):after;
  const json=JSON.stringify(report,null,2)+"\n",output=args.find(arg=>arg.startsWith("--output="))?.slice(9);
  if(output)await writeFile(output,json);else process.stdout.write(json);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv.slice(2));
