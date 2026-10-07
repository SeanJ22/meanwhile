/** Same authorized source executors and receipts as the routine runner, on an independent minute clock.
 * This entry runs only saved parser results and changed doors. */
if (!process.argv.includes("--publish-now")) process.argv.push("--publish-now");
await import("./routine-civic-data-runner.mts");
export {};
