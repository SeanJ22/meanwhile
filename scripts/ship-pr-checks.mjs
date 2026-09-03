/** Wait inside the shipping door: pushing a generated context starts new CI. */
export async function mergeCheckedPullRequest({ number, head, run, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, registrationTimeout = 120000 }) {
  // Immediately after a push, gh's watch can exit with "no checks reported".
  // An empty rollup is pending registration, never a passing check set.
  const deadline = now() + registrationTimeout;
  for (;;) {
    const raw = run("gh", ["pr", "view", String(number), "--json", "headRefOid,statusCheckRollup"]);
    let observed;
    try { observed = JSON.parse(raw ?? ""); } catch { return "checks-unavailable"; }
    if (observed.headRefOid !== head) return "head-changed";
    if (!Array.isArray(observed.statusCheckRollup)) return "checks-unavailable";
    if (observed.statusCheckRollup.length > 0) break;
    if (now() >= deadline) return "checks-not-registered";
    await sleep(Math.min(20000, deadline - now()));
  }
  const checked = run("gh", [
    "pr", "checks", String(number), "--watch", "--fail-fast", "--interval", "20",
  ], { timeout: 20 * 60 * 1000 });
  if (checked === null) return "checks-not-green";
  const merged = run("gh", [
    "pr", "merge", String(number), "--merge", "--match-head-commit", head,
  ]);
  return merged === null ? "merge-refused" : "merged";
}
