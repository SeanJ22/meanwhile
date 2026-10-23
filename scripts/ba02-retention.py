"""Replay saved official retention wording for Florida, Missouri and CNMI.

Statutory templates are filled only with the judge and court already verified by
the certified candidate record. CNMI wording is extracted from every specimen.
The ordinary ballot assembler publishes these same state inputs on each run.
"""
import argparse
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "data/ballot/evidence/ba02-retention"


def plain(raw):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", raw.decode())).split())


def source(key):
    meta = json.loads((CAPTURES / f"{key}.source.json").read_text())
    raw = (CAPTURES / f"{key}.html").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == meta["rawHash"]
    assert meta["httpStatus"] == 200
    return plain(raw), meta


def provenance(meta, quote):
    return {"sourceUrl": meta["finalUrl"], "sourceOrg": meta["publisher"],
            "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"], "quote": quote}


def add_receipt(package, meta, explanation):
    receipt = {**meta, "sourceClass": "OFFICIAL_PUBLISHER", "reviewOutcome": "SUPPORTED",
               "reviewedEvidence": explanation}
    sources = package["sourceReceipt"]["sources"]
    sources[:] = [s for s in sources if s["finalUrl"] != meta["finalUrl"]]
    sources.append(receipt)
    package["sourceReceipt"]["reviewedAt"] = max(s["retrievedAt"] for s in sources)
    package["sourceReceipt"]["reviewedBy"] = "BA-02 saved official retention wording replay"


def replay(write=False):
    florida, fl_meta = source("fl-105041")
    fl_template = "Shall Justice (or Judge) (name of justice or judge) of the (name of the court) be retained in office?"
    assert fl_template in florida and 'thereafter the words “Yes” and “No.”' in florida
    missouri, mo_meta = source("mo-constitution")
    assert 'Shall Judge __________________ (Here the name of the judge shall be inserted) of the __________________ (Here the title of the court shall be inserted) be retained in office?' in missouri
    mo_template = 'Shall Judge __________________ (Here the name of the judge shall be inserted) of the __________________ (Here the title of the court shall be inserted) be retained in office?'

    appeals_folder = ROOT / "data/ballot/ba01-southeast-sources"
    appeals_raw = gzip.decompress((appeals_folder / "fl-appellate-statute.gz").read_bytes())
    appeals_meta = json.loads((appeals_folder / "fl-appellate-statute.meta.json").read_text())
    assert hashlib.sha256(appeals_raw).hexdigest() == appeals_meta["rawHash"]
    appeals = plain(appeals_raw)
    ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"]
    for ordinal in ordinals:
        assert f"The {ordinal} Appellate District is composed of" in appeals

    mp_folder = ROOT / "data/ballot/evidence/ba01-south/territories"
    mp_meta = json.loads((mp_folder / "mp-sample.pdf.source.json").read_text())
    assert hashlib.sha256((mp_folder / "mp-sample.pdf").read_bytes()).hexdigest() == mp_meta["sha256"]
    mp_text = subprocess.run(["pdftotext", "-raw", str(mp_folder / "mp-sample.pdf"), "-"], check=True, capture_output=True).stdout.decode()
    mp_question = "Shall Justice Alexandro Cruz Castro of the CNMI Supreme Court be retained in office?"
    mp_questions = re.findall(r"Shall Justice .*?retained in office\?", mp_text, re.S)
    assert len(mp_questions) == 13
    assert {" ".join(q.split()) for q in mp_questions} == {mp_question}
    mp_provenance_meta = {"finalUrl": mp_meta["finalUrl"], "publisher": "Commonwealth Election Commission of the Northern Mariana Islands", "retrievedAt": mp_meta["retrievedAt"]}

    result = {}
    for state, expected in [("fl", 23), ("mo", 1), ("mp", 1)]:
        path = ROOT / f"data/ballot/2026-general/{state}.json"
        package = json.loads(path.read_text())
        count = 0
        for ballot in package["ballots"].values():
            for contest in ballot["contests"]:
                if contest["type"] != "RETENTION":
                    continue
                candidates = [c for c in ballot["candidacies"] if c["contestId"] == contest["id"]]
                assert len(candidates) == 1
                candidate = candidates[0]
                name = " ".join([candidate["givenName"], candidate["familyName"]]).strip()
                assert candidate["provenance"]["sourceUrl"] and contest["provenance"]["sourceUrl"]
                if state == "fl":
                    assert name in contest["title"]
                    if "Supreme Court" in contest["title"]:
                        role, court = "Justice", "Supreme Court"
                    else:
                        district = re.fullmatch(r".*District Court of Appeal District ([1-6]) — .*", contest["title"])[1]
                        assert contest["ocdId"].endswith(f"/district_court:{district}")
                        role, court = "Judge", f"{ordinals[int(district)-1]} District Court of Appeal"
                    question = f"Shall {role} {name} of the {court} be retained in office?"
                    quote = fl_template + f" | Certified candidate: {name}; court: {court}. | " + candidate["provenance"].get("quote", "")
                    question_provenance = provenance(fl_meta, quote)
                elif state == "mo":
                    assert name == "Paul C. Wilson" and "Missouri Supreme Court" in contest["title"]
                    held_certification = (ROOT / "data/ballot/evidence/ba01-great-lakes/mo-candidates.web.txt").read_text()
                    assert "For the Missouri Supreme Court\nL496@P25: Paul C. Wilson" in held_certification
                    question = f"Shall Judge {name} of the Missouri Supreme Court be retained in office?"
                    question_provenance = provenance(mo_meta, mo_template + " | Certified candidate: Paul C. Wilson; court: Missouri Supreme Court.")
                else:
                    assert name == "Alexandro Cruz Castro"
                    question, question_provenance = mp_question, provenance(mp_provenance_meta, mp_question)
                contest["retentionQuestion"] = {"questionText": question, "provenance": question_provenance}
                contest["voteFor"] = 1
                count += 1
        assert count == expected, (state, count)
        if state == "fl":
            add_receipt(package, fl_meta, "Florida Statutes 105.041(2) supplies the exact mandatory retention question and Yes/No. Filled names and courts match the held certified candidate records; appellate ordinals are verified against Chapter 35. All 23 retention questions are replayed by scripts/ba02-retention.py.")
        elif state == "mo":
            add_receipt(package, mo_meta, "Missouri Constitution V25(c)(1) supplies the exact judicial retention question. The held 2026 Secretary of State certification prints Paul C. Wilson under Missouri Supreme Court; scripts/ba02-retention.py checks both values and substitutes only those template fields.")
        else:
            for receipt in package["sourceReceipt"]["sources"]:
                if receipt["finalUrl"] == mp_meta["finalUrl"]:
                    receipt["reviewedEvidence"] = "All 13 fronts of the saved 2026 official specimen print the identical full question, 'Shall Justice Alexandro Cruz Castro of the CNMI Supreme Court be retained in office?' and Vote Yes or No. scripts/ba02-retention.py extracts each occurrence and compares every word. Existing BA-01 candidate, ticket, party and scope checks remain applicable."
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
        else:
            actual = json.loads(path.read_text())
            for key, ballot in package["ballots"].items():
                held = {c["id"]: c for c in actual["ballots"][key]["contests"]}
                for c in ballot["contests"]:
                    if c["type"] == "RETENTION":
                        assert held[c["id"]].get("retentionQuestion") == c["retentionQuestion"]
                        assert held[c["id"]]["voteFor"] == 1
        result[state.upper()] = count
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    print(json.dumps(replay(parser.parse_args().write), sort_keys=True))
