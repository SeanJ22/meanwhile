# Note for PB-02 from FX-01 (Oct 23, 6:08 AM Eastern)

FX-01 was asked to repair the pb-02 return (national sample). The pb-02 lane pushed its own new READY `85bf54e3d` first, so FX-01 pushed nothing for PB-02. Below are FX-01's independent national results and three findings. They apply to `85bf54e3d` as well. All production access was SELECT-only. All replay writes stayed in PGlite or memory.

## Independent national sample

- Rule: every finding in `cp_box_findings` now refused by `fact-publisher` whose refusal is `SEAT_NOT_IN_QUOTE` or whose held class is `rosters`. The state comes from the subject (`xx:…`, `government:US-XX:…`, `ocd-division/…/state:xx`). Each state contributes its 10 most recently reported findings (`lastRecordedAt` desc, then id).
- Snapshot `2026-10-23T09:08:10.991Z`: 109 findings (108 `SEAT_NOT_IN_QUOTE`, 1 `NO_PERSON_NAMED_IN_QUOTE`) from 15 states and DC. Every state holding such a refusal is included.
- The scoped entity snapshot came from the publisher's own `canonicalSubject` / `boardFor` / `readCheckEntity`, run on the reader DB with a SELECT-only query: 201 entities, 62 hosts, 136 external ids and 145 place links.
- The 87 cited pages were read once each at 09:11:17Z through `pacedProbeFetch` + `fetchCapture`. 70 were captured. The other 17 are unavailable: Fort Smith 13×403, Highlands Ranch 2×403, Downey timeout, Autauga non-UTF-8, and a Parish Hill 202 SiteGround bot challenge.
- The same inputs were replayed through each code version: the original READY `7939d20df`, the new READY `85bf54e3d`, and FX-01's local branch (7939d20df plus the patch below).

Per state (replayed / published on the first scheduled tick / published on the next-day tick / refused for missing seat evidence / refused as non-person / refused for source unavailable / refused for another reason):

| State | `85bf54e3d` | 7939d20df + FX patch |
|---|---|---|
| AK | 10/1/1/8/0/0/0 | 10/1/1/8/0/0/0 |
| AL | 10/0/0/8/0/2/0 | 10/0/0/8/0/2/0 |
| AR | 10/0/0/4/0/6/0 | 10/0/0/4/0/6/0 |
| AZ | 10/1/0/9/0/0/0 | 10/1/0/9/0/0/0 |
| CA | 10/0/0/10/0/0/0 | 10/0/0/10/0/0/0 |
| CO | 10/0/0/5/0/5/0 | 10/1/0/4/0/5/0 |
| CT | 10/1/0/0/0/4/5 page-not-about-entity | 10/1/0/3/0/4/2 page-not-about-entity |
| DC | 4/0/0/4/0/0/0 | 4/0/0/4/0/0/0 |
| DE | 2/0/0/2/0/0/0 | 2/0/0/2/0/0/0 |
| FL | 10/0/0/9/1/0/0 | 10/0/0/9/1/0/0 |
| GA | 5/3/0/2/0/0/0 | 5/4/0/1/0/0/0 |
| HI | 1/0/0/0/0/0/1 no-person-named | same |
| IA | 10/0/0/10/0/0/0 | 10/0/0/10/0/0/0 |
| ID | 5/0/0/4/0/1/0 | 5/3/0/1/0/1/0 (includes the Stapleton false positive below) |
| IL | 1/0/0/1/0/0/0 | 1/0/0/1/0/0/0 |
| KS | 1/0/0/1/0/0/0 | 1/1/0/0/0/0/0 |
| Total | 109/6/1/77/1/18/6 | 109/12/1/74/1/18/3 |

- **Next-day proof.** The withheld finding is chosen by rule: the lowest-id finding an identical pass publishes whose name no other published finding carries. Here that is Kent Mitchell (Houston, AK), `box-sha256-00695b80…51d6`. The real `IndependentRuntimeLaneScheduler` / `publishNowLane` ticks at `2026-10-23T09:11:17.998Z`. Normal intake receives all 109 at `2026-10-24T09:11:17.998Z`. The next tick looks at 19 findings (the arrival plus 18 source-unavailable retries) and publishes Mitchell into `Representation`. Every earlier name stays, and no built finding reopens. This holds on both code versions.
- **Connected end to end.** Live native facts → `withFactRegistry` → `rosterHoldersForBody` → `Representation`. Chromium 141.0.7390.37 opened FX-01's render with the network blocked: 10 body sections, and no refused staff name.
- **What stays refused.** The 74–77 missing-seat refusals cite staff directories, department and contact pages, committee-representative tables, a HUD contact list, policy titles and school names. FX-01 checked them by hand. Apart from the cases in finding 2, none lists the name as a member of the body.

## Finding 1: `85bf54e3d` (and `7939d20df`) break `tests/hunters-own-calendar.test.ts` against river

The test "a member page a hunter found, linked from nowhere the walk would look, is read first and its members reach the board's live page" passes on `origin/river` `78f82a232`. It fails on both READYs with `the link is handed to the walk, not parked or published: 0 !== 1`. PB-02 now hands link findings to the site walk at intake, so the publisher's `handed` count is 0. Only that assertion is stale; the rest of the test passes once it is updated (patch below). River's `pnpm gates` will fail on this.

## Finding 2: members lists with contact lines still refuse real members on `85bf54e3d`

These board members are listed on current member pages and stay `SEAT_NOT_IN_QUOTE` on `85bf54e3d`. FX-01's patch seats them:
- Kathy Holling, `https://usd110.net/board-of-education/`. Page text: "Board Members:", then name / email lines.
- Karl Vollmer and Alan Summers, `http://www.aberdeenidaho.us/city-council.html`. Page text: "City Council Members", then a broken name line "Brian Schneide r".
- Alan Hassler, `https://www.kremmlingfire.org/board-of-directors`, a special district. Page text: "Our current board members are listed below…", then name / email lines.
- Jacqueline Roberts, `https://tallapoosaga.gov/city-council/`. Page text: "Post 2" under her name.
- Kurt Love (Ashford) and Susan Bradford (Bethany) reach `PAGE_NOT_ABOUT_ENTITY` on both versions: their sites hold no registered host and do not name the registered government. That is open jurisdiction-host work, not seat evidence.

The patch does four things:
- It lets a members list run through each member's email, phone, term, seat and expiry lines, one note under the heading, and one broken name.
- It judges the seat on the heading plus the person's own entry only (`ownListing`, which the seat audit also applies).
- It treats a board's secretary, treasurer or clerk who serves a term as a board officer, and seats a special district's or county's own board-members list.
- It counts `Post N` as a seat.

Regression tests are in the patch. `85bf54e3d` rewrote parts of `seat-evidence.ts`, so the patch needs a merge rather than a clean apply.

## Finding 3: Noni Stapleton (Melba, ID) was a false positive on `7939d20df`, and `85bf54e3d` fixes it

On `7939d20df`, Noni Stapleton, the Melba **City Clerk**, was seated as "mayor". The quote was `mayor@cityofmelba.org\nNoni Stapleton`: the previous person's email was read as her title. FX-01's patch on top of `7939d20df` still publishes her. `85bf54e3d` refuses her correctly. Keep that behavior if the patch is merged.

## Also seen

- `fetchCapture` saves a 202 holding page as evidence. Parish Hill's 202 SiteGround challenge then refuses three real board members as `SEAT_NOT_IN_QUOTE` instead of retrying as source-unavailable. The patch returns `HTTP_202` and adds a test in `tests/page-refresh.test.ts`; that test hunk is not in the diff below.
- `ensureGoverningBody` named two production school boards after their planning region: `ct:depschool:farmington-town-schools#board` = "Capitol Planning Region school board" and `ct:depschool:bethel-town-schools#board`. Beth Kintner shows under that name. This is outside PB-02.
- FX-01's generalized `scripts/pb02-replay.mts` takes `--findings --entities --captures --out`, captures pages itself when the captures file is absent, reports `byState`, and reserves the next-day finding by rule. It is on FX-01's local, unpushed `stream/pb-02-fx` and can be sent if wanted.

```diff
diff --git a/lib/facts/capture.ts b/lib/facts/capture.ts
index 7063ed4a7..d1886b8b8 100644
--- a/lib/facts/capture.ts
+++ b/lib/facts/capture.ts
@@ -41,7 +41,8 @@ export async function fetchCapture(input: {
 }): Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
   let response;
   try { response = await input.fetch(input.url, {}); } catch (error) { return { error: `FETCH_FAILED:${error instanceof Error ? error.message : String(error)}` }; }
-  if (response.status < 200 || response.status >= 300) return { error: `HTTP_${response.status}` };
+  // 202 Accepted is a website's holding page (a bot challenge), not the page itself.
+  if (response.status < 200 || response.status >= 300 || response.status === 202) return { error: `HTTP_${response.status}` };
   return saveCapture({ repos: input.repos, vault: input.vault, url: input.url, bytes: await response.bytes(), httpStatus: response.status,
     contentType: response.headers.get("content-type") ?? "text/html", retrievedAt: input.now });
 }
diff --git a/lib/facts/seat-evidence.ts b/lib/facts/seat-evidence.ts
index f465a5a08..0cf49e5c9 100644
--- a/lib/facts/seat-evidence.ts
+++ b/lib/facts/seat-evidence.ts
@@ -7,15 +7,32 @@ const JOB_SUPERVISOR = "(?:maintenance|road|roads|highway|street|streets|bridge|
 const STAFF_TITLE = new RegExp(`\\b(manager|clerk|attorney|administrator|director|superintendent|engineer|planner|treasurer|secretary|coordinator|assistant|staff|specialist|technician|captain|officer|${JOB_SUPERVISOR}|supervisors? of (?:maintenance|roads?|highways?|streets?|public works|operations|parks))\\b`, "i");
 const COUNCIL_SEAT = /\b((vice|deputy)[- ]?)?mayor\b|\bcouncil[- ]?(m[ae]n|member|woman|person|or|lor|president)s?\b|\balder(m[ae]n|woman|person)\b|\bselect(m[ae]n|woman|board)\b|\b(trustee|supervisor|freeholder|legislator|commissioner)s?\b/i;
 const BOARD_SEAT = /\b(vice[- ]?)?(chair(person|man|woman)?|president)\b|\bboard (?:members?|clerk|secretary|treasurer)\b|\bmember of the board\b/i;
-const SEAT_NUMBER = /\b(?:(?:district|ward|seat|position|place|zone)\s*(?:no\.?\s*)?\d+|seat\s+[a-f]|at[- ]large)\b/i;
+const SEAT_NUMBER = /\b(?:(?:district|ward|seat|position|place|zone|post)\s*(?:no\.?\s*)?\d+|seat\s+[a-f]|at[- ]large)\b/i;
 const TERM_LINE = /\bterms?\s*(?:expires?|ends?|:|\()|\bterm of office\b|\b(?:elected|appointed) (?:to|in|for) /i;
-const SEAT_MARKER = /\b(?:(?:seat|position|place|zone|ward)\s*(?:no\.?\s*)?\d+|seat\s+[a-f])\b/i;
+const SEAT_MARKER = /\b(?:(?:seat|position|place|zone|ward|post)\s*(?:no\.?\s*)?\d+|seat\s+[a-f])\b/i;
 const WARD = /\b(?:ward|district)\s*(?:no\.?\s*)?(\d+)\b/i;
 const ROSTER_HEADER = /\bname\s+seat\s+seat expires\b/i;
+// A heading that lists this body's members: "Board of Education Members", "Board Members:", "Board of Education Membership", "Our current board members are listed below".
+const MEMBERS_HEADING = /\b(?:board(?: of (?:education|directors|trustees))?|council) members(?:hip)?\b/i;
+// A line of one listed member's own entry: an email, a phone, a term, a seat, an expiry date or a column heading.
+const MEMBER_DETAIL = /^(?:[\w.+'-]+\s*@\s*[\w-]+(?:\.[\w-]+)+|(?:(?:phone|tel|cell|fax)\s*:?\s*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b.{0,20}|(?:terms?|(?:office |term )?expires?|elected|appointed|seat|post|district|ward|position|zone)\b.{0,60}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|name|e-?mail|phone|office|contact)$/i;
+const BOARD_OFFICER = /\b(?:secretary|treasurer|clerk)\b/gi;
+
+/** In a members list, only the heading and this person's own entry speak to their seat; another member's line or a note under the heading does not. */
+function ownListing(words: string, personName: string): string {
+  const lines = words.split("\n");
+  if (lines.length < 3 || !MEMBERS_HEADING.test(lines[0]!)) return words;
+  const at = lines.findIndex((line, index) => index > 0 && line.toLowerCase().includes(personName.toLowerCase()));
+  if (at < 0) return words;
+  let end = at + 1;
+  while (end < lines.length && end - at <= 4 && MEMBER_DETAIL.test(lines[end]!.trim())) end++;
+  return [lines[0], ...lines.slice(at, end)].join("\n");
+}
 
 /** The seat a person's own words show on this body, or null: a staff title never seats anyone, and a council seats only by its own titles. */
 export function seatIn(words: string, bodyId: string, personName?: string): { readonly ward: string | null } | null {
   if (personName) {
+    words = ownListing(words, personName);
     const at = words.toLowerCase().indexOf(personName.toLowerCase());
     const before = words.slice(0, at);
     const appointment = /\b(?:appointed|elected|named)\s*$/i.exec(before);
@@ -28,14 +45,17 @@ export function seatIn(words: string, bodyId: string, personName?: string): { re
   const council = bodyId.endsWith("#governing"), board = bodyId.endsWith("#board");
   // A lettered or numbered seat is a seat held, whatever office the holder also fills ("Seat E - Secretary/Treasurer" is a school board member).
   const seated = (council || board) && SEAT_MARKER.test(words);
-  const boardOffice = board && /\bgoverning board (?:clerk|secretary|treasurer)\b/i.test(words);
+  // A board's secretary, treasurer or clerk who serves a term is one of its officers: staff do not serve terms.
+  const boardOffice = board && (/\bgoverning board (?:clerk|secretary|treasurer)\b/i.test(words) || TERM_LINE.test(words) && !STAFF_TITLE.test(words.replace(BOARD_OFFICER, "")));
   if (STAFF_TITLE.test(words) && !seated && !boardOffice) return null;
   // On a council or a board, the district, ward or seat a person holds is a seat on its own ("Annie Williams, District 1"), and a school board's plain "Member" is a member.
   // A county board's "Chairman" is a seat on it, unless the words put that chair on a committee, department or authority.
   const chairs = council && /\b(?:vice[- ]?)?chair(?:man|woman|person)?\b/i.test(words) && !/\b(?:committee|department|commission|authority|library|hospital|district board)\b/i.test(words);
   // A term served is a seat held: staff do not serve terms ("Term: October 2023 - October 2026", "Term Expires 3/28").
   const appointed = /\b(?:appointed|elected|named)\b[^.!?]{0,100}\bto (?:the )?(?:[\w.'#-]+\s+){0,10}(?:governing board|board of (?:education|trustees|supervisors)|school board|city council|town council)\b/i.test(words);
-  const numbered = (council || board) && (SEAT_NUMBER.test(words) || TERM_LINE.test(words) || ROSTER_HEADER.test(words)) || board && /\bmembers?\b/i.test(words) || chairs || appointed;
+  // A special district's or county's governing body is a board: its own members list seats the people on it.
+  const listed = council && /:(?:special|county):/.test(bodyId) && /\bboard (?:of directors|members)\b/i.test(words.split("\n")[0]!);
+  const numbered = (council || board) && (SEAT_NUMBER.test(words) || TERM_LINE.test(words) || ROSTER_HEADER.test(words)) || board && /\bmembers?\b/i.test(words) || chairs || appointed || listed;
   if (!numbered && !COUNCIL_SEAT.test(words) && (council || !BOARD_SEAT.test(words)) && (council || board || !/\bmembers?\b/i.test(words))) return null;
   const district = [...words.matchAll(new RegExp(WARD.source, "gi"))].find(match => !/\bschool\s+$/i.test(words.slice(0, match.index)));
   return { ward: council || board ? district?.[1] ?? null : null };
@@ -72,15 +92,27 @@ export function seatQuoteOnPage(page: string, name: string, bodyId: string, orig
   }
   const lines = text.split("\n");
   // An explicit members list binds every listed name to the heading. A general council page does not.
+  // A members list runs through each member's own contact and term lines; a page that broke one name apart does not end it.
   for (let start = 0; start < lines.length; start++) {
-    if (!/\b(?:board(?: of education)?|council) members\b/i.test(lines[start]!) || lines[start]!.length > 180 || /\b(?:former|past|archives?|staff|minutes|agendas?)\b/i.test(lines[start]!)) continue;
-    for (let end = start + 1; end < Math.min(lines.length, start + 25); end++) {
+    const heading = lines[start]!, closing = heading.split(/(?<=[.!?])\s+/).at(-1)!;
+    if (!(heading.length <= 180 && MEMBERS_HEADING.test(heading) || MEMBERS_HEADING.test(closing) && /\b(?:listed )?below\b/i.test(closing))
+      || /\b(?:former|past|archives?|staff|minutes|agendas?)\b/i.test(heading.length <= 180 ? heading : closing)) continue;
+    let members = 0, broken = 0;
+    for (let end = start + 1; end < lines.length && members < 40; end++) {
       const line = lines[end]!;
       if (hasName(line)) {
-        const passage = lines.slice(start, end + 1).join("\n");
+        let stop = end + 1;
+        while (stop < lines.length && stop - end <= 4 && MEMBER_DETAIL.test(lines[stop]!.trim())) stop++;
+        const passage = lines.slice(start, stop).join("\n");
         if (valid(passage)) return passage;
+        break;
       }
-      if (!looksLikeNameCell(line) && !/\b(?:president|chair|member)\b/i.test(line)) break;
+      if (looksLikeNameCell(line) || /\b(?:president|chair|member)\b/i.test(line)) { members++; broken = 0; continue; }
+      if (MEMBER_DETAIL.test(line.trim())) continue;
+      // One note under the heading before the first member ("Any communication sent to any member of the Board may be shared…").
+      if (members === 0 && end === start + 1) continue;
+      if (members > 0 && broken++ === 0 && line.length <= 40 && /^[\p{L} .'’-]+$/u.test(line)) continue;
+      break;
     }
   }
   // A table's own Name / Seat / Seat Expires columns establish lettered seats without inventing "Seat D".
diff --git a/tests/hunters-own-calendar.test.ts b/tests/hunters-own-calendar.test.ts
index b71c281c1..23c555f6c 100644
--- a/tests/hunters-own-calendar.test.ts
+++ b/tests/hunters-own-calendar.test.ts
@@ -55,8 +55,9 @@ test("a member page a hunter found, linked from nowhere the walk would look, is
     [MEMBERS]:'<title>Example, Alabama</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
   const link=await indexReportedFinding(repos.boxFindings,{workItemId:'wi-hunter',attemptId:'at-hunter',obligationId:`hunt:packet:${government}`,missionPart:null,finding:{index:0,subjectId:body,subjectHint:'Example',field:'GOV-03',value:MEMBERS,sourceUrl:'https://example.gov/',exactQuote:MEMBERS,artifactIds:['a-home']}},now);
   const publish=()=>publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
+  // Intake hands the link to the walk; the publisher spends no turn on it.
   const handed=await publish();
-  assert.equal(handed.handed,1,'the link is handed to the walk, not parked or published');
+  assert.deepEqual([handed.looked,handed.handed,handed.published],[0,0,0],'the link is handed to the walk at intake, not parked or published');
   assert.deepEqual((await repos.boxFindings.mustRead(link.id)).value.waitingFor?.reason,'SITE_WALK_TAKES_IT');
   const run=placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:government,bodyId:body,name:'City of Example',state:'AL',website:'https://example.gov/'},query:facts.query,now:()=>now,readHeldPage:async()=>null,spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const text=pages[url];assert.ok(text,'unexpected source '+url);return {status:200,body:text,bytes:Buffer.byteLength(text),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}});
   const outcome=await run(job);
```
