/**
 * THE CONNECT WINDOW FOR EVERY STANDING-RUNNER PROCESS. (2026-09-22.)
 *
 * Node 24 connects with happy eyeballs (`autoSelectFamily`, on by default),
 * giving each resolved address 250 ms before abandoning it for the next. Each
 * Neon endpoint resolves to three IPv4 and three IPv6 addresses. From the
 * runner host the IPv6 ones are unreachable (ENETUNREACH at once), and a raw
 * TCP connect to the IPv4 ones measured p50 159–256 ms, max 457 ms, with 1 to 8
 * of every 15 over 250 ms. When all three IPv4 attempts run long together the
 * connect fails in about 790 ms with `AggregateError: ETIMEDOUT` beneath
 * `fetch failed` — the failure that crashed a research cycle at startup, failed
 * routine tasks and reader readbacks in bursts, and read like an outage while
 * the endpoints answered every probe.
 *
 * A per-address window that fits this host's real handshake removes it without
 * retrying anything: each request stays bounded end to end by
 * installNeonRequestDeadline. The parent applies the window to itself and puts
 * it in NODE_OPTIONS, which every child environment spreads from the parent
 * (`admittedRuntimeChildEnvironment`, `runtimeProductionReadEnvironment`), so
 * each child and grandchild starts with it before any of its own code runs.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

export const CONNECT_ATTEMPT_WINDOW_MS = 2_500;
const FLAG = "--network-family-autoselection-attempt-timeout";

/** NODE_OPTIONS carrying the connect window exactly once; every other option is left as it was. */
export function nodeOptionsWithConnectWindow(existing: string | undefined, ms: number = CONNECT_ATTEMPT_WINDOW_MS): string {
  const current = existing ?? "";
  const pattern = new RegExp(`${FLAG}=\\S*`);
  if (pattern.test(current)) return current.replace(pattern, `${FLAG}=${ms}`);
  return current.trim() === "" ? `${FLAG}=${ms}` : `${current} ${FLAG}=${ms}`;
}

/** Apply the window to this process and to every child spawned from its environment. */
export function installConnectAttemptWindow(
  ms: number = CONNECT_ATTEMPT_WINDOW_MS,
  env: NodeJS.ProcessEnv = process.env,
): void {
  setDefaultAutoSelectFamilyAttemptTimeout(ms);
  env.NODE_OPTIONS = nodeOptionsWithConnectWindow(env.NODE_OPTIONS, ms);
}
