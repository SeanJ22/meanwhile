"""Replay West Virginia's official county ballot documents for BA-01.

The durable captures are pdftotext -raw source documents. Their metadata keeps
both the original PDF byte hash and the converted document hash. No source text
is generated or paraphrased, and no unnamed write-in is made into a candidate.
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import re
import subprocess
from collections import defaultdict
from urllib.parse import unquote

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARTY = r"REP|DEM|LBN|MTN|CST|IND"


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def document(captures, key):
    meta = json.loads((captures / (key + ".meta.json")).read_text())
    path = captures / key
    if path.exists():
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == meta["rawHash"]
        text = subprocess.check_output(["pdftotext", "-raw", "-", "-"], input=raw).decode()
    else:
        text = gzip.decompress((captures / (key + ".raw.txt.gz")).read_bytes()).decode()
        assert hashlib.sha256(text.encode()).hexdigest() == meta["extractedTextHash"]
    assert meta["httpStatus"] == 200
    return text, meta


def replay(captures, write):
    path = ROOT / "data/ballot/2026-general/wv.json"
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    registry = json.loads((ROOT / "data/derived/registration/wv.json").read_text())["divisions"]
    counties = {normalized(r[3].removesuffix(" County")): r[0] for r in registry if r[1] == "county"}
    existing = {(c["ocdId"], c["title"]) for c in ballot["contests"]}
    official_state = defaultdict(list)
    state_names = defaultdict(set)
    old_contests, old_candidates, old_measures = len(ballot["contests"]), len(ballot["candidacies"]), len(ballot["measures"])
    source_receipts = []
    county_headers = {"FOR COUNTY COMMISSIONER", "FOR COUNTY CLERK", "FOR CIRCUIT CLERK", "FOR SHERIFF", "FOR ASSESSOR", "FOR PROSECUTING ATTORNEY"}
    kanawha = None
    for meta_path in sorted(captures.glob("wv-county-*.meta.json")):
        key = meta_path.name.removesuffix(".meta.json")
        text, meta = document(captures, key)
        county = re.search(r"SAMPLE - WV (.+?) 261103 General", unquote(meta["finalUrl"]))[1]
        division = counties[normalized(county)]
        assert any(normalized(county + suffix) in normalized(text[:1500]) for suffix in [" County, WV", ", WV"])
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "West Virginia Secretary of State",
                      "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}
        if county == "Kanawha":
            kanawha = text, provenance
        groups, national = defaultdict(set), defaultdict(set)
        lines = text.splitlines()
        current, current_state = None, None
        for i, line in enumerate(lines):
            line = line.strip()
            ahead = " ".join(lines[i + 1:i + 5])
            if line == "FOR U.S. SENATOR":
                current_state, current = ("senate", 0, False), None
            elif line in ["FOR U.S. HOUSE OF REPRESENTATIVES", "FOR STATE SENATOR", "FOR MEMBER OF HOUSE OF DELEGATES"]:
                kind, district_word = {"FOR U.S. HOUSE OF REPRESENTATIVES": ("cd", "CONGRESSIONAL"),
                                       "FOR STATE SENATOR": ("sldu", "SENATORIAL"),
                                       "FOR MEMBER OF HOUSE OF DELEGATES": ("sldl", "DELEGATE")}[line]
                match = re.search(r"(\d+)(?:ST|ND|RD|TH) " + district_word + " DISTRICT", ahead)
                current_state = (kind, int(match[1]), "UNEXPIRED" in ahead) if match else None
                current = None
            elif line in county_headers:
                current_state = None
                current = line + (" — UNEXPIRED TERM" if "UNEXPIRED" in ahead else "")
            elif line.lower().startswith("write-in"):
                current = current_state = None
            elif current or current_state:
                match = re.fullmatch(r"(.+?)\s+(" + PARTY + r")", line)
                if match and not match[1].startswith("NO CANDIDATE"):
                    if current:
                        groups[current].add((match[1], match[2]))
                    else:
                        national[current_state].add((normalized(match[1]), match[2]))
        for contest, names in national.items():
            official_state[contest].append(len(names))
            state_names[contest].update(names)
        for title, rows in sorted(groups.items()):
            if (division, title) in existing:
                continue
            identifier = "wv-local-2026-" + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
            ballot["contests"].append({"id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
                "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "CANDIDACY", "candidateListComplete": True,
                "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": {**provenance, "quote": title}})
            for name, party in sorted(rows):
                ballot["candidacies"].append({"id": identifier + ":" + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16],
                    "contestId": identifier, "givenName": "", "familyName": name, "partyLabel": party,
                    "slogan": None, "incumbent": None, "websiteUrl": None,
                    "provenance": {**provenance, "quote": " | ".join([title, name, party])}})
        source_receipts.append({"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "httpStatus": 200,
            "rawHash": meta["rawHash"], "retrievedAt": meta["retrievedAt"], "publisher": "West Virginia Secretary of State",
            "sourceClass": "ELECTION_AUTHORITY", "reviewedEvidence": "Exact federal, legislative and county-wide candidate names and parties replayed from this saved official November 3 county ballot. Party placeholders and unnamed write-in lines are not candidates. Converted source text and its hash are saved alongside the original PDF hash."})

    assert len(official_state) == 122
    assert sum(max(counts) for counts in official_state.values()) == 243
    by_id = {c["id"]: c for c in ballot["contests"][:old_contests]}
    for candidacy in ballot["candidacies"][:old_candidates]:
        contest = by_id[candidacy["contestId"]]
        match = re.search(r"/(cd|sldu|sldl):(\d+)", contest["ocdId"])
        if not match and contest["ocdId"] != "ocd-division/country:us/state:wv":
            continue
        key = (match[1], int(match[2]), "Unexpired" in contest["title"]) if match else ("senate", 0, False)
        assert (normalized(candidacy["givenName"] + " " + candidacy["familyName"]), candidacy["partyLabel"]) in state_names[key]

    text, provenance = kanawha
    division = counties["kanawha"]
    names = ["ANDREA RICHMOND-BOARD", "PARIS WORKMAN", "EARL WHITTINGTON", "NICK QUINN", "WM. BOLTS WILLIS"]
    title = "MAGISTRATE - DIVISION 6 — UNEXPIRED TERM"
    if (division, title) not in existing:
        start = text.index("MAGISTRATE - DIVISION 6")
        end = text.index("Write-in, If Any", start)
        span = text[start:end]
        assert all("\n" + name + "\n" in span for name in names)
        identifier = "wv-kanawha-2026-magistrate-division-6-unexpired"
        ballot["contests"].append({"id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "CANDIDACY", "candidateListComplete": True,
            "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
        for name in names:
            ballot["candidacies"].append({"id": identifier + ":" + normalized(name), "contestId": identifier,
                "givenName": "", "familyName": name, "partyLabel": None, "slogan": None, "incumbent": None,
                "websiteUrl": None, "provenance": {**provenance, "quote": name}})
    start = text.index("OFFICIAL LEVY BALLOT")
    for suffix, purpose in [("school", "Instruction, Student Services, and Operations"), ("libraries", "Support for Public Libraries in Kanawha County")]:
        end = text.index("\nFor the Levies\nAgainst the Levies", start)
        span = text[start:end]
        removed = {"OFFICIAL LEVY BALLOT", "VOTE BOTH SIDES", "11", "21", "40", "41", "42", "43", "51", "S", "A", "M", "P", "L", "E"}
        question = " ".join(line.strip() for line in span.splitlines() if line.strip() and line.strip() not in removed)
        assert purpose in question
        identifier = "wv-kanawha-2026-" + suffix + "-levy-renewal"
        if not any(c["id"] == identifier for c in ballot["contests"]):
            title = "Election to Authorize Renewal of Additional Levies — " + purpose
            ballot["contests"].append({"id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
                "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "MEASURE", "measureTextUrl": provenance["sourceUrl"],
                "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
            ballot["measures"].append({"id": identifier + ":question", "contestId": identifier,
                "questionText": question, "officialStatement": None, "provenance": provenance})
        start = text.find("OFFICIAL LEVY BALLOT", end)
    if len(ballot["contests"]) > old_contests:
        identities = {(r["requestedUrl"], r["finalUrl"], r["rawHash"], r["retrievedAt"]): r for r in package["sourceReceipt"]["sources"] + source_receipts}
        package["sourceReceipt"]["sources"] = list(identities.values())
        package["sourceReceipt"]["reviewedAt"] = max(r["retrievedAt"] for r in source_receipts)
        package["sourceReceipt"]["reviewedBy"] = "BA-01 all-county official ballot replay"
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": "WV", "officialFederalLegislativeContests": 122, "officialMaximumPrintedCandidacies": 243,
            "addedContests": len(ballot["contests"]) - old_contests, "addedCandidacies": len(ballot["candidacies"]) - old_candidates,
            "addedMeasures": len(ballot["measures"]) - old_measures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--captures", type=pathlib.Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
