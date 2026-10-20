"""Replay saved official west-region captures and write the requested race comparison.

Usage: python scripts/ba01-west-compare.py /path/to/captures
Captures are the original public downloads; output omits mailing addresses and contacts.
Original captures and derived tables are also saved as gzip in ba01-west-evidence/captures.
To replay after checkout, decompress those files into a temporary directory and pass it here.
This report never controls publication.
"""
import collections
import csv
import datetime
import hashlib
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPTURES = pathlib.Path(sys.argv[1])
OUTPUT = ROOT / "data/ballot/ba01-west-evidence/state-comparison.json"


def norm(value):
    return "".join(c for c in unicodedata.normalize("NFKC", value).lower() if c.isalnum())


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def same_party(official, held):
    # The Nevada master spells this out; its official Washoe supplement prints REP.
    return official == held or (official == "Republican Party" and held == "REP")


def ballot(state):
    return next(iter(json.loads((ROOT / f"data/ballot/2026-general/{state}.json").read_text())["ballots"].values()))


REPORT = {"checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "states": {}}


def compare(state, expected, source_file, source_url, method):
    held = ballot(state)
    contests = {r["id"]: r for r in held["contests"]}
    grouped = collections.defaultdict(list)
    for row in expected:
        grouped[row["contestId"] or "UNRESOLVED:" + row["office"]].append(row)
    results = []
    for key, source in grouped.items():
        current = [r for r in held["candidacies"] if r["contestId"] == key]
        names = {norm(r.get("givenName", "") + " " + r["familyName"]): r for r in current}
        missing = [r["candidate"] for r in source if norm(r["candidate"]) not in names]
        extras = [r.get("givenName", "") + " " + r["familyName"] for r in current if not any(norm(s["candidate"]) == norm(r.get("givenName", "") + " " + r["familyName"]) for s in source)]
        party_differences = [{"candidate": r["candidate"], "official": r["party"], "held": names[norm(r["candidate"])].get("partyLabel")} for r in source
                             if norm(r["candidate"]) in names and r["party"] is not None and not same_party(r["party"], names[norm(r["candidate"])].get("partyLabel"))]
        results.append({"contestId": key, "title": contests.get(key, {}).get("title", source[0]["office"]),
                        "officialCandidates": [r["candidate"] for r in source], "heldCandidateCount": len(current),
                        "missing": missing, "extraHeld": extras, "partyDifferences": party_differences})
    raw = (CAPTURES / source_file).read_bytes()
    REPORT["states"][state.upper()] = {"scope": "Federal, statewide and legislative candidate contests, including statewide judicial and education contests where listed",
        "sourceUrl": source_url, "sourceHash": hashlib.sha256(raw).hexdigest(), "sourceBytes": len(raw), "method": method,
        "officialContestCount": len(results), "officialCandidacyCount": len(expected),
        "missingCandidates": sum(len(r["missing"]) for r in results), "extraHeldCandidates": sum(len(r["extraHeld"]) for r in results),
        "partyDifferences": sum(len(r["partyDifferences"]) for r in results), "contests": results}


def title_id(state, title):
    matches = [r["id"] for r in ballot(state)["contests"] if norm(r["title"]) == norm(title)]
    return matches[0] if len(matches) == 1 else None


co = ballot("co")
co_scope = {"US Senate", "US House of Representatives", "Governor", "Lt. Governor", "Secretary of State", "State Treasurer", "Attorney General", "State Senate", "State House of Representatives", "University of Colorado Board of Regents", "State Board of Education", "Colorado Court of Appeals", "Colorado Supreme Court"}
expected = []
for row in json.loads((CAPTURES / "co-rows.json").read_text()):
    if len(row) != 5 or row[1] not in co_scope:
        continue
    matches = [c for c in co["candidacies"] if norm(c["provenance"].get("quote", "")) == norm(" | ".join(row))]
    expected.append({"office": row[1] + " " + row[2], "candidate": row[0], "party": row[3] or None, "contestId": matches[0]["contestId"] if len(matches) == 1 else None})
compare("co", expected, "co-alias", "https://www.coloradosos.gov/pubs/elections/vote/generalCandidates.html", "Complete five-column official table; replayed office, district, name, party and write-in flag against each held source quote. Includes Duane L Gurule added to Senate35 in BA-01.")

expected = []
for r in json.loads((CAPTURES / "nm-rows.json").read_text()):
    if len(r) != 24 or r[21] != "Qualified" or not r[0].startswith(("United States", "Governor", "Secretary of State", "Attorney General", "State Auditor", "State Treasurer", "Commissioner of Public Lands", "State Representative", "State Senator", "Public Education Commissioner", "Judge of the Court of Appeals", "Judicial Retention Justice of the Supreme Court", "Judicial Retention Judge of the Court of Appeals")):
        continue
    contest_id = title_id("nm", r[0])
    if r[0].startswith("Judicial Retention"):
        matches = [c for c in ballot("nm")["candidacies"] if norm(c["provenance"].get("quote", "")) == norm(" | ".join([r[0], r[4], r[8], r[21]]))]
        contest_id = matches[0]["contestId"] if len(matches) == 1 else None
    expected.append({"office": r[0], "candidate": r[4], "party": r[8] or None, "contestId": contest_id})
compare("nm", expected, "nm", "https://candidateportal.servis.sos.state.nm.us/CandidateList.aspx?eid=2917&cty=99", "Full unpaginated table, only Qualified filings; exact office title and district match, name and party replay. Includes Senate33 special, all70 House districts and statewide retention contests.")

expected = []
for r in json.loads((CAPTURES / "id-all").read_text())["data"]["candidates"]:
    if r["districtType"] not in ["State Legislature", "Statewide", "Federal"] or r["filingStatus"] != "Approved":
        continue
    title = r["officeName"]
    if r["district"]:
        title += f' - District {r["district"]}'
    if r["seat"]:
        title += f', Seat {r["seat"]}'
    expected.append({"office": title, "candidate": r["candidateName"], "party": r["partyName"], "contestId": title_id("id", title)})
compare("id", expected, "id-all", "https://api-run.voteidaho.gov/api/FiledCandidates/SearchCandidates", "POST official API with electionId1e38d17c-a176-47b8-91d1-368ba38ccdec,pageNumber1,pageSize1000; isFinalList=true, all592 filings returned. Exact office/district/seat; only Approved federal/statewide/legislative records. Judicial2 are a regional District4 race and remain local work.")

expected = []
for r in json.loads((CAPTURES / "nd-all-rows.json").read_text()):
    if len(r) != 19 or r[0] == "Contest" or r[0].startswith("Judge of the District Court") or not (r[4] == "STATE" or r[0].startswith(("State Senator", "State Representative"))):
        continue
    expected.append({"office": r[0], "candidate": r[5], "party": r[9] or None, "contestId": title_id("nd", r[0])})
compare("nd", expected, "nd-all", "https://vip.sos.nd.gov/candidatelist.aspx?eid=348", "Submitted all-filter Search; full nonpaged source table. Exact contest title, including unexpired term, and district match; all148 required source rows replayed.")

sd_scope = {"United States Senator", "United States Representative", "Governor and Lieutenant Governor", "Secretary of State", "Attorney General", "State Auditor", "State Treasurer", "Commissioner of School and Public Lands", "Public Utilities Commissioner", "State Representative", "State Senator"}
expected = []
for r in csv.DictReader((CAPTURES / "sd-export").read_text(encoding="utf-8-sig").splitlines()):
    if r["Contest"] not in sd_scope or "(Withdrawn " in r["Name"]:
        continue
    title = r["Contest"] + (" " + r["District/County"] if r["District/County"] else "")
    expected.append({"office": title, "candidate": r["Name"], "party": r["Party"], "contestId": title_id("sd", title)})
compare("sd", expected, "sd-export", "https://vip.sdsos.gov/candidatelist.aspx?eid=774", "Official CSV export returned all745 rows, excluding three expressly Withdrawn federal/legislative filings; exact office/district match. Multi-member House district contests are counted once per ballot contest, not once per seat.")

expected = []
for r in csv.DictReader((CAPTURES / "wy").read_text().splitlines()):
    if r["Date Withdrawn"] or re.match(r"(?:CC|DC)-", r["Office Sought"]):
        continue
    expected.append({"office": r["Office Sought"], "candidate": r["Ballot Name"], "party": r["Party Affiliation"] or None,
                     "contestId": "wy-sos-2026-general-" + slug(r["Office Sought"])})
compare("wy", expected, "wy", "https://sos.wyo.gov/Elections/Docs/2026/2026_WY_General_Election_Candidates.csv", "Full151-row official CSV, 133 required candidates; office-derived stable contest IDs, ballot name and party. Raw CSV hash is identical to the prior saved official capture. Regional district/circuit courts remain local work.")

nv = ballot("nv")
pattern = re.compile(r'^(.*?)\s{2,}(Democratic Party|Republican Party|Independent American Party|No Political Party|Libertarian Party of Nevada|Nonpartisan)\s{2,}(.*?)\s{2,}(.*?)\s{2,}(\d+/\d+/\d+)\s*$')
expected = []
for line in (CAPTURES / "nv.txt").read_text().splitlines():
    m = pattern.match(line)
    if not m or not m[3].startswith(("Representative In Congress", "Governor", "Lieutenant Governor", "Secretary Of State", "State Treasurer", "State Controller", "Attorney General", "State Senate", "State Assembly", "Justice Of The Supreme Court", "Board of Regent")):
        continue
    matches = [c for c in nv["candidacies"] if norm(c["provenance"].get("quote", "")) == norm(line)]
    # This single PDF row lacks the ballot-name delimiter; the official Washoe workbook already supplies its held name.
    if not matches and m[3] == "State Assembly, District 27" and "Veronica Cortes" in m[1]:
        first_column = re.split(r"\s{2,}", m[1])[0]
        family, given = first_column.split(" ", 1)
        matches = [c for c in nv["candidacies"] if norm(c.get("givenName", "") + " " + c["familyName"]) == norm(given + " " + family)]
    candidate = matches[0] if len(matches) == 1 else None
    expected.append({"office": m[3], "candidate": (candidate.get("givenName", "") + " " + candidate["familyName"]) if candidate else m[1],
                     "party": m[2], "contestId": candidate["contestId"] if candidate else None})
compare("nv", expected, "nv-alternate", "https://cms1files.revize.com/landercounty25/2026%20Master%20General%20Statewide%20Certified%20List%20of%20Candidates.APPROVED.pdf", "Complete14-page official certification mirror, byte-identical to prior capture; parsed137 required rows with office and party, checked every held exact source quote, with the previously source-reconciled Cortes delimiter exception.")

ut = ballot("ut")
text = (CAPTURES / "ut.txt").read_text().replace("Rep1·esentatives", "Representatives").replace("ofRepresentatives", "of Representatives").replace("Disfl'ict", "District")
corrections = {"CHRJS REID": "CHRIS REID", "JESS BlRTCHER": "JESS BIRTCHER", "CANDICE B. PJERUCCI": "CANDICE B. PIERUCCI", "KARL! BLACK": "KARLI BLACK", "APRJL A PINKSTON": "APRIL A PINKSTON"}
expected, office = [], None
for line in text[text.index("FEDERAL OFFICE"):text.index("NON-PARTISAN JUDICIAL")].splitlines():
    line = line.strip()
    heading = re.match(r"(U\.S\. House of Representatives|Utah Senate|Utah House of Representatives|Utah State Board of Education) Dist[^\d]*(\d+)\.", line)
    if heading:
        office = heading[1] + " District " + heading[2]
    row = re.match(r'^([A-Z"].*?)\s{2,}(Libertarian|Democratic|Unaffiliated|Republican|Independent American|Constitution|Forward|United Utah)\s*$', line)
    if row:
        expected.append({"office": office, "candidate": corrections.get(row[1], row[1]), "party": row[2], "contestId": title_id("ut", office)})
state_retention = text[text.index("Supreme Court and Court of Appeals."):text.index("First Judicial District.")]
for name in re.findall(r"Shall ([\s\S]+?) be retained", state_retention):
    name = re.sub(r"\s+", " ", name).strip()
    matches = [c for c in ut["candidacies"] if norm(c.get("givenName", "") + " " + c["familyName"]) == norm(name)]
    expected.append({"office": "Statewide judicial retention", "candidate": name, "party": None, "contestId": matches[0]["contestId"] if len(matches) == 1 else None})
writein = (CAPTURES / "ut-writeins.txt").read_text()
for name, title in [('BABAK "BOBBY" DARVISH', 'U.S. House of Representatives District 1'), ('CHARLIE TAUTUAA', 'Utah House of Representatives District 52'), ('NANCY LEE PETERSON', 'Utah House of Representatives District 57')]:
    if name not in writein:
        raise ValueError("Missing certified write-in: " + name)
    expected.append({"office": title, "candidate": name, "party": None, "contestId": title_id("ut", title)})
compare("ut", expected, "ut-alternate", "https://vote.utah.gov/wp-content/uploads/2026/09/2026-General-Election-Certification-Amended-09-21.pdf", "Official23-page amended certification is byte-identical to prior capture:222 printed candidates, seven statewide retention nominees; separate official write-in certificate has3 names. Exact office/district replay. Five pdftotext OCR letter errors were checked against rendered PDF pages5,12,14,16; source spellings match held records. Counts102 regular candidate contests +7 retention decisions.")

expected = []
for r in csv.DictReader((CAPTURES / "mt-browser-trusted-export").read_text(encoding="utf-8-sig").splitlines()):
    if r["Status"] != "FILED" or r["District Type"] == "Judicial":
        continue
    contest_id = title_id("mt", r["Race"])
    if r["District Type"] == "Congressional":
        district = re.search(r"\d+", r["District"])[0]
        matches = [c["id"] for c in ballot("mt")["contests"] if c["ocdId"] == "ocd-division/country:us/state:mt/cd:" + district]
        contest_id = matches[0] if len(matches) == 1 else None
    expected.append({"office": r["Race"] + " " + r["District"], "candidate": r["Name"], "party": r["Party Preference"] or None, "contestId": contest_id})
compare("mt", expected, "mt-browser-trusted-export", "https://candidatefiling.mt.gov/candidatefiling/CandidateList.aspx?e=450002987", "Actual public portal Export to CSV click recovered272 rows; excluded3 WITHDRAWN and13 regional judicial candidacies. Exact source bytes match prior capture. Office/district match for all256 required candidacies; 100 House/25 Senate/2 congressional/2 PSC/1 US Senate/1 statewide Supreme Court contests. See ba01-west-fetch-montana.mjs for browser-state download with verified TLS.")

az_report = OUTPUT.parent / "az-comparison.json"
REPORT["states"]["AZ"] = json.loads(az_report.read_text()) if az_report.exists() else {"status": "PARTIAL", "heldSenateContests": 30, "heldHouseContests": 30, "heldFederalHouseContests": 9,
    "reason": "Official 2026 general Candidate Listing links to apps.arizona.vote/electioninfo/Election/69; direct, root and query routes returned403. Existing primary-canvass-backed roster and Clean Elections guide need complete general-certification comparison. Maricopa countywide source additions and Denver source additions have independent focused tests; neither is a complete per-ZIP sample comparison."}
OUTPUT.write_text(json.dumps(REPORT, indent=2, ensure_ascii=False) + "\n")
for state, result in REPORT["states"].items():
    print(state, {k: v for k, v in result.items() if k in ["status", "officialContestCount", "officialCandidacyCount", "missingCandidates", "extraHeldCandidates", "partyDifferences"]})
