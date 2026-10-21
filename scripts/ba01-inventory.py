"""Report ballot holdings and deltas; inventory is not an official denominator."""
import argparse
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("contests", "candidacies", "measures")


def counts(document):
    return Counter({field: sum(len(ballot.get(field, [])) for ballot in document["ballots"].values())
                    for field in FIELDS})


def at_revision(revision, path):
    if not subprocess.check_output(["git", "ls-tree", "--name-only", revision, "--", str(path)], cwd=ROOT).strip():
        return {"ballots": {}}
    return json.loads(subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=ROOT))


def inventory(base, previous):
    baseline, current, prior = Counter(), Counter(), Counter()
    rows = []
    for path in sorted((ROOT / "data/ballot/2026-general").glob("*.json")):
        relative = path.relative_to(ROOT)
        before = counts(at_revision(base, relative))
        held = counts(json.loads(path.read_text()))
        last = counts(at_revision(previous, relative)) if previous else before
        baseline.update(before)
        current.update(held)
        prior.update(last)
        rows.append({"state": path.stem.upper(), "held": dict(held),
                     "added": {field: held[field] - before[field] for field in FIELDS},
                     "sincePreviousReady": {field: held[field] - last[field] for field in FIELDS}})
    return {"generatedAt": datetime.now(timezone.utc).isoformat(), "base": base,
            "previousReady": previous, "baseline": dict(baseline), "current": dict(current),
            "added": {field: current[field] - baseline[field] for field in FIELDS},
            "sincePreviousReady": {field: current[field] - prior[field] for field in FIELDS},
            "countMeaning": "Raw checked-in inventory; not an official completeness denominator or live delivery count.",
            "states": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="7dbad3bb5f2ebdee6ab41f9e094237aa00eecb83")
    parser.add_argument("--previous-ready")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    report = inventory(args.base, args.previous_ready)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.write:
        (ROOT / "data/ballot/reports/ba01-inventory.json").write_text(rendered)
    print(rendered if not args.write else json.dumps({key: report[key] for key in ("current", "added", "sincePreviousReady")}))
