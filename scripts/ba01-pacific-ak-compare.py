"""Compare the readable tribal-government Alaska subset without changing data.

The underlying statewide DOE list remains an open transport failure. This source
is government-compiled and sometimes abbreviates names/parties; matching a family
name and first given word identifies the held row for review, not new candidate facts.
"""
import gzip
import hashlib
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/ba01-pacific-ak-evidence"


def key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower())


def run() -> dict:
    capture = json.loads((EVIDENCE / "capture.json").read_text())
    assert hashlib.sha256(gzip.decompress((EVIDENCE / "tlingit-haida.html.gz").read_bytes())).hexdigest() == capture["rawHash"]
    text = (EVIDENCE / "tlingit-haida.txt").read_text()
    text = text[text.index("General Election | Federal Offices"):]
    ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/ak.json").read_text())["ballots"].values()))
    groups = {}
    title = None
    for line in text.splitlines():
        if line == "U.S. Senate":
            title = "UNITED STATES SENATOR"
        elif line == "U.S. House of Representatives":
            title = "UNITED STATES REPRESENTATIVE"
        elif match := re.fullmatch(r"Alaska Senate \| District ([A-Z])", line):
            title = "SENATE DISTRICT " + match[1]
        elif match := re.fullmatch(r"(?:Alaska House \| District|House District) (\d+)", line):
            title = f"HOUSE DISTRICT {int(match[1]):02d}"
        elif line.startswith(("General Election |", "Visit Alaska Division")):
            title = None
        elif title and line.startswith(("- ", "•")) and " | " in line:
            name, party = line.lstrip("-• ").split(" | ", 1)
            party = party.split(", incumbent")[0].split("; ")[0].removesuffix(" Alaska Elections").rstrip(")")
            groups.setdefault(title, []).append((name, party))
    report = []
    for title, people in groups.items():
        contest = next(c for c in ballot["contests"] if c["title"] == title)
        matches = []
        for name, party in people:
            candidates = [c for c in ballot["candidacies"] if c["contestId"] == contest["id"] and
                          key(c["familyName"]) in key(name) and key(c["givenName"].split()[0]) == key(name.split()[0])]
            if len(candidates) != 1:
                matches.append({"sourceName": name, "sourceParty": party, "heldCandidacyId": None,
                                "status": "unresolved-name-difference; official DOE confirmation required"})
                continue
            candidate = candidates[0]
            party_matches = key(candidate["partyLabel"].replace("Registered ", "")) == key(party.replace("Registered ", ""))

            matches.append({"sourceName": name, "sourceParty": party, "heldCandidacyId": candidate["id"],
                            "matchingMethod": "family-name-and-first-given-word; no data changed", "partyMatches": party_matches})
        report.append({"title": title, "contestId": contest["id"], "sourceCandidateCount": len(people), "matches": matches})
    return {"state": "AK", "sourceUrl": capture["url"], "sourceType": "government-compiled subset; secondary to DOE",
            "comparedContests": len(report), "sourceCandidates": sum(len(r["matches"]) for r in report),
            "matchedCandidates": sum(bool(m.get("heldCandidacyId")) for r in report for m in r["matches"]),
            "unresolvedNames": [{"title": r["title"], **m} for r in report for m in r["matches"] if not m.get("heldCandidacyId")],
            "fullCertifiedStatewideComparisonComplete": False, "comparisons": report}


def certification() -> dict:
    capture = json.loads((EVIDENCE / "certification-capture.json").read_text())
    assert hashlib.sha256(gzip.decompress((EVIDENCE / "ltgov-certification.html.gz").read_bytes())).hexdigest() == capture["rawHash"]
    text = (EVIDENCE / "ltgov-certification.txt").read_text()
    assert "will certify Treg Taylor’s nomination for Governor and Jose Tagle’s nomination for State Representative for District 22" in text
    ballot = next(iter(json.loads((ROOT / "data/ballot/2026-general/ak.json").read_text())["ballots"].values()))
    matches = []
    for title, given, family in [("GOVERNOR / LIEUTENANT GOVERNOR", "Treg", "Taylor"), ("HOUSE DISTRICT 22", "Jose", "Tagle")]:
        contest = next(c for c in ballot["contests"] if c["title"] == title)
        people = [c for c in ballot["candidacies"] if c["contestId"] == contest["id"] and
                  key(given) in key(c["givenName"] + c["familyName"]) and key(family) in key(c["familyName"])]
        assert len(people) == 1, (title, people)
        matches.append({"contestId": contest["id"], "heldCandidacyId": people[0]["id"], "certifiedLeadName": given + " " + family,
                        "partyVerifiedByThisSource": False, "runningMateVerifiedByThisSource": False})
    return {"state": "AK", "sourceUrl": capture["url"], "sourceType": "state election executive certification decision",
            "certificationMatches": matches, "fullCertifiedStatewideComparisonComplete": False, "ballotRowsChanged": 0}


if __name__ == "__main__":
    result = run()
    (EVIDENCE / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    certified = certification()
    (EVIDENCE / "certification-comparison.json").write_text(json.dumps(certified, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "comparisons"}))
    print(json.dumps({"certifiedCandidateLeadMatches": len(certified["certificationMatches"]), "ballotRowsChanged": 0}))
