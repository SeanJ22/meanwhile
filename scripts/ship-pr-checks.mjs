/** Wait inside the shipping door: pushing a generated context starts new CI. */
export function mergeCheckedPullRequest({ number, head, run }) {
  const checked = run("gh", [
    "pr", "checks", String(number), "--watch", "--fail-fast", "--interval", "20",
  ], { timeout: 20 * 60 * 1000 });
  if (checked === null) return "checks-not-green";
  const merged = run("gh", [
    "pr", "merge", String(number), "--merge", "--match-head-commit", head,
  ]);
  return merged === null ? "merge-refused" : "merged";
}
