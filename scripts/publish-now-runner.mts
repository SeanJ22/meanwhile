/** BX-12: same authorized source executors and receipts, on an independent
 * minute clock. This entry runs only saved parser results and changed doors. */
if (!process.argv.includes("--publish-now")) process.argv.push("--publish-now");
await import("./routine-civic-data-runner.mts");
export {};
