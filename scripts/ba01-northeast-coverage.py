"""Produce the requested BA-01 source comparisons; this never gates publication."""
import collections
import csv
import datetime
from html.parser import HTMLParser
import importlib.util
import json
import pathlib
import re
import xml.etree.ElementTree as ET
import zipfile

SPEC = importlib.util.spec_from_file_location("ba01_northeast", pathlib.Path(__file__).with_name("ba01-northeast.py"))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)


def state_ballot(state):
    return next(iter(json.loads((COMMON.ROOT / f"data/ballot/2026-general/{state.lower()}.json").read_text())["ballots"].values()))


def inventory(state):
    ballot = state_ballot(state)
    return {"contests": len(ballot["contests"]), "candidateContests": sum(c["type"] == "CANDIDACY" for c in ballot["contests"]),
            "candidacies": len(ballot["candidacies"]), "measures": len(ballot["measures"])}


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag in {"td", "th"}:
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.row is not None and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        if tag == "tr" and self.row:
            self.rows.append(self.row)
            self.row = None


def rhode_island():
    ballot = state_ballot("RI")
    rows = []
    for office in [518, 548, 549, 551, 591, 592, 593, 617, 620, 621]:
        parser = TableRows()
        parser.feed((COMMON.SOURCES / f"ri-2026-office-{office}.html").read_text())
        rows += [row for row in parser.rows if len(row) >= 16 and row[13] == "Y"]
    official = collections.defaultdict(set)
    for row in rows:
        title = row[2] + (" " + row[3] if row[2] in {"REPRESENTATIVE IN GENERAL ASSEMBLY", "SENATOR IN GENERAL ASSEMBLY"} else "")
        official[title].add((COMMON.words(row[0]), row[1]))
    differences = []
    for title, expected in official.items():
        contest = next((c for c in ballot["contests"] if c["title"] == title), None)
        held = {(COMMON.words(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                for c in ballot["candidacies"] if contest and c["contestId"] == contest["id"]}
        if held != expected:
            differences.append({"title": title, "missing": sorted(expected-held), "extra": sorted(held-expected)})
    return {"officialCandidateContests": len(official), "officialCandidacies": len(rows), "differences": differences,
            "sources": [f"https://vote.sos.ri.gov/Candidates/CandidateSearchSummary?OfficeType={office}&Election=18144"
                        for office in [518, 548, 549, 551, 591, 592, 593, 617, 620, 621]],
            "remaining": "Local contests, local questions and statewide measure texts need sample-ballot comparison."}


def connecticut():
    ballot = state_ballot("CT")
    lookup = json.loads((COMMON.SOURCES / "ct-2026-108-47370-lookup.json").read_text())
    votes = json.loads((COMMON.SOURCES / "ct-2026-108-47370-votes.json").read_text())
    differences, missing_parties = [], []
    office_count, candidate_count = 0, 0
    for entry in lookup["officeList"]:
        office = next(iter(entry.values()))
        kind = office["OT"]
        if kind not in {"SW", "C", "S", "A"}:
            continue
        office_count += 1
        division = "ocd-division/country:us/state:ct" + ("/" + {"C": "cd", "S": "sldu", "A": "sldl"}[kind] + ":" + office["D"] if kind != "SW" else "")
        contest = next((c for c in ballot["contests"] if c["ocdId"] == division and
                        (kind != "SW" or COMMON.words(c["title"]) == COMMON.words(office["NM"]))), None)
        expected = []
        for row in votes[office["ID"]]:
            for candidate_id in row:
                candidate = lookup["candidateIds"][candidate_id]
                expected.append((COMMON.words(candidate["NM"]), lookup["partyIds"].get(candidate["P"], {}).get("NM")))
                if candidate["P"] not in lookup["partyIds"]:
                    missing_parties.append({"office": office["NM"], "name": candidate["NM"], "partyId": candidate["P"]})
        candidate_count += len(expected)
        held = {(COMMON.words(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                for c in ballot["candidacies"] if contest and c["contestId"] == contest["id"]}
        if {name for name, party in held} != {name for name, party in expected} or any(party is not None and (name, party) not in held for name, party in expected):
            differences.append(office["NM"])
    return {"officialCandidateContests": office_count, "officialCandidacies": candidate_count,
            "differences": differences, "currentPartyMetadataMissing": missing_parties,
            "sources": ["https://ctemspublic.tgstg.net/ng-app/data/election/108/Version.json",
                        "https://ctemspublic.tgstg.net/ng-app/data/election/108/47370/Lookupdata.json",
                        "https://ctemspublic.tgstg.net/ng-app/data/election/108/47370/stateVotes_Electiondata.json"],
            "remaining": "Five party IDs have no label in the current lookup; retain their prior official List of Nominees labels. Local probate, municipal contests and questions remain to be mapped and compared."}


def maine():
    ballot = state_ballot("ME")
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    groups = collections.defaultdict(set)
    local = collections.Counter()
    with zipfile.ZipFile(COMMON.SOURCES / "me-2026-final-candidates.xlsx") as workbook:
        strings = ["".join(item.itertext()) for item in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        for row in ET.fromstring(workbook.read("xl/worksheets/sheet1.xml")).findall(".//s:row", ns)[1:]:
            values = {}
            for cell in row:
                value = cell.find("s:v", ns)
                if value is not None:
                    values[re.sub(r"\d", "", cell.get("r"))] = (strings[int(value.text)] if cell.get("t") == "s" else value.text).strip()
            office = values.get("A")
            if not office:
                continue
            if office not in {"US", "CG", "GOV", "SS", "SR"}:
                local[office] += 1
                continue
            contest_id = "me-sos-2026-" + office.lower() + ("-" + values["B"] if values.get("B") else "")
            name = " ".join(values.get(key, "") for key in ["G", "H", "F", "I"])
            groups[contest_id].add((COMMON.words(name), values["D"]))
    regular_count = sum(map(len, groups.values()))
    writeins = []
    for line in COMMON.pdf_text(COMMON.SOURCES / "me-2026-declared-writeins.pdf").splitlines():
        cells = re.split(r"\s{2,}", line.strip())
        if cells[0] not in {"US", "CG", "GOV", "SR"}:
            continue
        office, district = cells.pop(0), ""
        if office in {"CG", "SR"}:
            district = "-" + cells.pop(0)
        if cells[0].startswith("independent/unenrolled "):
            party, name = "independent/unenrolled", cells[0].removeprefix("independent/unenrolled ")
        else:
            party, name = cells[:2]
        contest_id = "me-sos-2026-" + office.lower() + district
        groups[contest_id].add((COMMON.words(name), party))
        writeins.append((contest_id, name, party))
    differences = []
    for contest_id, expected in groups.items():
        held = {(COMMON.words(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                for c in ballot["candidacies"] if c["contestId"] == contest_id}
        if held != expected:
            differences.append({"contestId": contest_id, "missing": sorted(expected-held), "extra": sorted(held-expected)})
    return {"officialCandidateContests": len(groups), "officialCandidacies": sum(map(len, groups.values())),
            "officialNonWriteInCandidacies": regular_count, "officialStateWriteInCandidacies": len(writeins),
            "differences": differences, "unimportedRegularLocalCandidatesByOfficeCode": dict(local),
            "sources": ["https://www1.maine.gov/sos/sites/maine.gov.sos/files/inline-files/2026%20General%20Candidate%20List%20-%20FINAL.xlsx",
                        "https://www1.maine.gov/sos/sites/maine.gov.sos/files/inline-files/Nov26%20Declared%20Write%20in%20List.pdf",
                        "https://www1.maine.gov/sos/sites/maine.gov.sos/files/inline-files/2026%20Post%20Primary%20Withdrawals%20%26%20Replacement%20Candidates%20-%20Updated%209.22.26_0.pdf"],
            "remaining": "All 190 federal/statewide/legislative races and 362 names+party labels match the official workbook plus 10 declared write-ins. County offices, special county elections, local measures and exact address samples remain open. The official www1.maine.gov host resolves the main-host 403."}


def pennsylvania():
    ballot = state_ballot("PA")
    expected = {"ocd-division/country:us/state:pa"}
    counts = collections.Counter()
    with (COMMON.SOURCES / "pa-2026-primary-office-district-excerpts.csv").open() as source:
        for row in csv.reader(source):
            if row[8] in {"USC", "STS", "STH"}:
                kind = {"USC": "cd", "STS": "sldu", "STH": "sldl"}[row[8]]
                counts[kind] += 1
                expected.add(f"ocd-division/country:us/state:pa/{kind}:{int(row[5])}")
    held = {c["ocdId"] for c in ballot["contests"] if c["type"] == "CANDIDACY"}
    return {"expectedRegularCandidateContests": len(expected), "expectedDistrictCounts": dict(counts),
            "missingContestDivisions": sorted(expected-held),
            "basis": "Official 2026 primary returns contain 17 Congressional, 25 even-numbered Senate and 203 House office districts. The November Philadelphia sample combines Governor/Lieutenant Governor into one contest. This measures regular contest coverage; it does not establish a complete final certified general-election candidate list.",
            "sources": ["https://www.pa.gov/content/dam/copapwp-pagov/en/dos/resources/voting-and-elections/bulk-data/2026-general-primary/er/electionreturns_2026_primary_precinctreturns.txt",
                        "https://vote.phila.gov/files/SampleBallot/2026_General/6bcea152-a8f5-4365-baac-c7f4836390ba.pdf"],
            "originalReturnsSha256": "954119a4301f2dd6184b09cd25ff0d95c37b485ffbd92ec227f1b2b0b714b442",
            "remaining": f"Acquire all {len(expected-held)} missing regular districts and compare the entire final general-election candidate list; largest missing counties remain active acquisition work."}


def report():
    states = {state: {"held": inventory(state)} for state in ["PA", "NY", "NJ", "CT", "RI", "MA", "VT", "NH", "ME"]}
    states["RI"].update(rhode_island())
    states["CT"].update(connecticut())
    states["PA"].update(pennsylvania())
    states["ME"].update(maine())
    ny = COMMON.update_ny(datetime.datetime.now(datetime.timezone.utc).isoformat())[2]
    states["NY"].update(ny)
    states["NY"].update(officialCandidateContests=ny["officialContests"], officialCandidacies=ny["officialCandidates"])
    states["NY"]["remaining"] = "Eleven judicial-district contests and 52 distinct court candidacies in the certification remain to be imported with their geography; county and city ballot contents need sample comparison."
    states["NJ"].update(officialFederalContests=13, officialFederalCandidacies=39,
        remaining="All federal candidate sets checked. County/city/school coverage outside Morris County remains incomplete; statewide legislative absence needs an explicit final-office check.")
    states["MA"].update(officialCandidateContests=223, officialCandidacies=304,
        remaining="District/county offices, local measures and exact address sample-ballot parity remain open. Governor's Council address-to-district matching must be connected.")
    states["VT"].update(officialFederalStatewideLegislativeContests=132, officialFederalStatewideLegislativeCandidacies=319,
        verifiedLocalContests=6, verifiedLocalCandidacies=50,
        remaining="Chittenden County's five offices and Burlington justice-of-the-peace list match the city's sample ballot. The other 65 county office groups /94 candidates and remaining municipal lists remain open.")
    states["NH"].update(officialStatewideCount=None, remaining="Current official statewide September 17 candidate PDF and election page returned403 through HTTP and web routes. Held general-election sample ballots cover limited Merrimack County areas. Full state Legislature and House District1 remain incomplete; do not count400 House seats as400 contests.")
    return {"step": "BA-01", "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "scope": "Official-source comparison of assigned northeast states. Counts are measurements, never publication gates. Live ZIP parity is not yet established.",
            "states": states,
            "sampleBallots": [{"place": "Philadelphia split3-xx-182", "candidateContests": 3, "candidacies": 6, "measures": 2,
                               "url": "https://vote.phila.gov/files/SampleBallot/2026_General/6bcea152-a8f5-4365-baac-c7f4836390ba.pdf", "zip": "19103", "zipMappingVerified": False, "liveVerified": False},
                              {"place": "Burlington Chittenden13", "candidateContests": 15, "candidacies": 81, "measures": 2,
                               "url": "https://www.burlingtonvt.gov/DocumentCenter/View/12823/Chi-13-Sample?bidId=", "zip": "05401", "zipMappingVerified": False, "liveVerified": False}]}


if __name__ == "__main__":
    path = COMMON.ROOT / "data/ballot/reports/ba01-northeast.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    result = report()
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({state: {"held": row["held"], "officialCandidateContests": row.get("officialCandidateContests"),
        "officialCandidacies": row.get("officialCandidacies"), "differences": row.get("differences", row.get("mismatches"))}
        for state, row in result["states"].items()}))
