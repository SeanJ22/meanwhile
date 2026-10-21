"""Add the five State Board of Education races printed in the official list."""
from pathlib import Path
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south"
path = EVIDENCE / "ks-all-2026.html"
meta = json.loads((EVIDENCE / "ks-all-2026.source.json").read_text())
assert hashlib.sha256(path.read_bytes()).hexdigest() == meta["sha256"]
source = path.read_text()
assert "2026 General" in source
rows = []
for block in re.findall(r"<tr[^>]*>(.*?)</tr>", source, re.S | re.I):
    cells = [html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
             for cell in re.findall(r"<td[^>]*>(.*?)</td>", block, re.S | re.I)]
    if len(cells) == 25 and cells[1] == "Member, State Board of Education":
        rows.append((cells, block))
assert len(rows) == 10
groups = {}
for row, block in rows:
    assert row[2] in {"1", "3", "5", "7", "9"}
    groups.setdefault(row[2], []).append((row, block))
state_file = ROOT / "data/ballot/2026-general/ks.json"
data = json.loads(state_file.read_text())
ballot = data["ballots"]["KS:ks-2026-11-03"]
added = 0
for district, candidates in groups.items():
    assert len(candidates) == 2
    cid = "ks-ba01-2026-state-board-of-education-" + district
    if any(row["id"] == cid for row in ballot["contests"]):
        continue
    provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "Kansas Secretary of State",
                  "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
                  "quote": "\n".join(" | ".join(row[:6]) for row, _block in candidates)}
    ballot["contests"].append({"id": cid, "electionId": ballot["election"]["id"],
        "ocdId": "ocd-division/country:us/state:ks/sbe:" + district, "divisionVintage": "2026",
        "title": "State Board of Education, District " + district, "type": "CANDIDACY", "voteFor": 1,
        "termYears": None, "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
    for row, block in candidates:
        name, party = row[0], row[5]
        assert html.escape(name, quote=False) in block or name in html.unescape(block)
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        ballot["candidacies"].append({"id": cid + "-" + slug, "contestId": cid,
            "familyName": name, "givenName": "", "partyLabel": party, "slogan": None,
            "incumbent": None, "websiteUrl": None, "provenance": provenance})
    added += 1
receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
    "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": "Kansas Secretary of State",
    "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
    "reviewedEvidence": "Official 2026 General candidate table returned by the election-36 Submit control. scripts/ba01-south-kansas.py replays all ten listed State Board of Education candidate names, offices, district numbers and parties from the saved response. No residential contact fields are published."}
if not any(row.get("rawHash") == receipt["rawHash"] and row.get("finalUrl") == receipt["finalUrl"] for row in data["sourceReceipt"]["sources"]):
    data["sourceReceipt"]["sources"].append(receipt)
data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "KS", "added_contests": added, "added_candidacies": added * 2,
                  "contests": len(ballot["contests"]), "candidacies": len(ballot["candidacies"])}))
