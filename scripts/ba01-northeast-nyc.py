"""Replay NYC's complete official sample for 315 West29St, ZIP10001.

Capture used the normal public FindMyPollsite UI; the saved client JavaScript
documents the read-only API calls. This address proves one ballot style, and
never widens an election district, Assembly district or ZIP to a local district.
"""
import datetime
import importlib.util
import json
import pathlib
import re
import argparse
import subprocess

SPEC = importlib.util.spec_from_file_location("ba01_northeast", pathlib.Path(__file__).with_name("ba01-northeast.py"))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
PREFIX = "ocd-division/country:us/state:ny/"
PUBLISHER = "New York City Board of Elections"
SOURCE = "nyc-10001-contests.json"
LOCAL = {
    "Surrogate New York": ("ny-2026-new-york-county-surrogate", "county:new_york"),
    "Judge of the Civil Court - County New York": ("ny-2026-new-york-county-civil-court", "county:new_york"),
    "Member of the City Council 3rd Council District": ("ny-2026-new-york-city-council-3", "place:new_york/council_district:3"),
    "Judge of the Civil Court - District 3rd Municipal Court District - New York":
        ("ny-2026-new-york-county-municipal-court-3", "county:new_york/municipal_court_district:3"),
    "Judge of the Civil Court - County Kings": ("ny-2026-kings-county-civil-court", "county:kings"),
    "Judge of the Civil Court - County Queens": ("ny-2026-queens-county-civil-court", "county:queens"),
    "Judge of the Civil Court - District 4th Municipal Court District - Queens":
        ("ny-2026-queens-county-municipal-court-4", "county:queens/municipal_court_district:4"),
    "Surrogate Bronx": ("ny-2026-bronx-county-surrogate", "county:bronx"),
    "Judge of the Civil Court - District 2nd Municipal Court District - Bronx":
        ("ny-2026-bronx-county-municipal-court-2", "county:bronx/municipal_court_district:2"),
    "Judge of the Civil Court - County Richmond": ("ny-2026-richmond-county-civil-court", "county:richmond"),
}
REGULAR = {
    "Governor/Lieutenant Governor Citywide": "ny-boe:2026-general:governor-lieutenant-governor",
    "State Comptroller Citywide": "ny-boe:2026-general:comptroller",
    "Attorney General Citywide": "ny-boe:2026-general:attorney-general",
    "Justice of the Supreme Court 1st Judicial District": "ny-2026-general:supreme-court-1",
    "Representative in Congress 12th Congressional District": "ny-boe:2026-general:cd:12",
    "State Senator 47th Senatorial District": "ny-boe:2026-general:sldu:47",
    "Member of the Assembly 75th Assembly District": "ny-boe:2026-general:sldl:75",
}


def source_rows():
    document = json.loads((COMMON.SOURCES / SOURCE).read_text())
    assert len(document["parties"]) == 1
    pollsite = json.loads((COMMON.SOURCES / "nyc-10001-pollsite.json").read_text())
    assert any(e["YYYYMMDD_StartDate"] == "20261103" and e["ElectionType"] == "General Election" for e in pollsite["elections"])
    return document["parties"][0]["contests"]


def choices(row):
    names = {}
    for candidate in row["candidacies"]:
        if not candidate["writeIn"]:
            names.setdefault(candidate["ballot_name"], []).append(candidate["party"])
    return names


def normalized_choices(row):
    # The official Brooklyn style spells the same certified person's surname
    # Jean Jacques on one party line and Jean-Jacques on two other lines.
    names = {}
    for name, parties in choices(row).items():
        names.setdefault(COMMON.words(name.replace(" / ", " and ")), set()).update(parties)
    return {(name, frozenset(parties)) for name, parties in names.items()}


def put_local(ballot, row, provenance):
    title = row["contest_description"]
    contest_id, division = LOCAL[title]
    contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
    if contest is None:
        contest = {"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": PREFIX + division,
                   "divisionVintage": "2026", "title": title, "type": "CANDIDACY", "voteFor": row["vote_for"],
                   "termYears": None, "scopeNote": None, "candidateListComplete": True}
        ballot["contests"].append(contest)
    contest["provenance"] = provenance
    for name, parties in choices(row).items():
        candidate_id = contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        candidate = next((c for c in ballot["candidacies"] if c["id"] == candidate_id), None)
        if candidate is None:
            candidate = {"id": candidate_id, "contestId": contest_id, "givenName": "", "familyName": name,
                         "partyLabel": " / ".join(parties), "slogan": None, "incumbent": None, "websiteUrl": None}
            ballot["candidacies"].append(candidate)
        candidate["provenance"] = {**provenance, "quote": title + " | " + name + " | " + " / ".join(parties)}


def borough_samples():
    for sample in json.loads((COMMON.SOURCES / "nyc-borough-samples.json").read_text()):
        document = json.loads((COMMON.SOURCES / sample["sourceFile"]).read_text())
        pollsite = json.loads((COMMON.SOURCES / sample["pollsiteFile"]).read_text())
        assert any(e["YYYYMMDD_StartDate"] == "20261103" and e["ElectionType"] == "General Election" for e in pollsite["elections"])
        yield sample, document["parties"][0]["contests"]


def regular_id(title):
    if title in REGULAR:
        return REGULAR[title]
    number = re.search(r"(\d+)(?:st|nd|rd|th) ", title)[1]
    if title.startswith("Justice of the Supreme Court"):
        return "ny-2026-general:supreme-court-" + number
    kind = "cd" if title.startswith("Representative in Congress") else "sldu" if title.startswith("State Senator") else "sldl"
    return "ny-boe:2026-general:" + kind + ":" + number


def borough_comparisons(ballot):
    reports = []
    for sample, rows in borough_samples():
        differences, races = [], []
        for row in rows:
            title = row["contest_description"]
            if row["proposal_text"]:
                number = re.match(r"Proposal Number (\d+),", title)[1]
                contest_id = "ny-2026-new-york-city-charter-proposal-" + number
                measure = next(m for m in ballot["measures"] if m["contestId"] == contest_id)
                if " ".join((measure["questionText"] + " " + (measure.get("officialStatement") or "")).split()) != " ".join(row["proposal_text"].split()):
                    differences.append({"contestId": contest_id, "measureTextMismatch": True})
                races.append({"contestId": contest_id, "measure": True})
                continue
            contest_id = LOCAL[title][0] if title in LOCAL else regular_id(title)
            normalize = lambda s: COMMON.words(s.replace(" / ", " and "))
            expected = normalized_choices(row)
            held = {(normalize(c["givenName"] + " " + c["familyName"]), frozenset(c["partyLabel"].split(" / ")))
                    for c in ballot["candidacies"] if c["contestId"] == contest_id}
            contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
            if held != expected or not contest or contest["voteFor"] != row["vote_for"]:
                differences.append({"contestId": contest_id, "candidateOrVoteForMismatch": True})
            races.append({"contestId": contest_id, "officialCandidacies": len(expected)})
        reports.append({**sample, "officialContests": len(rows), "officialCandidateContests": sum(not bool(r["proposal_text"]) for r in rows),
                        "officialCandidacies": sum(len(normalized_choices(r)) for r in rows if not r["proposal_text"]), "officialMeasures": 5,
                        "races": races, "differences": differences, "liveVerified": False,
                        "remaining": "This official address proves its ballot style. ZIP-wide address resolution and live delivery remain unverified."})
    return reports


def capture_sources():
    subprocess.run(["node", str(COMMON.ROOT / "scripts/ba01-northeast-nyc-capture.mjs")], check=True)
    directory = pathlib.Path("/tmp/ba01-northeast-nyc-capture")
    captures = json.loads((directory / "nyc-10001-captures.json").read_text())
    path = COMMON.ROOT / "data/ballot/2026-general/ny.json"; data = json.loads(path.read_text())
    for meta in captures:
        target = COMMON.SOURCES / meta["name"]; target.write_bytes((directory / meta["name"]).read_bytes())
        receipt = COMMON.receipt(target, meta["requestedUrl"], PUBLISHER, meta["retrievedAt"],
            "Actual normal public pollsite UI response; source bytes captured at this response-completion timestamp.")
        assert receipt["rawHash"] == meta["rawHash"]
        receipt["finalUrl"] = meta["finalUrl"]
        COMMON.add_receipt(data, receipt, meta["retrievedAt"], captured=True)
    (COMMON.SOURCES / "nyc-10001-captures.json").write_text(json.dumps(captures, indent=2) + "\n")
    (COMMON.SOURCES / "nyc-10001-rendered.html").write_bytes((directory / "nyc-10001-rendered.html").read_bytes())
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def sample_comparison(ballot):
    differences, races = [], []
    for row in source_rows():
        if row["proposal_text"]:
            number = re.match(r"Proposal Number (\d+),", row["contest_description"])[1]
            contest_id = "ny-2026-new-york-city-charter-proposal-" + number
            measure = next((m for m in ballot["measures"] if m["contestId"] == contest_id), None)
            full = " ".join(row["proposal_text"].split())
            if measure is None or " ".join((measure["questionText"] + " " + (measure.get("officialStatement") or "")).split()) != full:
                differences.append({"contest": row["contest_description"], "measureTextMismatch": True})
            races.append({"officialContest": row["contest_description"], "heldId": contest_id, "measure": True})
            continue
        name = row["contest_description"]
        contest_id = LOCAL[name][0] if name in LOCAL else REGULAR[name]
        normalize = lambda s: COMMON.words(s.replace(" / ", " and "))
        official = {(normalize(n), frozenset(ps)) for n, ps in choices(row).items()}
        held = {(normalize(c["givenName"] + " " + c["familyName"]), frozenset(c["partyLabel"].split(" / ")))
                for c in ballot["candidacies"] if c["contestId"] == contest_id}
        contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
        if official != held or not contest or contest["voteFor"] != row["vote_for"]:
            differences.append({"contest": name, "candidateOrVoteForMismatch": True})
        races.append({"officialContest": name, "heldId": contest_id, "candidacies": len(official)})
    return {"zip": "10001", "address": "315 West29St", "officialCandidateContests": 11, "officialCandidacies": 32,
            "officialMeasures": 5, "officialContests": 16, "differences": differences, "races": races,
            "officialDistrictsVerified": True, "liveVerified": False,
            "sourceUrl": next(r["requestedUrl"] for r in json.loads((COMMON.SOURCES / "nyc-10001-captures.json").read_text()) if r["name"] == SOURCE),
            "remaining": "Live delivery and local municipal-court/City-Council address resolution remain unverified. This one address does not prove every address in the ZIP."}


def update(at):
    path = COMMON.ROOT / "data/ballot/2026-general/ny.json"
    data = json.loads(path.read_text()); ballot = next(iter(data["ballots"].values()))
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    meta = next(r for r in json.loads((COMMON.SOURCES / "nyc-10001-captures.json").read_text()) if r["name"] == SOURCE)
    url = meta["requestedUrl"]; captured_at = COMMON.capture_time(data, url, COMMON.SOURCES / SOURCE)
    for row in source_rows():
        title = row["contest_description"]
        provenance = {"sourceUrl": url, "sourceOrg": PUBLISHER, "collectedAt": captured_at, "verifiedAt": at, "quote": title}
        if title in LOCAL:
            put_local(ballot, row, provenance)
        elif row["proposal_text"]:
            number = re.match(r"Proposal Number (\d+),", title)[1]
            contest_id = "ny-2026-new-york-city-charter-proposal-" + number
            contest = next(c for c in ballot["contests"] if c["id"] == contest_id)
            measure = next(m for m in ballot["measures"] if m["contestId"] == contest_id)
            question, statement = re.split(r"\r?\n\s*\r?\n", row["proposal_text"], maxsplit=1)
            question, statement = " ".join(question.split()), " ".join(statement.split())
            provenance["quote"] = " ".join(row["proposal_text"].split())
            contest["provenance"] = provenance
            measure.update(questionText=question, officialStatement=statement, provenance=provenance)
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / SOURCE, url, PUBLISHER, captured_at,
        "Normal public official pollsite UI retrieved16 contests for315 West29St,10001:11 candidate contests with32 distinct candidacies,5 charter questions. "
        "All printed candidate names and party lines compared race by race; blank write-in slots do not invent candidates. "
        "Full linked sample PDF retained. Only four missing local races/seven candidates are added; earlier verified state/court IDs are preserved. "
        "This official current ballot confirms five questions, resolving the unsupported NYC311 count of six for this ballot."), at)
    comparison = sample_comparison(ballot)
    if comparison["differences"]:
        raise ValueError(comparison["differences"])
    for sample, rows in borough_samples():
        captured_at = COMMON.capture_time(data, sample["sourceUrl"], COMMON.SOURCES / sample["sourceFile"])
        for row in rows:
            if row["contest_description"] in LOCAL:
                put_local(ballot, row, {"sourceUrl": sample["sourceUrl"], "sourceOrg": PUBLISHER, "collectedAt": captured_at,
                                      "verifiedAt": at, "quote": row["contest_description"]})
    comparisons = borough_comparisons(ballot)
    if any(r["differences"] for r in comparisons):
        raise ValueError(comparisons)
    return path, data, {"state": "NY", "before": before, "after": (len(ballot["contests"]), len(ballot["candidacies"])),
                        "sampleComparison": comparison, "boroughComparisons": comparisons}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--refresh-sources", action="store_true", help="capture the normal public UI with Playwright, preserving TLS verification")
    args = parser.parse_args()
    if args.refresh_sources:
        capture_sources()
    path, data, report = update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
