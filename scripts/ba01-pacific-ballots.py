"""Replay official BA-01 Pacific source captures and add verified ballot rows.

The source directory contains public ballot fields copied from the official
candidate export, the saved county candidate HTML, and text extracted by column
from official sample ballots. Mailing/contact fields are never copied.
Run with --apply to merge the additions; without it this reports the comparison.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ROOT / "data/ballot/ba01-pacific-evidence"


def compact(value: str) -> str:
    return " ".join(value.split())


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def provenance(url: str, publisher: str, quote: str) -> dict:
    metadata = json.loads((SOURCES / "captures.json").read_text())
    capture = next(c for c in metadata if c["url"] == url)
    return {"sourceUrl": url, "sourceOrg": publisher,
            "collectedAt": capture["retrievedAt"], "verifiedAt": capture["retrievedAt"], "quote": quote}


def source_receipt(data: dict, url: str, publisher: str) -> None:
    metadata = json.loads((SOURCES / "captures.json").read_text())
    capture = next(c for c in metadata if c["url"] == url)
    receipt = {"requestedUrl": url, "finalUrl": url, "publisher": publisher,
               "sourceClass": "OFFICIAL_PUBLISHER" if "courts.oregon.gov" in url or "ajc.alaska.gov" in url else "ELECTION_AUTHORITY", "retrievedAt": capture["retrievedAt"],
               "httpStatus": 200, "rawHash": capture["rawHash"],
               "reviewedEvidence": capture["method"]}
    prior = next((s for s in data["sourceReceipt"]["sources"] if s.get("rawHash") == receipt["rawHash"]
                  and s.get("finalUrl") == url and s.get("retrievedAt") == receipt["retrievedAt"]), None)
    if prior is None:
        data["sourceReceipt"]["sources"].append(receipt)
    else:
        prior.update(receipt)
    data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], capture["retrievedAt"])
    data["sourceReceipt"]["reviewedBy"] = "ba01-pacific-source-replay"


def add_contest(ballot: dict, title: str, division: str, candidates: list[dict],
                prov: dict, vote_for: int = 1, term_years: int | None = None) -> int:
    contest_id = f"ba01-{ballot['election']['state'].lower()}-{slug(title)}"
    if any(c["id"] == contest_id for c in ballot["contests"]):
        return 0
    assert candidates and len({c["name"] for c in candidates}) == len(candidates)
    ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
        "ocdId": division, "divisionVintage": "2026", "title": title, "type": "CANDIDACY",
        "voteFor": vote_for, "termYears": term_years, "candidateListComplete": True,
        "scopeNote": None, "provenance": prov})
    for c in candidates:
        ballot["candidacies"].append({"id": contest_id + ":" + hashlib.sha256(c["name"].encode()).hexdigest()[:16],
            "contestId": contest_id, "familyName": c["name"], "givenName": "",
            "partyLabel": c.get("party"), "slogan": None, "incumbent": None,
            "websiteUrl": c.get("website"), "provenance": {**prov, "quote": c.get("quote", c["name"])}})
    return 1


def add_measure(ballot: dict, title: str, number: str | None, division: str, question: str, prov: dict) -> int:
    contest_id = f"ba01-{ballot['election']['state'].lower()}-{slug(title)}"
    if any(c["id"] == contest_id for c in ballot["contests"]):
        return 0
    assert "?" in question
    ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
        "ocdId": division, "divisionVintage": "2026", "title": title, "type": "MEASURE",
        "voteFor": 1, "termYears": None, "measureTextUrl": prov["sourceUrl"],
        "scopeNote": None, "provenance": prov})
    ballot["measures"].append({"id": contest_id + ":question", "contestId": contest_id,
        **({"officialNumber": number} if number else {}),
        "questionText": question, "officialStatement": None, "provenance": prov})
    return 1


def hawaii(data: dict) -> dict:
    ballot = next(iter(data["ballots"].values()))
    url = "https://olvr.hawaii.gov/Controls/CandidateFiling.aspx?elid=94"
    publisher = "Hawaii Office of Elections"
    rows = list(csv.DictReader(gzip.open(SOURCES / "hi-candidate-report.csv.gz", "rt")))
    assert len(rows) == 415
    general = [r for r in rows if r["Status"] == "In General"]
    assert len(general) == 140
    groups: dict[str, list[dict]] = {}
    for row in general:
        groups.setdefault(row["Contests"], []).append(row)
    assert len(groups) == 61
    local = {title: people for title, people in groups.items()
             if re.match(r"(?:HAWAII|HONOLULU|MAUI|KAUAI) (?:COUNCILMEMBER|MAYOR)", title)}
    assert len(local) == 17 and sum(map(len, local.values())) == 44
    added = 0
    roman = {"IV": 4, "VI": 6}
    for title, people in local.items():
        county = title.split()[0].lower()
        division = f"ocd-division/country:us/state:hi/county:{county}"
        if county in ["hawaii", "honolulu"]:
            district = title.rsplit(" ", 1)[-1]
            district = str(roman[district]) if district in roman else district
            division += f"/council_district:{district}"
        candidates = [{"name": r["BallotName"], "party": r["Party"] or None,
                       "website": r["Website"].strip() or None,
                       "quote": " | ".join(r[k] for k in ["Contests", "Party", "BallotName", "Website", "Status"])}
                      for r in people]
        added += add_contest(ballot, title, division, candidates,
                             provenance(url, publisher, title), 7 if title == "KAUAI COUNCILMEMBER" else 1)
    source_receipt(data, url, publisher)
    sample_url = "https://files.hawaii.gov/elections/files/SampleBallots/2026-General/GeneralElectionEnglish/FAX001_2401_1.pdf"
    questions = (SOURCES / "hi-honolulu-charter-questions.txt").read_text()
    parsed = re.findall(r"Charter Question #(\d+)\s+(.*?)\s+YES\s+NO", questions, re.S)
    assert [int(n) for n, _ in parsed] == list(range(1, 21))
    measures_added = 0
    for number, question in parsed:
        question = compact(question)
        measures_added += add_measure(ballot, f"Honolulu Charter Question #{number}",
            f"Charter Question #{number}", "ocd-division/country:us/state:hi/county:honolulu", question,
            provenance(sample_url, publisher, f"Charter Question #{number}\n{question}"))
    source_receipt(data, sample_url, publisher)
    source_receipt(data, "https://elections.hawaii.gov/2026-proclamation/", publisher)
    for county, code in [("hawaii", "0101"), ("maui", "0901"), ("kauai", "1601")]:
        ocr = (SOURCES / f"hi-{county}-local-measures-ocr.txt").read_text()
        if county == "maui":
            local_questions = re.findall(r"(Maui:.*?)\n+(Shall.*?\?)", ocr, re.S)
            assert len(local_questions) == 8
        elif county == "hawaii":
            local_questions = re.findall(r"(1\. Hawai.*?)\n+(Shall.*?\?)", ocr, re.S)
            assert len(local_questions) == 1
        else:
            local_questions = re.findall(r"(Relating to the Planning.*?)\n(Shall.*?\?)", ocr, re.S)
            assert len(local_questions) == 1
        county_url = f"https://files.hawaii.gov/elections/files/SampleBallots/2026-General/GeneralElectionEnglish/FAX001_{code}_1.pdf"
        for title, question in local_questions:
            title, question = compact(title), compact(question)
            measures_added += add_measure(ballot, title, "1" if county == "hawaii" else None,
                f"ocd-division/country:us/state:hi/county:{county}", question,
                provenance(county_url, publisher, f"{title}\n{question}"))
        source_receipt(data, county_url, publisher)
    # The general export now includes local contests as well as the original 96 people.
    ballot["coverageNotes"] = [s for s in ballot.get("coverageNotes", [])
                               if not s.startswith("The Governor and Lieutenant Governor form")]
    note = "The Governor and Lieutenant Governor form two joint ticket choices. All 140 people listed In General in the complete official Candidate Report are represented, including the 44 local candidates. Official sample ballots supply 20 Honolulu, eight Maui, one Hawaii and one Kauai county charter questions."
    ballot["coverageNotes"] = [s for s in ballot["coverageNotes"] if not s.startswith("The Governor and Lieutenant Governor form two joint ticket choices.")]
    if note not in ballot["coverageNotes"]:
        ballot["coverageNotes"].append(note)
    return {"state": "HI", "officialFilingRows": len(rows), "officialGeneralPeople": len(general),
            "officialGeneralContestsAfterJointTicket": len(groups) - 1,
            "newLocalContests": added, "newLocalCandidates": 44 if added else 0,
            "newLocalMeasures": measures_added}


def king_candidates() -> list[tuple[str, list[str]]]:
    source = gzip.decompress((SOURCES / "wa-king-candidates.html.gz").read_bytes()).decode()
    plain = lambda s: compact(html.unescape(re.sub(r"<[^>]+>", " ", s)))
    result = []
    for m in re.finditer(r'<h5[^>]*>(.*?)</h5>(.*?)(?=<h5|</div><div class="list-group pull-left|$)', source, re.S):
        title = plain(m[1])
        names = [plain(n) for n in re.findall(r'class="ballotname"[^>]*>(.*?)</span>', m[2], re.S)]
        if names:
            result.append((title, names))
    assert len(result) == 97 and sum(len(names) for _, names in result) == 153
    return result


def washington(data: dict) -> dict:
    ballot = next(iter(data["ballots"].values()))
    export_url = "https://voter.votewa.gov/CandidateList.aspx?ctl00_ContentPlaceHolder1_grdCandidatesChangePage=1_100&e=899"
    official = list(csv.DictReader(gzip.open(SOURCES / "wa-general-candidate-export.csv.gz", "rt", encoding="utf-8-sig")))
    assert len(official) == 887
    core: dict[tuple[str, str], list[dict]] = {}
    for row in official:
        if row["District Type"].lower() in ["congressional", "legislative"] or row["District"] == "Supreme Court":
            core.setdefault((row["District"], row["Race"]), []).append(row)
    assert len(core) == 137 and sum(map(len, core.values())) == 255
    by_title = {c["title"]: c for c in ballot["contests"]}
    for (district, race), people in core.items():
        title = f"{district}, {race}" if district == "Supreme Court" else f"{race}, {district.title()}"
        contest = by_title[title]
        held = {compact(c.get("givenName", "") + " " + c["familyName"]): c["partyLabel"]
                for c in ballot["candidacies"] if c["contestId"] == contest["id"]}
        assert held == {r["Name"]: r["Party Preference"] or None for r in people}, title
    source_receipt(data, export_url, "Washington Secretary of State, Elections Division")
    url = "https://info.kingcounty.gov/kcelections/Vote/contests/candidates.aspx?eid=55"
    added = candidates_added = 0
    for title, names in king_candidates():
        countywide = title in ["Prosecuting Attorney", "Assessor", "Director of Elections"]
        council = re.fullmatch(r"Metropolitan King County , Council District No\. (\d+)", title)
        city = re.fullmatch(r"City of Seattle , Municipal Court Judge Position No\. (\d+)", title)
        city_council = re.fullmatch(r"City of Seattle , Council District No\. (\d+)", title)
        if not (countywide or council or city or city_council):
            continue
        if countywide:
            division = "ocd-division/country:us/state:wa/county:king"
            title = "King County " + title
        elif council:
            division = f"ocd-division/country:us/state:wa/county:king/council_district:{council[1]}"
        elif city:
            division = "ocd-division/country:us/state:wa/place:seattle"
        else:
            division = f"ocd-division/country:us/state:wa/place:seattle/council_district:{city_council[1]}"
        n = add_contest(ballot, title.replace(" , ", ", "), division,
            [{"name": name} for name in names], provenance(url, "King County Elections", title))
        added += n
        candidates_added += len(names) if n else 0
    source_receipt(data, url, "King County Elections")
    measure_url = "https://info.kingcounty.gov/kcelections/Vote/contests/ballotmeasures.aspx?lang=en-US&cid=102258&groupname=City"
    question = (SOURCES / "wa-seattle-transit-question.txt").read_text().strip()
    measure_added = add_measure(ballot, "City of Seattle, Proposition No. 1 — Seattle Transit Measure",
        "Proposition No. 1", "ocd-division/country:us/state:wa/place:seattle", question,
        provenance(measure_url, "King County Elections", question))
    source_receipt(data, measure_url, "King County Elections")
    ballot["coverageNotes"] = [s.replace(
        "Court of Appeals district contests and local offices are outside this statewide-office and legislative package.",
        "Verified King County and Seattle local offices are included. We're working on getting the remaining local contests and measures.")
        for s in ballot.get("coverageNotes", [])]
    return {"state": "WA", "officialCoreContestsMatched": 137, "officialCoreCandidatesMatched": 255,
            "officialKingCandidateContests": 97, "officialKingCandidates": 153,
            "newLocalContests": added, "newLocalCandidates": candidates_added, "newLocalMeasures": measure_added}


def oregon(data: dict) -> dict:
    ballot = next(iter(data["ballots"].values()))
    url = "https://sos.oregon.gov/elections/Documents/Directive-2026-09-official-ballot-statments-general-election-2026.pdf"
    publisher = "Oregon Secretary of State, Elections Division"
    source = (SOURCES / "or-certified-directive.txt").read_text()
    core: dict[str, list[list[str]]] = {}
    title = None
    for line in source.splitlines():
        match = re.match(r"^(US Senator|US Representative, \d+\w* District|Governor|State Senator, \d+\w* District|State Representative, \d+\w* District)\s{2,}Vote for one\s*$", line)
        if match:
            title = match[1]
            core[title] = []
            continue
        if line.startswith("Judge of the Circuit Court"):
            title = None
        if title:
            cells = re.split(r"\s{2,}", line.strip())
            if len(cells) == 2 and re.search(r"Republican|Democrat|Libertarian|Progressive|Pacific Green|Independent|Working Families", cells[1]):
                core[title].append(cells)
    assert len(core) == 83 and sum(map(len, core.values())) == 167
    by_title = {c["title"]: c for c in ballot["contests"]}
    for title, rows in core.items():
        contest = by_title[title]
        held = {compact(c["familyName"] + " " + c.get("givenName", "")): c["partyLabel"]
                for c in ballot["candidacies"] if c["contestId"] == contest["id"]}
        assert held == dict(rows), (title, held, rows)
    added = people_added = 0
    # These judicial districts each cover one county, confirmed by their OJD home pages.
    courts = {"4": "multnomah", "11": "deschutes", "2": "lane", "5": "clackamas", "20": "washington"}
    for match in re.finditer(r"^(Judge of the Circuit Court, (\d+)\w* District, Position \d+|District Attorney, ([A-Za-z ]+) County)\s{2,}Vote for one\s*\n(.*?)(?=\n(?:Judge of the Circuit Court|District Attorney,|Page \d+ of)|\Z)", source, re.M | re.S):
        title, district, county, block = match.groups()
        names = []
        for line in block.splitlines():
            line = line.strip()
            if not line or line.startswith(("Secretary of State", "255 Capitol", "Candidate Ballot", "2026 General", "September 3")):
                continue
            name = re.sub(r"\s{2,}Incumbent$", "", line)
            assert name and not re.search(r"Vote for|Page \d+", name), name
            names.append(name)
        assert names
        county = courts[district] if district else county.lower()
        if district:
            court_url = f"https://www.courts.oregon.gov/courts/{county}/Pages/default.aspx"
            metadata = json.loads((SOURCES / "captures.json").read_text())
            capture = next(c for c in metadata if c["url"] == court_url)
            court_page = gzip.decompress((SOURCES / capture["file"]).read_bytes()).decode()
            assert re.search(rf"{district}(?:st|nd|rd|th) Judicial District", court_page, re.I)
            source_receipt(data, court_url, "Oregon Judicial Department")
        n = add_contest(ballot, title, f"ocd-division/country:us/state:or/county:{county}",
                        [{"name": name} for name in names], provenance(url, publisher, title))
        added += n
        people_added += len(names) if n else 0
    source_receipt(data, url, publisher)
    local_url = "https://multco.us/file/ballot_content_-_nov._2026/download"
    content = (SOURCES / "or-multnomah-ballot-content.txt").read_text()
    title = None
    names: list[str] = []
    for line in content.splitlines():
        match = re.match(r"^ {5}(\S.*?) {2,}Vote for (\d+) +([0-9]+) Year Term", line)
        if match:
            title, vote_for, term = match[1], int(match[2]), int(match[3])
            names = []
            continue
        if title:
            continuation = re.match(r"^ {5}(\S.*)$", line)
            if continuation:
                title += " " + continuation[1]
                continue
            candidate = re.match(r"^ {9,}(\S.*?)\s*$", line[:75])
            if candidate and not re.search(r"Number Candidates|Contest Total", line):
                names.append(candidate[1])
            count = re.search(r"Number Candidates Filed:\s*(\d+)", line)
            if count:
                assert len(names) == int(count[1]), (title, names, count[1])
                if title.startswith("City of"):
                    city = re.match(r"City of ([^,]+)", title)[1].lower().replace(" ", "_")
                    n = add_contest(ballot, title, f"ocd-division/country:us/state:or/place:{city}",
                        [{"name": name} for name in names], provenance(local_url, "Multnomah County Elections", title), vote_for, term)
                    added += n
                    people_added += len(names) if n else 0
                title = None
    source_receipt(data, local_url, "Multnomah County Elections")
    measures_added = 0
    for number, city in [("26-267", "portland"), ("26-265", "troutdale"), ("26-266", "troutdale")]:
        block = re.search(rf"Measure No: {number}\s+Caption:\s*(.*?)\s+Question:\s*(.*?)\s+Summary:", content, re.S)
        assert block
        caption, question = compact(block[1]), compact(block[2])
        measures_added += add_measure(ballot, f"City of {city.title()}, Measure {number} — {caption}",
            number, f"ocd-division/country:us/state:or/place:{city}", question,
            provenance(local_url, "Multnomah County Elections", f"Measure No: {number}\n{caption}\n{question}"))
    rcv_url = "https://multco.us/file/ballot_content_rcv_-_nov._2026/download"
    rcv = (SOURCES / "or-multnomah-rcv-content.txt").read_text()
    rcv_titles = [
        ("Multnomah County, Commissioner Chair", "county:multnomah"),
        ("Multnomah County, Auditor", "county:multnomah"),
        ("Multnomah County, Sheriff", "county:multnomah"),
        ("Multnomah County Commissioner, District 2", "county:multnomah/council_district:2"),
        ("City of Portland, Auditor", "place:portland"),
        ("City of Portland, Councilor, District 3", "place:portland/council_district:3"),
        ("City of Portland, Councilor, District 4", "place:portland/council_district:4"),
    ]
    blocks = list(re.finditer(r"(.*?)Number Candidates Filed:\s*(\d+)", rcv, re.S))
    assert len(blocks) == len(rcv_titles)
    for (title, scope), block in zip(rcv_titles, blocks):
        names = [m[1] for m in re.finditer(r"^ {10}(\S.*?)\s*$", block[1], re.M)]
        assert len(names) == int(block[2]), (title, names, block[2])
        n = add_contest(ballot, title, "ocd-division/country:us/state:or/" + scope,
            [{"name": name} for name in names], provenance(rcv_url, "Multnomah County Elections", title), vote_for=None, term_years=4)
        added += n
        people_added += len(names) if n else 0
    source_receipt(data, rcv_url, "Multnomah County Elections")
    return {"state": "OR", "officialCoreContestsMatched": len(core), "officialCoreCandidatesMatched": 167,
            "newLocalContests": added, "newLocalCandidates": people_added, "newLocalMeasures": measures_added}


def alaska(data: dict) -> dict:
    ballot = next(iter(data["ballots"].values()))
    url = "https://ajc.alaska.gov/retention/current2026.html"
    text = gzip.decompress((SOURCES / "ak-judicial-council-web-text.txt.gz").read_bytes()).decode()
    text = re.sub(r"^L\d+: ?", "", text, flags=re.M)
    judges = re.findall(r"^# 【\d+†([^】]+)】\s*\n(.*?)\n((?:First|Second|Third|Fourth|Thid) Judicial District|Statewide)", text, re.M)
    assert len(judges) == 21
    districts = {"First": "1", "Second": "2", "Third": "3", "Thid": "3", "Fourth": "4"}
    added = 0
    for name, court, electorate in judges:
        if electorate == "Statewide":
            # The held Supreme Court contest already contains Jude Pate.
            supreme = next(c for c in ballot["contests"] if c["title"] == "SUPREME COURT")
            assert any("pate" in c["familyName"].lower() and "jude" in (c["familyName"] + " " + c["givenName"]).lower()
                       for c in ballot["candidacies"] if c["contestId"] == supreme["id"])
            continue
        district = districts[electorate.split()[0]]
        title = f"{court} — Retention of {name}"
        added += add_contest(ballot, title, f"ocd-division/country:us/state:ak/judicial_district:{district}",
            [{"name": name}], provenance(url, "Alaska Judicial Council", f"{name}\n{court}\n{electorate}"))
    source_receipt(data, url, "Alaska Judicial Council")
    return {"state": "AK", "officialJudgesOnBallot": len(judges), "heldStatewideSupremeContestMatched": 1,
            "newJudicialRetentionContests": added, "newCandidates": added,
            "coreCoverage": "The election-office certified roster remains unavailable from this environment; core completeness is unmeasured."}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    for state, run in [("hi", hawaii), ("wa", washington), ("or", oregon), ("ak", alaska)]:
        path = ROOT / f"data/ballot/2026-general/{state}.json"
        data = json.loads(path.read_text())
        result = run(data)
        if args.apply:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(result))


if __name__ == "__main__":
    main()
