"""Replay official Wisconsin county ballot lists; preserve held records.

The WEC-authored third-party mirror is a discovery lead only. No row below is
published from that mirror. Each county capture is bound to its own office block.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/ba01-pacific-wi-evidence"
PATH = ROOT / "data/ballot/2026-general/wi.json"


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean_web(source: str) -> str:
    return re.sub(r"^L\d+(?:@P[\d-]+)?: ?", "", source, flags=re.M)


def candidates(block: str, vote_label: str) -> list[tuple[str, str]]:
    after = block.index(vote_label) + len(vote_label)
    result = []
    for line in block[after:].strip().splitlines():
        line = re.sub(r"((?:Republican|Democratic|Independent|Wisconsin Green Party))\s+\d+$", r"\1", line.strip())
        if "–" in line:
            name, party = line.rsplit("–", 1)
        elif " - " in line:
            name, party = line.rsplit(" - ", 1)
        else:
            if result:
                break
            continue
        name, party = name.strip(), party.strip()
        assert name and party
        result.append((name, party))
    assert result
    return result


def county_contests(capture: dict) -> list[tuple[str, str, list[tuple[str, str]]]]:
    text = clean_web((EVIDENCE / capture["textFile"]).read_text())
    assert "November 3, 2026" in text or "NOVEMBER 3, 2026" in text
    if capture.get("style") == "parentheses":
        return parenthesized_contests(capture, text)
    if capture.get("style") == "ballot-lines":
        return ballot_contests(capture, text)
    if capture["county"] == "winnebago":
        pattern = re.compile(r"REPRESENTATIVE IN CONGRESS\s+DISTRICT (?P<cd>\d+)|STATE SENATE, DISTRICT (?P<sd>\d+)|REPRESENTATIVE TO THE ASSEMBLY,\s+DISTRICT (?P<ad>\d+)|(?P<sheriff>COUNTY SHERIFF[^\n]*)|(?P<clerk>CLERK OF CIRCUIT COURT[^\n]*)")
        vote_label = "(Vote for 1)"
    else:
        pattern = re.compile(r"Representative in Congress, District (?P<cd>\d+)|Representative to the Assembly, District (?P<ad>\d+)|(?P<sheriff>Sauk County Sheri[^\n]*)|(?P<coroner>Sauk County Coroner)|(?P<clerk>Sauk County Clerk of Circuit Court)")
        vote_label = "(Vote for One)"
    starts = list(pattern.finditer(text))
    result = []
    for i, start in enumerate(starts):
        fields = start.groupdict()
        if fields.get("cd"):
            title, division = f"Representative in Congress District {fields['cd']}", f"cd:{fields['cd']}"
        elif fields.get("sd"):
            title, division = f"State Senator District {fields['sd']}", f"sldu:{fields['sd']}"
        elif fields.get("ad"):
            title, division = f"Representative to the Assembly District {fields['ad']}", f"sldl:{fields['ad']}"
        else:
            office = "Sheriff" if fields.get("sheriff") else "Coroner" if fields.get("coroner") else "Clerk of Circuit Court"
            title, division = f"{capture['county'].title()} County {office}", f"county:{capture['county']}"
        block = text[start.start():starts[i + 1].start() if i + 1 < len(starts) else len(text)]
        result.append((title, "ocd-division/country:us/state:wi/" + division, candidates(block, vote_label)))
    expected = (11, 26) if capture["county"] == "winnebago" else (7, 14)
    assert (len(result), sum(len(c[2]) for c in result)) == expected
    return result


def parenthesized_contests(capture: dict, text: str) -> list[tuple[str, str, list[tuple[str, str]]]]:
    pattern = re.compile(r"REPRESENTATIVE IN CONGRESS(?:,)?(?: DISTRICT (?P<cd>\d+)|, (?P<ordinal_cd>\d+)(?:ST|ND|RD|TH) DISTRICT)|STATE SENATOR(?:,)?(?: DISTRICT (?P<sd>\d+)| (?P<ordinal_sd>\d+)(?:ST|ND|RD|TH) DISTRICT)|REPRESENTATIVE TO THE ASSEMBLY(?: -|,)? DISTRICT (?P<ad>\d+)|^(?P<sheriff>SHERIFF)\s*$|^(?P<clerk>CLERK OF CIRCUIT COURT)\s*$", re.M)
    starts = list(pattern.finditer(text))
    result = []
    for i, start in enumerate(starts):
        fields = start.groupdict()
        cd, sd, ad = fields["cd"] or fields["ordinal_cd"], fields["sd"] or fields["ordinal_sd"], fields["ad"]
        if cd:
            title, division = f"Representative in Congress District {cd}", f"cd:{cd}"
        elif sd:
            title, division = f"State Senator District {sd}", f"sldu:{sd}"
        elif ad:
            title, division = f"Representative to the Assembly District {ad}", f"sldl:{ad}"
        else:
            office = "Sheriff" if fields["sheriff"] else "Clerk of Circuit Court"
            page = str(text[:start.start()].count("\f") + 1)
            county = capture.get("countyPageOverrides", {}).get(page, capture["county"])
            title, division = f"{county.title()} County {office}", f"county:{county}"
        block = text[start.end():starts[i + 1].start() if i + 1 < len(starts) else len(text)]
        people = re.findall(r"^\s*([^\n]+?)\s+\((Republican|Democratic|Wisconsin Green|Independent|REP|DEM|IND|WI GREEN)\)\s*$", block, re.M)
        aliases = {"REP": "Republican", "DEM": "Democratic", "IND": "Independent", "WI GREEN": "Wisconsin Green"}
        people = [(n.strip(), aliases.get(p, p)) for n, p in people]
        assert people, title
        result.append((title, "ocd-division/country:us/state:wi/" + division, people))
    assert (len(result), sum(len(c[2]) for c in result)) == tuple(capture["expected"])
    return result


def ballot_contests(capture: dict, text: str) -> list[tuple[str, str, list[tuple[str, str]]]]:
    pattern = re.compile(r"Representative in Congress,?\s+District (?P<cd>\d+)\s+Vote for 1|State Senator,?\s+District (?P<sd>\d+)\s+Vote for 1|Representative to the Assembly,?\s+District (?P<ad>\d+)\s+Vote for 1|^(?P<sheriff>Sheriff)\s+Vote for 1|^(?P<clerk>Clerk of Circuit Court)\s+Vote for 1", re.M)
    result = {}
    for start in pattern.finditer(text):
        fields = start.groupdict()
        if fields["cd"]:
            title, division = f"Representative in Congress District {fields['cd']}", f"cd:{fields['cd']}"
        elif fields["sd"]:
            title, division = f"State Senator District {fields['sd']}", f"sldu:{fields['sd']}"
        elif fields["ad"]:
            title, division = f"Representative to the Assembly District {fields['ad']}", f"sldl:{fields['ad']}"
        else:
            office = "Sheriff" if fields["sheriff"] else "Clerk of Circuit Court"
            page = str(text[:start.start()].count("\f") + 1)
            county = capture.get("countyPageOverrides", {}).get(page, capture["county"])
            title, division = f"{county.title()} County {office}", f"county:{county}"
        block = text[start.end():].split("write-in", 1)[0]
        people = re.findall(r"^([^\n]+)\n\(?(Republican|Democratic|Wisconsin Green|Independent)\)?\s*$", block, re.M)
        people = [(n.strip(), p) for n, p in people]
        assert people, title
        row = (title, "ocd-division/country:us/state:wi/" + division, people)
        assert title not in result or result[title] == row, title
        result[title] = row
    assert (len(result), sum(len(c[2]) for c in result.values())) == tuple(capture["expected"])
    return list(result.values())


def run(apply: bool) -> dict:
    data = json.loads(PATH.read_text())
    prior = copy.deepcopy(data)
    ballot = next(iter(data["ballots"].values()))
    captures = json.loads((EVIDENCE / "captures.json").read_text())
    added_contests = added_candidates = 0
    for capture in captures:
        if not capture.get("county"):
            continue
        raw = gzip.decompress((EVIDENCE / capture["file"]).read_bytes())
        assert hashlib.sha256(raw).hexdigest() == capture["rawHash"]
        source = {"requestedUrl": capture["url"], "finalUrl": capture["finalUrl"],
                  "publisher": capture["publisher"], "sourceClass": "ELECTION_AUTHORITY",
                  "retrievedAt": capture["retrievedAt"], "httpStatus": 200,
                  "rawHash": capture["rawHash"], "reviewedEvidence": capture["method"]}
        if not any(s["rawHash"] == source["rawHash"] and s["retrievedAt"] == source["retrievedAt"] for s in data["sourceReceipt"]["sources"]):
            data["sourceReceipt"]["sources"].append(source)
        for title, division, people in county_contests(capture):
            provenance = {"sourceUrl": capture["url"], "sourceOrg": capture["publisher"],
                          "collectedAt": capture["retrievedAt"], "verifiedAt": capture["retrievedAt"], "quote": title}
            contest = next((c for c in ballot["contests"] if c["title"] == title and c["ocdId"] == division), None)
            if contest is None:
                contest = {"id": "ba01-pacific-wi-" + slug(title), "electionId": ballot["election"]["id"],
                           "ocdId": division, "divisionVintage": "2026", "title": title,
                           "type": "CANDIDACY", "voteFor": 1, "termYears": None,
                           "candidateListComplete": True, "scopeNote": None, "provenance": provenance}
                ballot["contests"].append(contest)
                added_contests += 1
            for name, party in people:
                held = [c for c in ballot["candidacies"] if c["contestId"] == contest["id"]]
                if any(name.lower() == (c.get("givenName", "") + " " + c["familyName"]).strip().lower() or name.lower() == c["familyName"].lower() for c in held):
                    continue
                ballot["candidacies"].append({"id": contest["id"] + ":" + hashlib.sha256(name.encode()).hexdigest()[:16],
                    "contestId": contest["id"], "familyName": name, "givenName": "", "partyLabel": party,
                    "slogan": None, "incumbent": None, "websiteUrl": None,
                    "provenance": {**provenance, "quote": f"{title}\n{name} — {party}"}})
                added_candidates += 1
    # The official county ballot prints these two explicit joint tickets. Keep
    # the original LG records and IDs intact; the reader adapter groups them.
    ticket_source = next(c for c in captures if c["county"] == "kenosha")
    ticket_text = (EVIDENCE / ticket_source["textFile"]).read_text()
    for lead_name, mate_name in [("Tom Tiffany", "David Varnam"), ("David Crowley", "Sarah Godlewski")]:
        quote = next(line.strip() for line in ticket_text.splitlines() if line.strip().startswith(lead_name + "/" + mate_name))
        def person(name: str, title: str) -> dict:
            contest = next(c for c in ballot["contests"] if c["title"] == title)
            return next(c for c in ballot["candidacies"] if c["contestId"] == contest["id"] and (c.get("givenName", "") + " " + c["familyName"]).strip() == name)
        lead, mate = person(lead_name, "Governor"), person(mate_name, "Lieutenant Governor")
        ticket_id = "ba01-pacific-wi-ticket-" + slug(lead_name)
        if not any(t["id"] == ticket_id for t in ballot.setdefault("candidateTickets", [])):
            ballot["candidateTickets"].append({"id": ticket_id, "leadCandidacyId": lead["id"], "runningMate": copy.deepcopy(mate),
                "provenance": {"sourceUrl": ticket_source["url"], "sourceOrg": ticket_source["publisher"],
                    "collectedAt": ticket_source["retrievedAt"], "verifiedAt": ticket_source["retrievedAt"],
                    "quote": "Governor/Lieutenant Governor\n" + quote}})
    for key, old in prior["ballots"].items():
        for field in ["contests", "candidacies", "measures", "absences"]:
            assert all(row in data["ballots"][key].get(field, []) for row in old.get(field, []))
    if apply:
        data["sourceReceipt"]["reviewedAt"] = max(s["retrievedAt"] for s in data["sourceReceipt"]["sources"])
        data["sourceReceipt"]["reviewedBy"] = "ba01-pacific-wi-source-replay"
        PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return {"state": "WI", "addedContests": added_contests, "addedCandidates": added_candidates,
            "totalContests": len(ballot["contests"]), "totalCandidacies": len(ballot["candidacies"]),
            "sources": [{"county": c["county"], "url": c["url"]} for c in captures if c.get("county")]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    print(json.dumps(run(parser.parse_args().apply)))
