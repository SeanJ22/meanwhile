# BA-01 Alaska source recovery

The held ballot has53 core contests/132 candidacy rows,21 judicial retention contests/21 candidates and2 measures. Fresh full-core certification/sample comparison remains open.

The official DOE hostname (www/nonwww/dev and legacy elections.state.ak.us) fails through the managed environment with HTTP503:Envoy upstream TLS CERTIFICATE_VERIFY_FAILED. The former public CloudFront distribution returns502 origin failure for candidate pages and sample ballots. HTTP redirects to HTTPS. Cloud runtime status reports unrestricted/enforced HTTP; no TCP or VPN path is configured. TLS verification remains enabled. These are transport/access failures and do not imply that the information is unpublished.

The government website of Tlingit & Haida is readable and reproduces federal and Southeast/Anchorage legislative slates with DOE references. Raw HTML and extraction are retained. Its questionnaires explicitly omit nonrespondents and are excluded from completeness comparisons. This government-compiled subset does not replace the statewide certified DOE list, and source names/party presentation can be abbreviated. No ballot rows are changed based on it.

Other inspected routes:Alaska State Library and Talking Books pages returned245-byte intermediary error pages, despite HTTP200; they were not accepted as source content. APOC campaign filings establish filings, not general-election certification. Procurement pages establish pamphlet production, not candidate certification. Tribal compiled lists and government-hosted/linked copies remain useful recovery paths.

The Lieutenant Governor’s official September4 certification announcement was recovered directly from ltgov.alaska.gov. It explicitly confirms Treg Taylor for Governor and Jose Tagle for House District22 and instructs DOE to update the certified list. Both leads are held already. This is actual certification evidence for those two named candidates; it neither provides the full statewide list nor verifies a governor running mate or party fields. Exact HTML/text and a separate certification comparison are retained.
