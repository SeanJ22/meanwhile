/**
 * The connect window for every standing-runner process: with happy eyeballs, each resolved address gets this long
 * before the next is tried, so a slow but reachable IPv4 address is not abandoned.
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
  env: Record<string, string | undefined> = process.env,
): void {
  setDefaultAutoSelectFamilyAttemptTimeout(ms);
  env.NODE_OPTIONS = nodeOptionsWithConnectWindow(env.NODE_OPTIONS, ms);
}
