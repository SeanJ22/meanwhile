/** The hang watchdog's decision (the Worker mirrors it inline). `killAfterMs <= 0` disables it; a missing or NaN reading never kills. */
export function hangShouldTerminate(lastPingMs: number, nowMs: number, killAfterMs: number): boolean {
  if (
    !Number.isFinite(lastPingMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(killAfterMs) ||
    killAfterMs <= 0 ||
    lastPingMs <= 0
  ) {
    return false;
  }
  return nowMs - lastPingMs > killAfterMs;
}
