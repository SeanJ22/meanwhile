# voting-linking-copies.json — source note

These are the saved official linking pages that tell readers why a voting-site source is official: a government or election
office page that links to the vendor or county page a voting door reads. Before DB-03A each voting door carried its full linking
page HTML inline in cp_doors config (1,517 voting doors, 392.7 MB of votingSource and votingMappings text in production on
October 25, 2026). DB-03A_expand saves each page once as a reader source copy (source_copy.content with its sha256) and leaves only
a reference in the door.

The file holds 81 pages keyed by source copy id, each with its URL, HTML and sha256. 57 come from the FEC state election office
directory (https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/), the rest
from state and county election sites such as ncsbe.gov, elections.sbcounty.gov, votetexas.gov, dos.fl.gov, dcboe.org and
ceepur.org. Every FEC entry is a normalized link excerpt read on 2026-10-13, marked as such in an HTML comment at its top: it is
the exact destination and visible URL from the directory, not the original response bytes. The migration saves these seeds first
and refuses to run if a saved copy differs from its seed, and every door's authority decision must come out the same with the
saved copy as with the inline page. The pages are evidence of an official link, not a national enumeration of election offices.
