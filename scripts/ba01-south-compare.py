"""Recount saved official 2026 lists against held ballot data, one state at a time.

This is the BA-01 requested coverage comparison. It does not change publication
rules, approve records, or treat a state list as an individual voter's ballot.
"""
from collections import defaultdict, Counter
from pathlib import Path
import hashlib
import html
import json
import re
import runpy
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south"


def capture(stem, extension):
    path = EVIDENCE / (stem + "-2026." + extension)
    meta = json.loads((EVIDENCE / (stem + "-2026.source.json")).read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == meta["sha256"], path
    return path, meta


def ballot(state):
    data = json.loads((ROOT / ("data/ballot/2026-general/" + state.lower() + ".json")).read_text())
    assert len(data["ballots"]) == 1
    return next(iter(data["ballots"].values()))


def printed_name(row):
    return " ".join((row["givenName"] + " " + row["familyName"]).split())


def clean(value):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", value)).split())


def cells(source):
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", source, re.S | re.I):
        yield [clean(value) for value in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]


def report(state, scope, official_contests, official_candidates, matched_contests, matched_candidates, **rest):
    print(json.dumps({"state": state, "scope": scope, "official_contests": official_contests,
        "official_candidates": official_candidates, "matched_contests": matched_contests,
        "matched_candidates": matched_candidates, **rest}, ensure_ascii=False))


# Alabama's party certifications have 95 Democratic, 140 Republican and six
# independent nominees in this scope. The scans were rotated for OCR; official
# county samples resolve two OCR spelling errors without changing any data.
party_sources = {}
for stem, party in [("al-democratic", "Alabama Democratic Party"),
                    ("al-republican", "Alabama Republican Party"),
                    ("al-independent", "independent")]:
    _path, _meta = capture(stem, "pdf")
    party_sources[party] = (EVIDENCE / (stem + "-2026.txt")).read_text()
amendment = EVIDENCE / "al-republican-amendment-2026.txt"
amendment_meta = json.loads((EVIDENCE / "al-republican-amendment-2026.source.json").read_text())
assert hashlib.sha256(amendment.read_bytes()).hexdigest() == amendment_meta["sourceTextSha256"]
party_sources["Alabama Republican Party"] += amendment.read_text()
democratic_rows = [line for line in party_sources["Alabama Democratic Party"].splitlines() if re.match(
    r"^(United States Senator|United States Representative|Governor|Lieutenant Governor|Attomey General|Secretary of State|Treasurer|Auditor|Commissioner of Agriculture|Public Service Commissioner|State Senator|State Representative|Member, State Board|Associate Justice)", line)]
republican_base = (EVIDENCE / "al-republican-2026.txt").read_text()
republican_rows = [line for line in republican_base.splitlines() if re.match(
    r"^(U\.S\.|Governor|Lt\. Governor|Attorney General|Secretary of State|State Treasurer|State Auditor|Commissioner of Agriculture|Public Service Commission|Associate Justice|Alabama Court|State Board of Education|Alabama State Senate|Alabama House of Representatives)", line)]
assert len(democratic_rows) == 95 and len(republican_rows) == 135
assert len(re.findall(r"(?m)^Alabama State (?:Senate|House of Representatives), District", party_sources["independent"])) == 6
sample_spellings = (EVIDENCE / "al-shelby-2026.txt").read_text() + (EVIDENCE / "al-cullman-2026.txt").read_text()
b = ballot("AL")
normalize_name = lambda value: re.sub(r"[^a-z0-9]", "", value.lower())
old_scope = [row for row in b["candidacies"] if row["partyLabel"] in party_sources]
assert Counter(row["partyLabel"] for row in old_scope) == {"Alabama Democratic Party": 95, "Alabama Republican Party": 140, "independent": 6}
for row in old_scope:
    assert normalize_name(printed_name(row)) in normalize_name(party_sources[row["partyLabel"]] + sample_spellings)
amended_names = {printed_name(row) for row in old_scope if row["partyLabel"] == "Alabama Republican Party" and
                 normalize_name(printed_name(row)) not in normalize_name(republican_base)}
assert amended_names == {"Jerry Carl", "Rhett Marques", "Gary Palmer", "Ammie Akin", "Will Barfoot"}
certified_contests = {row["contestId"] for row in old_scope}
report("AL", "federal/statewide/legislative/education party certifications", 167, 241, len(certified_contests), len(old_scope),
       scope_breakdown={"federal": 8, "legislative": 140, "executive": 7, "public_service_commission": 2, "statewide_courts": 6, "state_board_of_education": 4},
       local_added_contests=16, local_added_candidates=23,
       limitation="The county samples cover multiple styles; full local district/measure coverage remains open.")


# Tennessee publishes one structured file per office family. Every exact
# office/name/party tuple is compared; House 93 explicitly has no qualified name.
b = ballot("TN")
held = defaultdict(set)
titles = {row["id"]: row["title"] for row in b["contests"]}
for row in b["candidacies"]:
    held[titles[row["contestId"]]].add((printed_name(row), row["partyLabel"]))
source = defaultdict(set)
ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
for family in ["Governor", "USSenate", "USHouse", "TNSenate", "TNHouse"]:
    path, _meta = capture("tn-" + family, "xlsx")
    with zipfile.ZipFile(path) as workbook:
        shared = ["".join(row.itertext()) for row in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("x:si", ns)]
        for row in ET.fromstring(workbook.read("xl/worksheets/sheet1.xml")).findall(".//x:row", ns)[1:]:
            values = {}
            for cell in row.findall("x:c", ns):
                raw = cell.find("x:v", ns)
                value = raw.text if raw is not None else ""
                values[cell.get("r")[0]] = shared[int(value)] if cell.get("t") == "s" and value else value
            if values.get("A") and values.get("B") and values["B"] != "No Candidate Qualified":
                source[values["A"]].add((values["B"], values.get("C")))
assert all(held[title] == names for title, names in source.items())
report("TN", "federal/statewide/legislative candidate lists", len(source), sum(map(len, source.values())), len(source), sum(map(len, source.values())),
       no_qualified_candidate="State House District 93")

# Kentucky's active list is separate from its withdrawn/disqualified section.
path, _meta = capture("ky-all", "html")
source = [row for row in cells(path.read_text().split('<a id="wddTop"', 1)[0]) if len(row) == 5 and
          row[2] in {"US Senator", "US Representative", "State Senator", "State Representative"}]
b = ballot("KY")
held = {printed_name(row) for row in b["candidacies"]}
assert {row[0] for row in source} == held
report("KY", "active federal/legislative candidate list", len({(row[2], row[3]) for row in source}), len(source),
       len({(row[2], row[3]) for row in source}), len(source))

# Oklahoma's official election list repeats a complete contest in every county
# it touches. Recount all 77 sections and deduplicate each office/name/party.
path, _meta = capture("ok-list", "html")
source = defaultdict(set)
title = ""
counties = set()
for line in path.read_text().splitlines():
    match = re.search(r"<A NAME=\d+>([^<]+)</A>", line, re.I)
    if match and re.fullmatch(r"[A-Z ]+", match[1]):
        counties.add(match[1])
    match = re.search(r"WIDTH=980>\s*<B>(.*?)</B>", line, re.I)
    if match:
        title = clean(match[1])
    match = re.search(r"WIDTH=970>\s*(.*?)</TD>", line, re.I)
    if match:
        value = clean(match[1]).rsplit(", ", 1)
        if len(value) == 2 and value[1] in {"REPUBLICAN", "DEMOCRAT", "LIBERTARIAN", "INDEPENDENT"}:
            source[title].add(tuple(value))
b = ballot("OK")
titles = {row["id"]: row["title"] for row in b["contests"] if row["type"] == "CANDIDACY"}
held = defaultdict(set)
for row in b["candidacies"]:
    if row["contestId"] in titles:
        held[titles[row["contestId"]]].add((printed_name(row), row["partyLabel"]))
assert len(counties) == 77 and all(source[title] == names for title, names in held.items())
report("OK", "printed federal/statewide/legislative election list", len(held), sum(map(len, held.values())), len(held), sum(map(len, held.values())),
       county_sections=len(counties), unopposed="The election authority omits unopposed offices from ballots.")

# Kansas's complete candidate table includes regional offices omitted from the
# previous projection. Three punctuation differences already use county notices.
path, _meta = capture("ks-all", "html")
source = [row for row in cells(path.read_text()) if len(row) == 25]
b = ballot("KS")
normalize = lambda value: re.sub(r"[^a-z0-9]", "", value.lower())
source_races = defaultdict(set)
for row in source:
    title = row[1].removeprefix("Member, ")
    for value, label in [(row[2], "District"), (row[3], "Position"), (row[4], "Division")]:
        if value != "0":
            title += " " + label + " " + value
    source_races[normalize(title)].add((normalize(row[0]), row[5]))
held_races = {}
for contest in b["contests"]:
    if contest["type"] == "MEASURE":
        continue
    key = normalize(contest["title"])
    assert key not in held_races
    held_races[key] = {(normalize(printed_name(row)), row["partyLabel"] or "")
                       for row in b["candidacies"] if row["contestId"] == contest["id"]}
assert len(source_races) == 247 and len(source) == 362
assert held_races == source_races
report("KS", "all offices in official candidate table, compared race by race", len(source_races), len(source),
       len(held_races), len(b["candidacies"]), missing_judicial_contests=0, missing_judicial_candidates=0,
       judicial_added_contests=98, judicial_added_candidates=99, whole_county_memberships=78,
       limitation="County/city/school/special-district contests and local measures remain open; no live ZIP completeness claimed.")

# The full official table has 521 candidate rows. Core offices are only the
# first 92; wrapped continuation headings are not candidate rows.
ne_inventory=runpy.run_path(str(ROOT/'scripts/ba01-south-ne-rows.py'))['result']
b=ballot('NE');held={printed_name(row) for row in b['candidacies']}
core={row['name'] for row in ne_inventory['rows'] if row['category']=='CORE'}
assert len(core)==92 and core<=held
categories=ne_inventory['categories']
report('NE','entire official statewide candidate table, including regional and local offices',
       sum(value['officeDistrictTermTuples'] for value in categories.values()),ne_inventory['candidateRows'],42,92,
       core_contests=42,core_candidates=92,separately_held_retention_names=sorted(held-core),
       missing_nrd_contests=categories['NATURAL_RESOURCES']['officeDistrictTermTuples'],
       missing_nrd_candidate_rows=categories['NATURAL_RESOURCES']['candidateRows'],
       missing_other_regional_local_contests=categories['OTHER_REGIONAL_LOCAL']['officeDistrictTermTuples'],
       missing_other_regional_local_candidate_rows=categories['OTHER_REGIONAL_LOCAL']['candidateRows'],
       limitation='Exact NRD, community-college, utility/power, educational-service, learning-community and reclamation electorates remain open. No live ZIP completeness claimed.')

# Mississippi's statewide composite explicitly prints every one of these races;
# regional judicial/DA districts cannot be replaced by a statewide division.
path, _meta = capture("ms", "pdf")
source = []
text = (EVIDENCE / "ms-2026.txt").read_text()
for match in re.finditer(r"(?m)^For (.*?)\nVote for ONE\n(.*?)\nWrite-in", text, re.S):
    names = re.findall(r"(?m)^(.+) (Democrat|Republican|Independent|Libertarian|Nonpartisan)$", match[2])
    source.append(("For " + " ".join(match[1].splitlines()), names))
b = ballot("MS")
held = {printed_name(row) for row in b["candidacies"]}
assert {name for _title, names in source[:7] for name, _party in names} <= held
source_titles = {title.removeprefix("For "): names for title, names in source[7:]}
held_titles = {row["title"]: row for row in b["contests"] if row["id"].startswith("ms-ba01-2026-") and row["title"] in source_titles}
assert len(held_titles) == 93
for title, contest in held_titles.items():
    assert title in source_titles
    assert {(printed_name(row), row["partyLabel"]) for row in b["candidacies"] if row["contestId"] == contest["id"]} == set(source_titles[title])
report("MS", "entire statewide sample including regional judicial/DA races", len(source), sum(len(row[1]) for row in source),
       7 + len(held_titles), 22 + sum(len(source_titles[title]) for title in held_titles),
       missing_regional_contests=len(source) - 7 - len(held_titles), missing_regional_candidates=sum(len(row[1]) for row in source) - 22 - sum(len(source_titles[title]) for title in held_titles),
       judicial_added_contests=92, judicial_added_candidates=119, special_da_added_contests=1, special_da_added_candidates=5, whole_county_memberships=139,
       local_added_contests=2, local_added_candidates=2, package_contests=len(b["contests"]), package_candidates=len(b["candidacies"]),
       limitation="Other appellate county relations and partial-county judicial/DA electorates remain open; no live ZIP completeness claimed.",
       federal_legislative_contests=7, federal_legislative_candidates=22)

# Louisiana's federal/legislative selector has exactly eight offices; the other
# statewide inquiry choices include regional/local offices and unopposed names.
path, _meta = capture("la-candidates", "html")
source = []
for section in path.read_text().split('<div class="candidate-section">')[1:]:
    match = re.search(r'<div class="col-sm-5 col-xs-12">\s*<span.*?</span>\s*(.*?)\s*</div>', section, re.S)
    if match:
        source.append(clean(match[1]))
b = ballot("LA")
assert set(source) == {printed_name(row) for row in b["candidacies"]}
report("LA", "federal/legislative candidate inquiry", 8, len(source), 8, len(source),
       other_office_selectors=317, limitation="Candidate inquiry status does not prove every selected office prints on every ballot.")

# Arkansas's official 2026 running-for-office handbook states 1 Senate, 4 House,
# 7 executive, 17 state Senate and 100 state House races. The public roster's
# candidate modal supplies explicit general-ballot and withdrawal status.
_path, _meta = capture("ar-handbook", "pdf")
handbook = (EVIDENCE / "ar-handbook-2026.txt").read_text()
assert "One of two positions will be on the ballot in 2026" in handbook
assert "All four (4) positions will be on the ballot" in handbook
assert "All seven (7) constitutional offices are up for election in 2026" in handbook
assert "Seventeen (17) State Senate positions will be on the ballot" in handbook
assert "All one hundred (100) State House positions will be on the ballot" in handbook
b = ballot("AR")
candidate_contests = [row for row in b["contests"] if row["type"] == "CANDIDACY" and
                      not any(part in row["ocdId"] for part in ["/place:", "/county:", "/circuit_court:"])]
roster_path = EVIDENCE / "ar-core/sos-general-roster.json"
roster_meta = json.loads((EVIDENCE / "ar-core/sos-general-roster.source.json").read_text())
assert hashlib.sha256(roster_path.read_bytes()).hexdigest() == roster_meta["sha256"]
roster = json.loads(roster_path.read_text())
assert roster["recordsTotal"] == roster["recordsFiltered"] == len(roster["data"]) == 198
for capture_row in json.loads((EVIDENCE / "ar-core/sos-general-details.json").read_text())["sources"]:
    assert hashlib.sha256(capture_row["body"].encode()).hexdigest() == capture_row["sha256"]
    detail = json.loads(capture_row["body"])
    assert detail["ElecCyDesc"] == "General and Nonpartisan Judicial Runoff"
    assert detail["OnGeneralBallot"] == "True" and detail["Withdrawn"] == "False"
regular = [row for row in candidate_contests if "special election" not in row["title"].lower()]
special = [row for row in candidate_contests if "special election" in row["title"].lower()]
assert len(regular) == 129 and len(special) == 2
regular_ids = {row["id"] for row in regular}
special_ids = {row["id"] for row in special}
regular_candidates = sum(row["contestId"] in regular_ids for row in b["candidacies"])
special_candidates = sum(row["contestId"] in special_ids for row in b["candidacies"])
assert regular_candidates == 186 and special_candidates == 4
assert {int(row["ocdId"].rsplit(":", 1)[1]) for row in regular if "/sldl:" in row["ocdId"]} == set(range(1, 101))
assert {int(row["ocdId"].rsplit(":", 1)[1]) for row in regular if "/sldu:" in row["ocdId"]} == {2, 7, 9, 10, 11, 13, 14, 15, 16, 21, 24, 27, 28, 30, 31, 32, 35}
report("AR", "regular federal/statewide/legislative general-ballot roster", 129, 186,
       len(regular), regular_candidates, missing_contests=0, special_contests=2, special_candidates=4,
       matched_regional_contests=3, matched_regional_candidates=6, missing_regional_contests=1, missing_regional_candidates=2,
       limitation="The District 11-West prosecutor electorate and full local coverage remain open; no live ZIP completeness claimed.")
