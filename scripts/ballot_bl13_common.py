import hashlib
import json
import re
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]


def capture(state, url, label):
    directory = ROOT / ".scratch/ballot-bl-13" / state.lower()
    directory.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Meanwhile public election research"})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read()
        status = response.status
        final = response.url
    assert status == 200, (url, status)
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    path = directory / label
    path.write_bytes(raw)
    receipt = {"sourceClass": "ELECTION_AUTHORITY", "requestedUrl": url,
               "finalUrl": final, "httpStatus": status,
               "rawHash": hashlib.sha256(raw).hexdigest(), "retrievedAt": stamp}
    path.with_name(path.name + ".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return raw, receipt


def provenance(receipt, publisher):
    receipt["publisher"] = publisher
    receipt["reviewedEvidence"] = "Official election publication converted from the captured response bytes."
    return {"sourceUrl": receipt["finalUrl"], "sourceOrg": publisher,
            "collectedAt": receipt["retrievedAt"], "verifiedAt": receipt["retrievedAt"]}


def pdf_text(raw):
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=raw,
                          stdout=subprocess.PIPE, check=True).stdout.decode()


def document(raw):
    return html.fromstring(raw)


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def ballot(state):
    return {"election": {"id": f"{state.lower()}-2026-11-03", "date": "2026-11-03",
                         "name": "2026 General Election", "state": state.upper()},
            "contests": [], "candidacies": [], "measures": [], "absences": [], "coverageNotes": []}


def contest(held, key, title, ocd_suffix, proof, complete=False, kind="CANDIDACY", **fields):
    state = held["election"]["state"].lower()
    row = {"id": f"{state}-sos-2026-{key}", "electionId": held["election"]["id"],
           "ocdId": f"ocd-division/country:us/state:{state}{ocd_suffix}",
           "divisionVintage": "2026", "title": title, "type": kind,
           "voteFor": None, "termYears": None, "scopeNote": None, "provenance": proof}
    if kind == "CANDIDACY":
        row["candidateListComplete"] = complete
    row.update(fields)
    held["contests"].append(row)
    return row


def candidate(held, race, name, party, proof, incumbent=None, website=None):
    parts = name.rsplit(" ", 1)
    row = {"id": f'{race["id"]}:{len([c for c in held["candidacies"] if c["contestId"] == race["id"]]) + 1}',
           "contestId": race["id"], "givenName": parts[0] if len(parts) > 1 else "",
           "familyName": parts[-1], "partyLabel": party, "slogan": None,
           "incumbent": incumbent, "websiteUrl": website, "provenance": proof}
    held["candidacies"].append(row)
    return row


def package(held, receipts):
    held = {**held, "coverageNotes": [re.sub(r"\s+https?://\S+", "", note)
                                      for note in held.get("coverageNotes", [])]}
    latest = max(r["retrievedAt"] for r in receipts)
    key = f'{held["election"]["state"]}:{held["election"]["id"]}'
    return {"contractId": "ballot-contests", "version": "2026-11-03",
            "sourceThrough": latest[:10],
            "sourceReceipt": {"contractVersion": 1, "reviewedAt": latest,
                              "reviewedBy": "Codex BL-13", "sources": receipts},
            "payload": {"kind": "ballot-contests", "ballots": {key: held}}}


def write_package(held, receipts, output):
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(package(held, receipts), ensure_ascii=False, indent=2) + "\n")
