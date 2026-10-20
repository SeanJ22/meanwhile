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
held = {normalize(printed_name(row)) for row in b["candidacies"]}
source_names = {normalize(row[0]) for row in source}
assert held <= source_names
report("KS", "all offices in official candidate table", len({tuple(row[1:5]) for row in source}), len(source),
       len([row for row in b["contests"] if row["type"] != "MEASURE"]), len(b["candidacies"]),
       missing_judicial_contests=98, missing_judicial_candidates=99)

# Nebraska's first 92 non-NRD rows cover every statewide-list contest currently
# held. Two additional statewide workers' compensation retention names are in
# the separate retention publication, not this candidate PDF.
path, _meta = capture("ne", "pdf")
source = []
for page in (EVIDENCE / "ne-2026.txt").read_text().split("\f"):
    lines = page.splitlines()
    header = next((line for line in lines if line.startswith("Office") and "Candidate Name" in line), "")
    if not header:
        continue
    name_start, name_end = header.index("Candidate Name") - 2, header.index("City of Residence")
    for line in lines:
        if line.startswith("For ") and not line.startswith("For Board of Directors"):
            source.append(line[name_start:name_end].strip())
b = ballot("NE")
held = {printed_name(row) for row in b["candidacies"]}
assert len(source) == 92 and set(source) <= held
report("NE", "non-NRD statewide candidate list", 42, len(source), 42, len(source),
       separately_held_retention_names=sorted(held - set(source)), missing_nrd_candidate_rows=64)

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
assert {name for _title, names in source[:7] for name, _party in names} == held
report("MS", "entire statewide sample including regional judicial/DA races", len(source), sum(len(row[1]) for row in source),
       len(b["contests"]), len(b["candidacies"]), missing_regional_contests=126, missing_regional_candidates=166,
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
# 7 executive, 17 state Senate and 100 state House races. The three county
# notices/sample ballots give the names currently acquired, not all nominees.
_path, _meta = capture("ar-handbook", "pdf")
handbook = (EVIDENCE / "ar-handbook-2026.txt").read_text()
assert "One of two positions will be on the ballot in 2026" in handbook
assert "All four (4) positions will be on the ballot" in handbook
assert "All seven (7) constitutional offices are up for election in 2026" in handbook
assert "Seventeen (17) State Senate positions will be on the ballot" in handbook
assert "All one hundred (100) State House positions will be on the ballot" in handbook
b = ballot("AR")
candidate_contests = [row for row in b["contests"] if row["type"] == "CANDIDACY" and
                      not any(part in row["ocdId"] for part in ["/place:", "/county:"])]
report("AR", "regular federal/statewide/legislative offices in official handbook", 129, None,
       len(candidate_contests), sum(row["contestId"] in {contest["id"] for contest in candidate_contests} for row in b["candidacies"]),
       missing_contests=129 - len(candidate_contests), limitation="The complete statewide certified November candidate list remains unacquired; specials may add offices.")
