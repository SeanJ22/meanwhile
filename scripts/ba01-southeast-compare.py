"""Reproduce BA-01 core candidate counts from saved official documents.

This is a comparison report, not a publication gate. Local district gaps and
unavailable write-in rosters remain open even when printed core counts match.
"""
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import pathlib
import re
import subprocess
import zipfile
from datetime import datetime, timezone

import openpyxl
import pandas

import runpy

capture_sha256 = runpy.run_path(str(pathlib.Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "data/ballot/ba01-southeast-sources"


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def capture(key):
    meta = json.loads((CAPTURES / (key + ".meta.json")).read_text())
    raw = gzip.decompress((CAPTURES / (key + ".gz")).read_bytes())
    assert capture_sha256(raw) == meta["rawHash"]
    return raw, meta


def csv_rows(key, delimiter=","):
    return list(csv.DictReader(io.StringIO(capture(key)[0].decode("utf-8-sig")), delimiter=delimiter))


def workbook_rows(key):
    raw = capture(key)[0]
    workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    rows = iter(workbook.active.values)
    heading = next(rows)
    return [dict(zip(heading, row)) for row in rows]


def name_pair(name, party):
    return normalized(name), party or None


def compare():
    counts, names, source_keys = {}, {}, {}
    fl = [r for key in ["fl-11", "fl-2"] for r in csv_rows(key, "\t")
          if r["StatusCode"] in ["QUA", "UNO"] and r["OfficeCode"] in ["STR", "STS", "USR", "USS", "GOV", "ATG", "CFO", "AGR", "SCJ"]]
    counts["FL"] = len({(r["OfficeCode"], r["Juris1num"], r["Juris2num"]) for r in fl}), len(fl)
    source_keys["FL"] = ["fl-11", "fl-2"]

    archive = zipfile.ZipFile(io.BytesIO(capture("ga-1")[0]))
    workbook = openpyxl.load_workbook(io.BytesIO(archive.read(archive.namelist()[0])), data_only=True)
    ga = [r for r in list(workbook.active.values)[1:] if r[0] and r[1] and not r[0].startswith("District Attorney")]
    write_text = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=capture("ga-writeins")[0]).decode()
    write_names = []
    started = False
    for line in write_text.splitlines():
        line = line.strip()
        if line.startswith("Pursuant to O.C.G.A."):
            break
        if re.fullmatch(r"U\.S\. Senate|Governor|U\.S\. House of Representatives, District \d+|State Representative, District \d+", line):
            started = True
        elif started and line:
            write_names.append(line)
    assert len(write_names) == 21
    counts["GA"] = len({r[0].strip() for r in ga}), len(ga) + len(write_names)
    names["GA"] = {name_pair(r[1], r[3]) for r in ga} | {name_pair(n, None) for n in write_names}
    source_keys["GA"] = ["ga-1", "ga-writeins"]

    nc = {(r["contest_name"], r["name_on_ballot"], r["party_candidate"]) for r in csv_rows("nc-1") if r["election_dt"] == "11/03/2026" and r["contest_name"].startswith(("US ", "NC STATE SENATE", "NC HOUSE OF REPRESENTATIVES", "NC SUPREME", "NC COURT OF APPEALS"))}
    counts["NC"] = len({r[0] for r in nc}), len(nc)
    names["NC"] = {name_pair(r[1], r[2]) for r in nc}
    source_keys["NC"] = ["nc-1"]

    va = {(r["Office Title"], r["District"], r["Candidate Name"], r["Candidate Party"]) for r in workbook_rows("va-2") if r["Office Title"] in ["Member, United States Senate", "Member, House of Representatives", "Member, House of Delegates"]}
    counts["VA"] = len({r[:2] for r in va}), len(va)
    names["VA"] = {name_pair(r[2], r[3]) for r in va}
    source_keys["VA"] = ["va-2"]

    sc = [r for key in ["sc-session-export", "sc-special-export"] for r in csv_rows(key) if r["Status"] == "Active" and (r["Office"].startswith(("U.S.", "State House", "State Senate")) or r["Office"] in ["Governor and Lieutenant Governor", "Secretary of State", "State Treasurer", "Attorney General", "Comptroller General", "State Superintendent of Education", "Commissioner of Agriculture"])]
    counts["SC"] = len({r["Office"] for r in sc}), len(sc)
    names["SC"] = {name_pair((r["Ballot Name (first - middle)"] + " " + r["Ballot Name (last - suffix)"]).strip() + (" and " + re.sub(r" \(Active\)$", "", r["Running Mate"]) if r["Running Mate"] else ""), r["Party"]) for r in sc}
    source_keys["SC"] = ["sc-session-export", "sc-special-export"]

    md = [r for r in csv_rows("md-30") if r["Candidate Status"] == "Active" and r["Office Name"] not in ["Judge of the Circuit Court", "Justice Supreme Court of Maryland"]]
    counts["MD"] = len({(r["Office Name"], r["Contest Run By District Name and Number"]) for r in md}), len(md)
    names["MD"] = {name_pair((r["Candidate First Name and Middle Name"] + " " + r["Candidate Ballot Last Name and Suffix"]).strip() + (" and " + r["Related Candidate First Name and Middle Name"] + " " + r["Related Candidate Last Name and Suffix"] if r["Has Related Candidate"] == "Yes" else ""), r["Office Political Party"]) for r in md}
    source_keys["MD"] = ["md-30"]

    de = [r for r in pandas.read_html(io.StringIO(capture("de-3")[0].decode()))[0].to_dict("records") if r["Status"] == "Qualified" and (r["County"] == "Statewide" or r["Office"].startswith(("State Representative", "State Senator")))]
    writeins = {(r["Office"], r["Candidate"]) for table in pandas.read_html(io.StringIO(capture("de-4")[0].decode())) for r in table.to_dict("records") if r["Status"] == "Qualified" and (r["County"] == "Statewide" or r["Office"].startswith(("State Representative", "State Senator")))}
    counts["DE"] = len({r["Office"] for r in de}), len(de) + len(writeins)
    names["DE"] = {name_pair(r["Candidate"], r["Party"]) for r in de} | {name_pair(name, None) for office, name in writeins}
    source_keys["DE"] = ["de-3", "de-4"]

    printed = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=capture("dc-2")[0]).decode()
    dc_names = []
    for line in printed.splitlines():
        if re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", line):
            cell = re.split(r"\s{2,}", line.strip())[0]
            parts = cell.rsplit(" - ", 1)
            dc_names.append(name_pair(parts[0], parts[1] if len(parts) > 1 else None))
    declared = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=capture("dc-3")[0]).decode()
    declared_names = []
    for line in declared.splitlines():
        cells = re.split(r"\s{2,}", line.strip())
        if len(cells) >= 3 and cells[1] in ["Delegate to the U.S. House of Representatives", "Mayor of the District of Columbia", "Chairman of the Council", "At-Large Member of the Council"]:
            declared_names.append(name_pair(cells[0], cells[2]))
    assert len(dc_names) == 36 and len(declared_names) == 15
    counts["DC"] = 15, len(dc_names) + len(declared_names)
    names["DC"] = set(dc_names + declared_names)
    source_keys["DC"] = ["dc-2", "dc-3"]

    spec = importlib.util.spec_from_file_location("wv_comparison", ROOT / "scripts/ba01-southeast-west-virginia.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    wv = module.replay(CAPTURES, False)
    counts["WV"] = wv["officialFederalLegislativeContests"], wv["officialMaximumPrintedCandidacies"]
    source_keys["WV"] = ["wv-county-0", "wv-county-19"]

    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "delivery": "Corrected repository data; production-copy publication and live runner verification are separate.", "scope": "Federal, statewide and state legislative candidate contests; DC includes its main District and ward-office list. Regional and local additions are counted separately. Statewide measure counts below are held counts, not a new complete measure census.", "states": []}
    for state in ["FL", "GA", "NC", "SC", "VA", "WV", "DC", "MD", "DE"]:
        data_path = "data/ballot/2026-general/" + state.lower() + ".json"
        package = json.loads((ROOT / data_path).read_text())
        ballot = next(iter(package["ballots"].values()))
        root = "ocd-division/country:us/" + ("district:" if state == "DC" else "state:") + state.lower()
        core = {r["id"] for r in ballot["contests"] if re.fullmatch(re.escape(root) + r"(?:/(?:cd|sldl|sldu|ward):[^/]+)?", r["ocdId"]) and r["type"] != "MEASURE"}
        candidates = [r for r in ballot["candidacies"] if r["contestId"] in core]
        assert (len(core), len(candidates)) == counts[state], (state, counts[state], len(core), len(candidates))
        if state in names:
            missing = [r["givenName"] + " " + r["familyName"] for r in candidates if name_pair(r["givenName"] + " " + r["familyName"], r["partyLabel"]) not in names[state]]
            assert not missing, (state, missing)
        if state == "FL":
            assert all(any(r["id"].endswith("candidate-" + source["AcctNum"]) and r["partyLabel"] == source["PartyCode"] for source in fl) for r in candidates)
        report["states"].append({"state": state, "officialCoreCandidateContests": counts[state][0], "matchedCoreCandidateContests": len(core),
            "officialCoreCandidacies": counts[state][1], "matchedCoreCandidacies": len(candidates), "missingSourceListedCoreContests": 0,
            "missingSourceListedCoreCandidacies": 0, "heldStatewideMeasures": sum(r["type"] == "MEASURE" and r["ocdId"] == root for r in ballot["contests"]),
            "sources": [json.loads((CAPTURES / (key + ".meta.json")).read_text())["finalUrl"] for key in source_keys[state]],
            "remaining": "Local and regional ballots remain incomplete; see the state comparison notes."})
    return report


if __name__ == "__main__":
    print(json.dumps(compare(), ensure_ascii=False, indent=2))
