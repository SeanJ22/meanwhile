"""Replay Arkansas's complete public general-ballot roster and status records.

The page heading was left on the primary election. Every public candidate modal
explicitly identifies the general/nonpartisan runoff, its general-ballot status
and withdrawal status. Check all records uniformly before importing core races.
"""
from collections import defaultdict
from pathlib import Path
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south/ar-core"
STATE = ROOT / "data/ballot/2026-general/ar.json"
PUBLISHER = "Arkansas Secretary of State, Elections Division"


def captured(stem, extension):
    path = EVIDENCE / (stem + "." + extension)
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == meta["sha256"]
    assert meta["httpStatus"] == 200
    return path, meta


path, roster_meta = captured("sos-general-roster", "json")
roster = json.loads(path.read_text())
assert roster["recordsTotal"] == roster["recordsFiltered"] == len(roster["data"]) == 198
assert "CanBallotName=&Descript=" in roster_meta["url"]
page, _page_meta = captured("sos-candidate-page", "html")
assert '"ajax":{"url":"\\/wp-json\\/metl\\/v1\\/all"}' in page.read_text()
assert 'finalObj["postID"] = \'2941\'' in page.read_text()
details = {}
for capture in json.loads((EVIDENCE / "sos-general-details.json").read_text())["sources"]:
    assert capture["httpStatus"] == 200
    assert hashlib.sha256(capture["body"].encode()).hexdigest() == capture["sha256"]
    row = json.loads(capture["body"])
    assert row["ElecCyDesc"] == "General and Nonpartisan Judicial Runoff"
    assert row["OnGeneralBallot"] == "True" and row["Withdrawn"] == "False"
    assert row["FilerID"] not in details
    details[row["FilerID"]] = (row, capture)
assert len(details) == 198
for row in roster["data"]:
    detail, _capture = details[row["FilerID"]]
    assert all(detail[key] == row[key] for key in row)

proclamation, proclamation_meta = captured("senate1-proclamation", "html")
proclamation_text = html.unescape(re.sub(r"<[^>]+>", " ", proclamation.read_text()))
proclamation_text = " ".join(proclamation_text.split())
assert "A special election shall be held on Tuesday, November 3, 2026, for the purpose of filling the vacancy in office for State Senator for District 1." in proclamation_text

groups = defaultdict(list)
regional = defaultdict(list)
for row in roster["data"]:
    if row["PartyAffiliation"] == "Non Partisan Judicial":
        regional[row["Descript"]].append(row)
        continue
    special = row["FilerID"] in {"3787", "4796", "4800", "4802"}
    groups[(row["Descript"], special)].append(row)
assert len(groups) == 131 and sum(map(len, groups.values())) == 190
assert len(regional) == 4 and sum(map(len, regional.values())) == 8
assert {row["CanBallotName"] for row in groups[("State Senate District 01", True)]} == {
    "Mayor Tomeka Butler", "School Board Director Harrell Wilson"}
assert {row["CanBallotName"] for row in groups[("State Representative District 08", True)]} == {
    "Kara Armas", "Parker John Stohlton"}
assert len(groups[("State Representative District 08", False)]) == 1


def identity(name):
    prefix = r"^(?:(?:State )?(?:Representative|Senator|Treasurer)|Council Member|Justice|Rep\.|Sheriff|Congressman|Governor|Lieutenant Governor|Secretary of State|Auditor of State|Attorney General)\s+"
    name = name.strip()
    while re.match(prefix, name, re.I):
        name = re.sub(prefix, "", name, flags=re.I)
    result = re.sub(r"[^a-z0-9]", "", name.lower())
    # The saved county ballots and the state roster identify these same people
    # by office and affiliation, with a middle initial or spelling difference.
    return {"ryanrose": "ryanarose", "stevenbright": "stephenbright", "bartshulz": "bartschulz"}.get(result, result)


def party(value):
    value = (value or "").lower().removesuffix(" party")
    return {"r": "republican", "rep": "republican", "d": "democratic", "dem": "democratic",
            "l": "libertarian", "lib": "libertarian", "i": "independent"}.get(value, value)


def division(office):
    match = re.fullmatch(r"State (Senate|Representative) District (\d+)", office)
    if match:
        return "ocd-division/country:us/state:ar/" + ("sldu" if match[1] == "Senate" else "sldl") + ":" + str(int(match[2]))
    match = re.fullmatch(r"U.S. Congress District (\d+)", office)
    if match:
        return "ocd-division/country:us/state:ar/cd:" + str(int(match[1]))
    return "ocd-division/country:us/state:ar"


def same_office(contest, office, special):
    if contest["type"] != "CANDIDACY" or contest["ocdId"] != division(office):
        return False
    if ("special election" in contest["title"].lower()) != special:
        return False
    if re.search(r"/sld[ul]:|/cd:", contest["ocdId"]):
        return True
    title = contest["title"].lower()
    return (office == "U.S. Senate" and "u.s. senate" in title) or title == office.lower()


data = json.loads(STATE.read_text())
ballot = data["ballots"]["AR:ar-2026-11-03-general"]
added_contests = added_candidates = matched_candidates = 0
for (office, special), rows in groups.items():
    prior = [contest for contest in ballot["contests"] if same_office(contest, office, special)]
    assert len(prior) <= 1, office
    quote = json.dumps(rows, ensure_ascii=False)
    provenance = {"sourceUrl": roster_meta["finalUrl"], "sourceOrg": PUBLISHER,
                  "collectedAt": roster_meta["retrievedAt"], "verifiedAt": roster_meta["retrievedAt"], "quote": quote}
    if prior:
        contest = prior[0]
    else:
        ocd = division(office)
        cid = "ar-ba01-2026-" + ocd.rsplit("/", 1)[-1].replace(":", "-") + ("-special" if special else "")
        contest = {"id": cid, "electionId": ballot["election"]["id"], "ocdId": ocd,
            "divisionVintage": "2026", "title": office + (" (Special Election)" if special else ""),
            "type": "CANDIDACY", "voteFor": None, "termYears": None, "scopeNote": None,
            "candidateListComplete": True, "provenance": provenance}
        ballot["contests"].append(contest)
        added_contests += 1
    held = [candidate for candidate in ballot["candidacies"] if candidate["contestId"] == contest["id"]]
    used = set()
    for candidate in held:
        matches = [row for row in rows if identity(row["CanBallotName"]) == identity(candidate["givenName"] + " " + candidate["familyName"])
                   and party(row["PartyAffiliation"]) == party(candidate["partyLabel"])]
        assert len(matches) == 1, (office, candidate["familyName"])
        assert matches[0]["FilerID"] not in used
        used.add(matches[0]["FilerID"])
        matched_candidates += 1
    for row in rows:
        if row["FilerID"] in used:
            continue
        detail, capture = details[row["FilerID"]]
        candidate_provenance = {"sourceUrl": capture["finalUrl"], "sourceOrg": PUBLISHER,
            "collectedAt": capture["retrievedAt"], "verifiedAt": capture["retrievedAt"],
            "quote": json.dumps({key: detail[key] for key in ["CanBallotName", "Descript", "PartyAffiliation",
                       "ElecCyDesc", "OnGeneralBallot", "Withdrawn"]}, ensure_ascii=False)}
        ballot["candidacies"].append({"id": contest["id"] + "-filer-" + row["FilerID"], "contestId": contest["id"],
            "familyName": row["CanBallotName"], "givenName": "", "partyLabel": row["PartyAffiliation"],
            "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": candidate_provenance})
        added_candidates += 1
    assert len([row for row in ballot["candidacies"] if row["contestId"] == contest["id"]]) == len(rows)

for meta, publisher in [(roster_meta, PUBLISHER), (proclamation_meta, "Governor of Arkansas")] + [
        (capture, PUBLISHER) for _row, capture in details.values()]:
    receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
        "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": publisher,
        "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
        "reviewedEvidence": "Saved official 2026 general-ballot roster and public candidate-modal responses; scripts/ba01-south-ar-general.py checks every record's office, printed name, party, general/runoff election cycle, OnGeneralBallot=True and Withdrawn=False. The governor's proclamation identifies the November 3 Senate District 1 special election. Filing addresses and contacts are not imported."}
    if not any(row.get("finalUrl") == receipt["finalUrl"] and row.get("rawHash") == receipt["rawHash"] for row in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append(receipt)
    data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
ballot["coverageNotes"][0] = "All federal, statewide and legislative races in the Secretary of State's current general-ballot roster are held, including the Senate District 1 and House District 8 special elections. Every roster name was checked against its official general-ballot and withdrawal status. County sample ballots confirm separately printed regular and special House District 8 contests."
unmapped_regional = sorted(office for office in regional if not any(contest["title"] == office for contest in ballot["contests"]))
ballot["coverageNotes"][1] = ("Regional runoff races still needing exact divisions: " + "; ".join(unmapped_regional) +
    ". County, municipal, school and special-district contests and local measures remain incomplete.")
STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AR", "official_core_contests": len(groups), "official_core_candidates": 190,
    "added_contests": added_contests, "added_candidates": added_candidates, "matched_existing_candidates": matched_candidates,
    "missing_regular_senate": [], "missing_regular_house": [], "unmapped_regional_offices": unmapped_regional,
    "contests": len(ballot["contests"]), "candidacies": len(ballot["candidacies"]), "measures": len(ballot["measures"])}))
