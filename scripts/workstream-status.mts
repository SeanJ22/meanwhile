/**
 * `pnpm workstream:status` — the same generated state as the close-out, without
 * the close-out framing. See `scripts/workstream-close.mts`, which it runs.
 */
process.argv.push("--status");
await import("./workstream-close.mts");
