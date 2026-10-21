"""Verify archived BA-01 source bytes without changing their original receipt identity.

The redaction manifest pins both the original source fingerprint and the exact
sanitized archive. A modified archive does not resolve to an original fingerprint.
Ordinary, unredacted bytes retain their normal SHA-256 hash.
"""
from functools import lru_cache
import hashlib
import json
from pathlib import Path


@lru_cache(maxsize=1)
def _originals():
    path = Path(__file__).resolve().parents[1] / "data/ballot/ba01-source-redactions.json"
    identities = {}
    for entry in json.loads(path.read_text())["captures"].values():
        pairs = [(entry["sanitizedSha256"], entry["rawSha256"]),
                 (entry["sanitizedDecodedSha256"], entry["rawDecodedSha256"])]
        pairs.extend((body["sanitizedSha256"], body["rawSha256"])
                     for body in entry["embeddedBodies"])
        for sanitized, original in pairs:
            identities.setdefault(sanitized, set()).add(original)
    return identities


def capture_sha256(archived_bytes):
    """Original capture fingerprint, only for bytes pinned by the redaction manifest."""
    digest = hashlib.sha256(archived_bytes).hexdigest()
    originals = _originals().get(digest)
    if originals is None:
        return digest
    if len(originals) != 1:
        raise ValueError("Ambiguous original capture fingerprint")
    return next(iter(originals))
