# boarddocs_tenants.csv — source note

The CSV contains a header and no tenant rows. BoardDocs tenants use path segments on a shared host, such as `https://go.boarddocs.com/mi/grand/Board.nsf/Public`; certificate transparency does not enumerate them. No public national tenant directory has been found.

Standing platform census and meetings discovery collect tenant links from each government's own website. The public portal publishes committee selectors (`committeeid` and body name). Discovery reads each committee with a form POST to `Board.nsf/BD-GetMeetingsList?open`, passing `current_committee_id`; the BoardDocs reader then reads public `BD-GetMeeting` details for the active window and keeps the publisher's agenda link. Tenant names and committee IDs are read from source pages, never guessed.

The committed Grand Rapids Public Schools list and meeting-detail fixtures in `tests/fixtures/boarddocs-grand-rapids-*` are real public captures retained by City Bureau. Their source URLs, repository references, blobs and form parameters are recorded in `tests/fixtures/platform-census-reader-sources.json`. They verify the route's parser and agenda permalink without needing a live connection.

Live BoardDocs HTTP could not be reached from the PC-01 workspace: its configured network proxy was unreachable. This is a workspace transport failure. The public reader still checks and records actual HTTP refusals and challenges in the normal source ladder. Robots.txt is recorded and does not stop public acquisition under `docs/rulings.md`.
