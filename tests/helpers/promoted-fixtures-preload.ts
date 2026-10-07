/**
 * Preloaded into a child process (`--import`) by `withPromotedFixturesInChildren`: installs the registry
 * runtime on that process's own reader edge before its entry module runs, so a forked worker reads the
 * same promoted registry the parent test installed. A child process shares no async context with its parent.
 */
import { installRegistryRuntime } from "./promoted-fixtures.ts";

await installRegistryRuntime();
