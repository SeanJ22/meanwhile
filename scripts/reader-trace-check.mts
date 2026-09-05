import { checkReaderTraces } from "../lib/holdings/reader-trace.ts";
const result = checkReaderTraces(process.cwd());
console.log(JSON.stringify(result, null, 2));
if (result.failures.length) process.exitCode = 1;
