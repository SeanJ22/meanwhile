# Photo report — every shipped photo, its source, and the judgment

The 2b rule (tightened 2026-08-19): **a clean solo portrait or honest
initials — never a screengrab, banner, logo crop, or a photo where the
person is not the unambiguous sole subject.** This report exists so a
human can verify every photo the product ships without hunting through
data files: each row names the person, the file or URL served, where it
came from, and why it passed. A photo not listed here does not ship —
`tests/candidate-cards.test.ts` asserts every shipped photo URL appears
in this file.

Judged 2026-08-19 by eyeballing every image as fetched by a plain client
(the session's 2b audit). The audit covered all 17 candidate cards and
all 8 roster officials; 6 card photos failed the rule and fell back to
initials — their misses are recorded hunts in
`data/ballot/candidate-cards-2026.json` (`hunts`, `#photo` entries),
each with every rung attempted.

## Official portraits — the manifest, `lib/registry/official-photos.json`

Generated from the manifest by `scripts/photo-census.mts` — the table
cannot drift from what ships. All images are served from our origin
(`public/officials/`), metadata-stripped before commit
(`scripts/strip-image-metadata.mts`), and matched by stable id (bioguide
for Congress), never by name search.

443 shipped portraits:

| Person | Served file | Source URL | License |
|---|---|---|---|
| Robert B. Aderholt | /officials/A000055.jpg | https://unitedstates.github.io/images/congress/450x550/A000055.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jake Auchincloss | /officials/A000148.jpg | https://unitedstates.github.io/images/congress/450x550/A000148.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark E. Amodei | /officials/A000369.jpg | https://unitedstates.github.io/images/congress/450x550/A000369.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Alma S. Adams | /officials/A000370.jpg | https://unitedstates.github.io/images/congress/450x550/A000370.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pete Aguilar | /officials/A000371.jpg | https://unitedstates.github.io/images/congress/450x550/A000371.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Rick W. Allen | /officials/A000372.jpg | https://unitedstates.github.io/images/congress/450x550/A000372.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jodey C. Arrington | /officials/A000375.jpg | https://unitedstates.github.io/images/congress/450x550/A000375.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark Alford | /officials/A000379.jpg | https://unitedstates.github.io/images/congress/450x550/A000379.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gabe Amo | /officials/A000380.jpg | https://unitedstates.github.io/images/congress/450x550/A000380.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Yassamin Ansari | /officials/A000381.jpg | https://unitedstates.github.io/images/congress/450x550/A000381.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sanford D. Bishop, Jr. | /officials/B000490.jpg | https://unitedstates.github.io/images/congress/450x550/B000490.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Cliff Bentz | /officials/B000668.jpg | https://unitedstates.github.io/images/congress/450x550/B000668.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Stephanie I. Bice | /officials/B000740.jpg | https://unitedstates.github.io/images/congress/450x550/B000740.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lauren Boebert | /officials/B000825.jpg | https://unitedstates.github.io/images/congress/450x550/B000825.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gus M. Bilirakis | /officials/B001257.jpg | https://unitedstates.github.io/images/congress/450x550/B001257.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Vern Buchanan | /officials/B001260.jpg | https://unitedstates.github.io/images/congress/450x550/B001260.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Suzanne Bonamici | /officials/B001278.jpg | https://unitedstates.github.io/images/congress/450x550/B001278.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joyce Beatty | /officials/B001281.jpg | https://unitedstates.github.io/images/congress/450x550/B001281.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andy Barr | /officials/B001282.jpg | https://unitedstates.github.io/images/congress/450x550/B001282.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Julia Brownley | /officials/B001285.jpg | https://unitedstates.github.io/images/congress/450x550/B001285.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ami Bera | /officials/B001287.jpg | https://unitedstates.github.io/images/congress/450x550/B001287.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Cory A. Booker | /officials/B001288.jpg | https://unitedstates.github.io/images/congress/450x550/B001288.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brian Babin | /officials/B001291.jpg | https://unitedstates.github.io/images/congress/450x550/B001291.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Donald S. Beyer, Jr. | /officials/B001292.jpg | https://unitedstates.github.io/images/congress/450x550/B001292.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Bost | /officials/B001295.jpg | https://unitedstates.github.io/images/congress/450x550/B001295.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brendan F. Boyle | /officials/B001296.jpg | https://unitedstates.github.io/images/congress/450x550/B001296.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Don Bacon | /officials/B001298.jpg | https://unitedstates.github.io/images/congress/450x550/B001298.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nanette Diaz Barragán | /officials/B001300.jpg | https://unitedstates.github.io/images/congress/450x550/B001300.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jack Bergman | /officials/B001301.jpg | https://unitedstates.github.io/images/congress/450x550/B001301.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andy Biggs | /officials/B001302.jpg | https://unitedstates.github.io/images/congress/450x550/B001302.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Troy Balderson | /officials/B001306.jpg | https://unitedstates.github.io/images/congress/450x550/B001306.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James R. Baird | /officials/B001307.jpg | https://unitedstates.github.io/images/congress/450x550/B001307.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tim Burchett | /officials/B001309.jpg | https://unitedstates.github.io/images/congress/450x550/B001309.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Shontel M. Brown | /officials/B001313.jpg | https://unitedstates.github.io/images/congress/450x550/B001313.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Aaron Bean | /officials/B001314.jpg | https://unitedstates.github.io/images/congress/450x550/B001314.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nikki Budzinski | /officials/B001315.jpg | https://unitedstates.github.io/images/congress/450x550/B001315.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Eric Burlison | /officials/B001316.jpg | https://unitedstates.github.io/images/congress/450x550/B001316.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Josh Brecheen | /officials/B001317.jpg | https://unitedstates.github.io/images/congress/450x550/B001317.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Becca Balint | /officials/B001318.jpg | https://unitedstates.github.io/images/congress/450x550/B001318.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tom Barrett | /officials/B001321.jpg | https://commons.wikimedia.org/wiki/File%3ARep.%20Tom%20Barrett%20official%20photo%2C%20119th%20Congress%20(cropped).jpg | Public domain — House Creative Services (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Tom%20Barrett%20official%20photo%2C%20119th%20Congress%20(cropped).jpg) |
| Michael Baumgartner | /officials/B001322.jpg | https://unitedstates.github.io/images/congress/450x550/B001322.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nicholas J. Begich III | /officials/B001323.jpg | https://commons.wikimedia.org/wiki/File%3ANick%20Begich%20III.jpg | Public domain — House Creative Services (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ANick%20Begich%20III.jpg) |
| Wesley Bell | /officials/B001324.jpg | https://commons.wikimedia.org/wiki/File%3ARep.%20Wesley%20Bell%20Official%20Portrait.jpg | Public domain — Ike Hayman, House Creative Services (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Wesley%20Bell%20Official%20Portrait.jpg) |
| Sheri Biggs | /officials/B001325.jpg | https://unitedstates.github.io/images/congress/450x550/B001325.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Janelle S. Bynum | /officials/B001326.jpg | https://unitedstates.github.io/images/congress/450x550/B001326.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert P. Bresnahan, Jr. | /officials/B001327.jpg | https://unitedstates.github.io/images/congress/450x550/B001327.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ken Calvert | /officials/C000059.jpg | https://unitedstates.github.io/images/congress/450x550/C000059.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James E. Clyburn | /officials/C000537.jpg | https://unitedstates.github.io/images/congress/450x550/C000537.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kat Cammack | /officials/C001039.jpg | https://unitedstates.github.io/images/congress/450x550/C001039.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John R. Carter | /officials/C001051.jpg | https://unitedstates.github.io/images/congress/450x550/C001051.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tom Cole | /officials/C001053.jpg | https://unitedstates.github.io/images/congress/450x550/C001053.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ed Case | /officials/C001055.jpg | https://unitedstates.github.io/images/congress/450x550/C001055.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jim Costa | /officials/C001059.jpg | https://unitedstates.github.io/images/congress/450x550/C001059.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Emanuel Cleaver | /officials/C001061.jpg | https://unitedstates.github.io/images/congress/450x550/C001061.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Henry Cuellar | /officials/C001063.jpg | https://unitedstates.github.io/images/congress/450x550/C001063.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kathy Castor | /officials/C001066.jpg | https://unitedstates.github.io/images/congress/450x550/C001066.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Yvette D. Clarke | /officials/C001067.jpg | https://unitedstates.github.io/images/congress/450x550/C001067.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Steve Cohen | /officials/C001068.jpg | https://unitedstates.github.io/images/congress/450x550/C001068.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joe Courtney | /officials/C001069.jpg | https://unitedstates.github.io/images/congress/450x550/C001069.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| André Carson | /officials/C001072.jpg | https://unitedstates.github.io/images/congress/450x550/C001072.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Judy Chu | /officials/C001080.jpg | https://unitedstates.github.io/images/congress/450x550/C001080.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Eric A. "Rick" Crawford | /officials/C001087.jpg | https://unitedstates.github.io/images/congress/450x550/C001087.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joaquin Castro | /officials/C001091.jpg | https://unitedstates.github.io/images/congress/450x550/C001091.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Katherine M. Clark | /officials/C001101.jpg | https://unitedstates.github.io/images/congress/450x550/C001101.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Earl L. "Buddy" Carter | /officials/C001103.jpg | https://unitedstates.github.io/images/congress/450x550/C001103.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James Comer | /officials/C001108.jpg | https://unitedstates.github.io/images/congress/450x550/C001108.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| J. Luis Correa | /officials/C001110.jpg | https://unitedstates.github.io/images/congress/450x550/C001110.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Salud O. Carbajal | /officials/C001112.jpg | https://unitedstates.github.io/images/congress/450x550/C001112.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael Cloud | /officials/C001115.jpg | https://unitedstates.github.io/images/congress/450x550/C001115.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andrew S. Clyde | /officials/C001116.jpg | https://unitedstates.github.io/images/congress/450x550/C001116.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sean Casten | /officials/C001117.jpg | https://unitedstates.github.io/images/congress/450x550/C001117.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ben Cline | /officials/C001118.jpg | https://unitedstates.github.io/images/congress/450x550/C001118.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Angie Craig | /officials/C001119.jpg | https://unitedstates.github.io/images/congress/450x550/C001119.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dan Crenshaw | /officials/C001120.jpg | https://unitedstates.github.io/images/congress/450x550/C001120.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jason Crow | /officials/C001121.jpg | https://unitedstates.github.io/images/congress/450x550/C001121.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gilbert Ray Cisneros, Jr. | /officials/C001123.jpg | https://unitedstates.github.io/images/congress/450x550/C001123.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Troy A. Carter | /officials/C001125.jpg | https://unitedstates.github.io/images/congress/450x550/C001125.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Carey | /officials/C001126.jpg | https://unitedstates.github.io/images/congress/450x550/C001126.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Collins | /officials/C001129.jpg | https://unitedstates.github.io/images/congress/450x550/C001129.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jasmine Crockett | /officials/C001130.jpg | https://unitedstates.github.io/images/congress/450x550/C001130.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Greg Casar | /officials/C001131.jpg | https://unitedstates.github.io/images/congress/450x550/C001131.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Elijah Crane | /officials/C001132.jpg | https://unitedstates.github.io/images/congress/450x550/C001132.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Juan Ciscomani | /officials/C001133.jpg | https://unitedstates.github.io/images/congress/450x550/C001133.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Herbert C. Conaway, Jr. | /officials/C001136.jpg | https://unitedstates.github.io/images/congress/450x550/C001136.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jeff Crank | /officials/C001137.jpg | https://unitedstates.github.io/images/congress/450x550/C001137.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Byron Donalds | /officials/D000032.jpg | https://unitedstates.github.io/images/congress/450x550/D000032.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Danny K. Davis | /officials/D000096.jpg | https://unitedstates.github.io/images/congress/450x550/D000096.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Diana DeGette | /officials/D000197.jpg | https://unitedstates.github.io/images/congress/450x550/D000197.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Rosa L. DeLauro | /officials/D000216.jpg | https://unitedstates.github.io/images/congress/450x550/D000216.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Donald G. Davis | /officials/D000230.jpg | https://unitedstates.github.io/images/congress/450x550/D000230.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lloyd Doggett | /officials/D000399.jpg | https://unitedstates.github.io/images/congress/450x550/D000399.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Christopher R. Deluzio | /officials/D000530.jpg | https://unitedstates.github.io/images/congress/450x550/D000530.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Monica De La Cruz | /officials/D000594.jpg | https://unitedstates.github.io/images/congress/450x550/D000594.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mario Diaz-Balart | /officials/D000600.jpg | https://unitedstates.github.io/images/congress/450x550/D000600.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Scott DesJarlais | /officials/D000616.jpg | https://unitedstates.github.io/images/congress/450x550/D000616.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Suzan K. DelBene | /officials/D000617.jpg | https://unitedstates.github.io/images/congress/450x550/D000617.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark DeSaulnier | /officials/D000623.jpg | https://unitedstates.github.io/images/congress/450x550/D000623.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Debbie Dingell | /officials/D000624.jpg | https://unitedstates.github.io/images/congress/450x550/D000624.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Warren Davidson | /officials/D000626.jpg | https://unitedstates.github.io/images/congress/450x550/D000626.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Neal P. Dunn | /officials/D000628.jpg | https://unitedstates.github.io/images/congress/450x550/D000628.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sharice Davids | /officials/D000629.jpg | https://unitedstates.github.io/images/congress/450x550/D000629.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Madeleine Dean | /officials/D000631.jpg | https://unitedstates.github.io/images/congress/450x550/D000631.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Troy Downing | /officials/D000634.jpg | https://unitedstates.github.io/images/congress/450x550/D000634.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Maxine Dexter | /officials/D000635.jpg | https://unitedstates.github.io/images/congress/450x550/D000635.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jake Ellzey | /officials/E000071.jpg | https://unitedstates.github.io/images/congress/450x550/E000071.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Ezell | /officials/E000235.jpg | https://unitedstates.github.io/images/congress/450x550/E000235.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Chuck Edwards | /officials/E000246.jpg | https://unitedstates.github.io/images/congress/450x550/E000246.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tom Emmer | /officials/E000294.jpg | https://unitedstates.github.io/images/congress/450x550/E000294.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dwight Evans | /officials/E000296.jpg | https://unitedstates.github.io/images/congress/450x550/E000296.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Adriano Espaillat | /officials/E000297.jpg | https://unitedstates.github.io/images/congress/450x550/E000297.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ron Estes | /officials/E000298.jpg | https://unitedstates.github.io/images/congress/450x550/E000298.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Veronica Escobar | /officials/E000299.jpg | https://unitedstates.github.io/images/congress/450x550/E000299.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gabe Evans | /officials/E000300.jpg | https://unitedstates.github.io/images/congress/450x550/E000300.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sarah Elfreth | /officials/E000301.jpg | https://unitedstates.github.io/images/congress/450x550/E000301.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Cleo Fields | /officials/F000110.jpg | https://unitedstates.github.io/images/congress/450x550/F000110.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pat Fallon | /officials/F000246.jpg | https://unitedstates.github.io/images/congress/450x550/F000246.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Randy Feenstra | /officials/F000446.jpg | https://unitedstates.github.io/images/congress/450x550/F000446.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Virginia Foxx | /officials/F000450.jpg | https://unitedstates.github.io/images/congress/450x550/F000450.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bill Foster | /officials/F000454.jpg | https://unitedstates.github.io/images/congress/450x550/F000454.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Charles J. "Chuck" Fleischmann | /officials/F000459.jpg | https://unitedstates.github.io/images/congress/450x550/F000459.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lois Frankel | /officials/F000462.jpg | https://unitedstates.github.io/images/congress/450x550/F000462.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brian K. Fitzpatrick | /officials/F000466.jpg | https://unitedstates.github.io/images/congress/450x550/F000466.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lizzie Fletcher | /officials/F000468.jpg | https://unitedstates.github.io/images/congress/450x550/F000468.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Russ Fulcher | /officials/F000469.jpg | https://unitedstates.github.io/images/congress/450x550/F000469.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michelle Fischbach | /officials/F000470.jpg | https://unitedstates.github.io/images/congress/450x550/F000470.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Scott Fitzgerald | /officials/F000471.jpg | https://unitedstates.github.io/images/congress/450x550/F000471.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Scott Franklin | /officials/F000472.jpg | https://unitedstates.github.io/images/congress/450x550/F000472.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Flood | /officials/F000474.jpg | https://unitedstates.github.io/images/congress/450x550/F000474.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brad Finstad | /officials/F000475.jpg | https://unitedstates.github.io/images/congress/450x550/F000475.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Maxwell Frost | /officials/F000476.jpg | https://unitedstates.github.io/images/congress/450x550/F000476.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Valerie P. Foushee | /officials/F000477.jpg | https://unitedstates.github.io/images/congress/450x550/F000477.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Russell Fry | /officials/F000478.jpg | https://unitedstates.github.io/images/congress/450x550/F000478.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Vince Fong | /officials/F000480.jpg | https://unitedstates.github.io/images/congress/450x550/F000480.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Shomari Figures | /officials/F000481.jpg | https://unitedstates.github.io/images/congress/450x550/F000481.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Julie Fedorchak | /officials/F000482.jpg | https://unitedstates.github.io/images/congress/450x550/F000482.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Laura Friedman | /officials/F000483.jpg | https://unitedstates.github.io/images/congress/450x550/F000483.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Randy Fine | /officials/F000484.jpg | https://unitedstates.github.io/images/congress/450x550/F000484.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Clay Fuller | /officials/F000485.jpg | https://commons.wikimedia.org/wiki/File%3AClay%20Fuller%20official%20congressional%20photograph%20119th%20congress.jpg | Public domain — Unknown authorUnknown author (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AClay%20Fuller%20official%20congressional%20photograph%20119th%20congress.jpg) |
| Sam Graves | /officials/G000546.jpg | https://unitedstates.github.io/images/congress/450x550/G000546.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Al Green | /officials/G000553.jpg | https://unitedstates.github.io/images/congress/450x550/G000553.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brett Guthrie | /officials/G000558.jpg | https://unitedstates.github.io/images/congress/450x550/G000558.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John Garamendi | /officials/G000559.jpg | https://unitedstates.github.io/images/congress/450x550/G000559.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Paul A. Gosar | /officials/G000565.jpg | https://unitedstates.github.io/images/congress/450x550/G000565.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| H. Morgan Griffith | /officials/G000568.jpg | https://unitedstates.github.io/images/congress/450x550/G000568.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ruben Gallego | /officials/G000574.jpg | https://unitedstates.github.io/images/congress/450x550/G000574.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Glenn Grothman | /officials/G000576.jpg | https://unitedstates.github.io/images/congress/450x550/G000576.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Vicente Gonzalez | /officials/G000581.jpg | https://unitedstates.github.io/images/congress/450x550/G000581.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Josh Gottheimer | /officials/G000583.jpg | https://unitedstates.github.io/images/congress/450x550/G000583.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jimmy Gomez | /officials/G000585.jpg | https://unitedstates.github.io/images/congress/450x550/G000585.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jesús G. "Chuy" García | /officials/G000586.jpg | https://unitedstates.github.io/images/congress/450x550/G000586.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sylvia R. Garcia | /officials/G000587.jpg | https://unitedstates.github.io/images/congress/450x550/G000587.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lance Gooden | /officials/G000589.jpg | https://unitedstates.github.io/images/congress/450x550/G000589.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael Guest | /officials/G000591.jpg | https://unitedstates.github.io/images/congress/450x550/G000591.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jared F. Golden | /officials/G000592.jpg | https://unitedstates.github.io/images/congress/450x550/G000592.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Carlos A. Gimenez | /officials/G000593.jpg | https://unitedstates.github.io/images/congress/450x550/G000593.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andrew R. Garbarino | /officials/G000597.jpg | https://unitedstates.github.io/images/congress/450x550/G000597.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert Garcia | /officials/G000598.jpg | https://unitedstates.github.io/images/congress/450x550/G000598.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Daniel S. Goldman | /officials/G000599.jpg | https://unitedstates.github.io/images/congress/450x550/G000599.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Marie Gluesenkamp Perez | /officials/G000600.jpg | https://unitedstates.github.io/images/congress/450x550/G000600.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Craig A. Goldman | /officials/G000601.jpg | https://unitedstates.github.io/images/congress/450x550/G000601.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Laura Gillen | /officials/G000602.jpg | https://unitedstates.github.io/images/congress/450x550/G000602.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brandon Gill | /officials/G000603.jpg | https://unitedstates.github.io/images/congress/450x550/G000603.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Maggie Goodlander | /officials/G000604.jpg | https://unitedstates.github.io/images/congress/450x550/G000604.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Adam Gray | /officials/G000605.jpg | https://unitedstates.github.io/images/congress/450x550/G000605.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Adelita S. Grijalva | /officials/G000606.jpg | https://commons.wikimedia.org/wiki/File%3ARep.%20Adelita%20Grijalva%20Official%20Portrait.jpg | Public domain — Damien Salas, Office of the Clerk U.S.House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Adelita%20Grijalva%20Official%20Portrait.jpg) |
| James Gallagher | /officials/G000607.jpg | https://commons.wikimedia.org/wiki/File%3AJames%20Gallagher%2C%20official%20portrait%20(119th%20Congress).jpg | Public domain — U.S. House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AJames%20Gallagher%2C%20official%20portrait%20(119th%20Congress).jpg) |
| Steny H. Hoyer | /officials/H000874.jpg | https://unitedstates.github.io/images/congress/450x550/H000874.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James A. Himes | /officials/H001047.jpg | https://unitedstates.github.io/images/congress/450x550/H001047.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andy Harris | /officials/H001052.jpg | https://unitedstates.github.io/images/congress/450x550/H001052.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bill Huizenga | /officials/H001058.jpg | https://unitedstates.github.io/images/congress/450x550/H001058.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Steven Horsford | /officials/H001066.jpg | https://unitedstates.github.io/images/congress/450x550/H001066.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Richard Hudson | /officials/H001067.jpg | https://unitedstates.github.io/images/congress/450x550/H001067.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jared Huffman | /officials/H001068.jpg | https://unitedstates.github.io/images/congress/450x550/H001068.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| J. French Hill | /officials/H001072.jpg | https://unitedstates.github.io/images/congress/450x550/H001072.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Margaret Wood Hassan | /officials/H001076.jpg | https://unitedstates.github.io/images/congress/450x550/H001076.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Clay Higgins | /officials/H001077.jpg | https://unitedstates.github.io/images/congress/450x550/H001077.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jahana Hayes | /officials/H001081.jpg | https://unitedstates.github.io/images/congress/450x550/H001081.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kevin Hern | /officials/H001082.jpg | https://unitedstates.github.io/images/congress/450x550/H001082.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Chrissy Houlahan | /officials/H001085.jpg | https://unitedstates.github.io/images/congress/450x550/H001085.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Diana Harshbarger | /officials/H001086.jpg | https://unitedstates.github.io/images/congress/450x550/H001086.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Josh Harder | /officials/H001090.jpg | https://unitedstates.github.io/images/congress/450x550/H001090.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ashley Hinson | /officials/H001091.jpg | https://unitedstates.github.io/images/congress/450x550/H001091.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Erin Houchin | /officials/H001093.jpg | https://unitedstates.github.io/images/congress/450x550/H001093.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Val T. Hoyle | /officials/H001094.jpg | https://unitedstates.github.io/images/congress/450x550/H001094.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Wesley Hunt | /officials/H001095.jpg | https://unitedstates.github.io/images/congress/450x550/H001095.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Harriet M. Hageman | /officials/H001096.jpg | https://unitedstates.github.io/images/congress/450x550/H001096.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Abraham J. Hamadeh | /officials/H001098.jpg | https://unitedstates.github.io/images/congress/450x550/H001098.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Haridopolos | /officials/H001099.jpg | https://unitedstates.github.io/images/congress/450x550/H001099.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jeff Hurd | /officials/H001100.jpg | https://unitedstates.github.io/images/congress/450x550/H001100.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pat Harrigan | /officials/H001101.jpg | https://unitedstates.github.io/images/congress/450x550/H001101.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark Harris | /officials/H001102.jpg | https://unitedstates.github.io/images/congress/450x550/H001102.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Darrell Issa | /officials/I000056.jpg | https://unitedstates.github.io/images/congress/450x550/I000056.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Glenn Ivey | /officials/I000058.jpg | https://unitedstates.github.io/images/congress/450x550/I000058.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Henry C. "Hank" Johnson, Jr. | /officials/J000288.jpg | https://unitedstates.github.io/images/congress/450x550/J000288.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jim Jordan | /officials/J000289.jpg | https://unitedstates.github.io/images/congress/450x550/J000289.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Hakeem S. Jeffries | /officials/J000294.jpg | https://unitedstates.github.io/images/congress/450x550/J000294.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David P. Joyce | /officials/J000295.jpg | https://unitedstates.github.io/images/congress/450x550/J000295.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pramila Jayapal | /officials/J000298.jpg | https://unitedstates.github.io/images/congress/450x550/J000298.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Johnson | /officials/J000299.jpg | https://unitedstates.github.io/images/congress/450x550/J000299.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dusty Johnson | /officials/J000301.jpg | https://unitedstates.github.io/images/congress/450x550/J000301.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John Joyce | /officials/J000302.jpg | https://unitedstates.github.io/images/congress/450x550/J000302.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ronny Jackson | /officials/J000304.jpg | https://unitedstates.github.io/images/congress/450x550/J000304.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sara Jacobs | /officials/J000305.jpg | https://unitedstates.github.io/images/congress/450x550/J000305.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John James | /officials/J000307.jpg | https://unitedstates.github.io/images/congress/450x550/J000307.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jonathan L. Jackson | /officials/J000309.jpg | https://unitedstates.github.io/images/congress/450x550/J000309.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Julie Johnson | /officials/J000310.jpg | https://unitedstates.github.io/images/congress/450x550/J000310.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brian Jack | /officials/J000311.jpg | https://unitedstates.github.io/images/congress/450x550/J000311.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Marcy Kaptur | /officials/K000009.jpg | https://unitedstates.github.io/images/congress/450x550/K000009.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| William R. Keating | /officials/K000375.jpg | https://unitedstates.github.io/images/congress/450x550/K000375.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Kelly | /officials/K000376.jpg | https://unitedstates.github.io/images/congress/450x550/K000376.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark Kelly | /officials/K000377.jpg | https://unitedstates.github.io/images/congress/450x550/K000377.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robin L. Kelly | /officials/K000385.jpg | https://unitedstates.github.io/images/congress/450x550/K000385.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Trent Kelly | /officials/K000388.jpg | https://unitedstates.github.io/images/congress/450x550/K000388.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ro Khanna | /officials/K000389.jpg | https://unitedstates.github.io/images/congress/450x550/K000389.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Raja Krishnamoorthi | /officials/K000391.jpg | https://unitedstates.github.io/images/congress/450x550/K000391.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David Kustoff | /officials/K000392.jpg | https://unitedstates.github.io/images/congress/450x550/K000392.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andy Kim | /officials/K000394.jpg | https://unitedstates.github.io/images/congress/450x550/K000394.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Young Kim | /officials/K000397.jpg | https://unitedstates.github.io/images/congress/450x550/K000397.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Thomas H. Kean, Jr. | /officials/K000398.jpg | https://unitedstates.github.io/images/congress/450x550/K000398.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jennifer A. Kiggans | /officials/K000399.jpg | https://unitedstates.github.io/images/congress/450x550/K000399.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sydney Kamlager-Dove | /officials/K000400.jpg | https://unitedstates.github.io/images/congress/450x550/K000400.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kevin Kiley | /officials/K000401.jpg | https://unitedstates.github.io/images/congress/450x550/K000401.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Timothy M. Kennedy | /officials/K000402.jpg | https://unitedstates.github.io/images/congress/450x550/K000402.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Kennedy | /officials/K000403.jpg | https://unitedstates.github.io/images/congress/450x550/K000403.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brad Knott | /officials/K000405.jpg | https://unitedstates.github.io/images/congress/450x550/K000405.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Teresa Leger Fernandez | /officials/L000273.jpg | https://unitedstates.github.io/images/congress/450x550/L000273.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Zoe Lofgren | /officials/L000397.jpg | https://unitedstates.github.io/images/congress/450x550/L000397.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Frank D. Lucas | /officials/L000491.jpg | https://unitedstates.github.io/images/congress/450x550/L000491.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John B. Larson | /officials/L000557.jpg | https://unitedstates.github.io/images/congress/450x550/L000557.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Rick Larsen | /officials/L000560.jpg | https://unitedstates.github.io/images/congress/450x550/L000560.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Stephen F. Lynch | /officials/L000562.jpg | https://unitedstates.github.io/images/congress/450x550/L000562.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert E. Latta | /officials/L000566.jpg | https://unitedstates.github.io/images/congress/450x550/L000566.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ted Lieu | /officials/L000582.jpg | https://unitedstates.github.io/images/congress/450x550/L000582.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Barry Loudermilk | /officials/L000583.jpg | https://unitedstates.github.io/images/congress/450x550/L000583.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Darin LaHood | /officials/L000585.jpg | https://unitedstates.github.io/images/congress/450x550/L000585.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Susie Lee | /officials/L000590.jpg | https://unitedstates.github.io/images/congress/450x550/L000590.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Levin | /officials/L000593.jpg | https://unitedstates.github.io/images/congress/450x550/L000593.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Julia Letlow | /officials/L000595.jpg | https://unitedstates.github.io/images/congress/450x550/L000595.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Anna Paulina Luna | /officials/L000596.jpg | https://unitedstates.github.io/images/congress/450x550/L000596.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Laurel M. Lee | /officials/L000597.jpg | https://unitedstates.github.io/images/congress/450x550/L000597.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nick LaLota | /officials/L000598.jpg | https://unitedstates.github.io/images/congress/450x550/L000598.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael Lawler | /officials/L000599.jpg | https://unitedstates.github.io/images/congress/450x550/L000599.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nicholas A. Langworthy | /officials/L000600.jpg | https://unitedstates.github.io/images/congress/450x550/L000600.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Greg Landsman | /officials/L000601.jpg | https://unitedstates.github.io/images/congress/450x550/L000601.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Summer L. Lee | /officials/L000602.jpg | https://unitedstates.github.io/images/congress/450x550/L000602.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Morgan Luttrell | /officials/L000603.jpg | https://unitedstates.github.io/images/congress/450x550/L000603.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| George Latimer | /officials/L000606.jpg | https://unitedstates.github.io/images/congress/450x550/L000606.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sam T. Liccardo | /officials/L000607.jpg | https://unitedstates.github.io/images/congress/450x550/L000607.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nancy Mace | /officials/M000194.jpg | https://unitedstates.github.io/images/congress/450x550/M000194.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James P. McGovern | /officials/M000312.jpg | https://unitedstates.github.io/images/congress/450x550/M000312.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nicole Malliotakis | /officials/M000317.jpg | https://unitedstates.github.io/images/congress/450x550/M000317.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kweisi Mfume | /officials/M000687.jpg | https://unitedstates.github.io/images/congress/450x550/M000687.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tracey Mann | /officials/M000871.jpg | https://unitedstates.github.io/images/congress/450x550/M000871.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lisa C. McClain | /officials/M001136.jpg | https://unitedstates.github.io/images/congress/450x550/M001136.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gregory W. Meeks | /officials/M001137.jpg | https://unitedstates.github.io/images/congress/450x550/M001137.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Betty McCollum | /officials/M001143.jpg | https://unitedstates.github.io/images/congress/450x550/M001143.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael T. McCaul | /officials/M001157.jpg | https://unitedstates.github.io/images/congress/450x550/M001157.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gwen Moore | /officials/M001160.jpg | https://unitedstates.github.io/images/congress/450x550/M001160.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Doris O. Matsui | /officials/M001163.jpg | https://unitedstates.github.io/images/congress/450x550/M001163.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tom McClintock | /officials/M001177.jpg | https://unitedstates.github.io/images/congress/450x550/M001177.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Thomas Massie | /officials/M001184.jpg | https://unitedstates.github.io/images/congress/450x550/M001184.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Grace Meng | /officials/M001188.jpg | https://unitedstates.github.io/images/congress/450x550/M001188.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John R. Moolenaar | /officials/M001194.jpg | https://unitedstates.github.io/images/congress/450x550/M001194.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Seth Moulton | /officials/M001196.jpg | https://unitedstates.github.io/images/congress/450x550/M001196.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brian J. Mast | /officials/M001199.jpg | https://unitedstates.github.io/images/congress/450x550/M001199.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Daniel Meuser | /officials/M001204.jpg | https://unitedstates.github.io/images/congress/450x550/M001204.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Carol D. Miller | /officials/M001205.jpg | https://unitedstates.github.io/images/congress/450x550/M001205.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joseph D. Morelle | /officials/M001206.jpg | https://unitedstates.github.io/images/congress/450x550/M001206.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lucy McBath | /officials/M001208.jpg | https://unitedstates.github.io/images/congress/450x550/M001208.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gregory F. Murphy | /officials/M001210.jpg | https://unitedstates.github.io/images/congress/450x550/M001210.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mary E. Miller | /officials/M001211.jpg | https://unitedstates.github.io/images/congress/450x550/M001211.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Barry Moore | /officials/M001212.jpg | https://unitedstates.github.io/images/congress/450x550/M001212.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Blake D. Moore | /officials/M001213.jpg | https://unitedstates.github.io/images/congress/450x550/M001213.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Frank J. Mrvan | /officials/M001214.jpg | https://unitedstates.github.io/images/congress/450x550/M001214.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mariannette Miller-Meeks | /officials/M001215.jpg | https://unitedstates.github.io/images/congress/450x550/M001215.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Cory Mills | /officials/M001216.jpg | https://unitedstates.github.io/images/congress/450x550/M001216.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jared Moskowitz | /officials/M001217.jpg | https://unitedstates.github.io/images/congress/450x550/M001217.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Richard McCormick | /officials/M001218.jpg | https://unitedstates.github.io/images/congress/450x550/M001218.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Morgan McGarvey | /officials/M001220.jpg | https://unitedstates.github.io/images/congress/450x550/M001220.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Max L. Miller | /officials/M001222.jpg | https://unitedstates.github.io/images/congress/450x550/M001222.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Seth Magaziner | /officials/M001223.jpg | https://unitedstates.github.io/images/congress/450x550/M001223.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nathaniel Moran | /officials/M001224.jpg | https://unitedstates.github.io/images/congress/450x550/M001224.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kevin Mullin | /officials/M001225.jpg | https://unitedstates.github.io/images/congress/450x550/M001225.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert Menendez | /officials/M001226.jpg | https://unitedstates.github.io/images/congress/450x550/M001226.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jennifer L. McClellan | /officials/M001227.jpg | https://unitedstates.github.io/images/congress/450x550/M001227.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Celeste Maloy | /officials/M001228.jpg | https://unitedstates.github.io/images/congress/450x550/M001228.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| LaMonica McIver | /officials/M001229.jpg | https://unitedstates.github.io/images/congress/450x550/M001229.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ryan Mackenzie | /officials/M001230.jpg | https://unitedstates.github.io/images/congress/450x550/M001230.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John W. Mannion | /officials/M001231.jpg | https://unitedstates.github.io/images/congress/450x550/M001231.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| April McClain Delaney | /officials/M001232.jpg | https://unitedstates.github.io/images/congress/450x550/M001232.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark B. Messmer | /officials/M001233.jpg | https://unitedstates.github.io/images/congress/450x550/M001233.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kelly Morrison | /officials/M001234.jpg | https://unitedstates.github.io/images/congress/450x550/M001234.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Riley M. Moore | /officials/M001235.jpg | https://unitedstates.github.io/images/congress/450x550/M001235.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tim Moore | /officials/M001236.jpg | https://unitedstates.github.io/images/congress/450x550/M001236.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kristen McDonald Rivet | /officials/M001237.jpg | https://unitedstates.github.io/images/congress/450x550/M001237.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Sarah McBride | /officials/M001238.jpg | https://unitedstates.github.io/images/congress/450x550/M001238.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John J. McGuire III | /officials/M001239.jpg | https://unitedstates.github.io/images/congress/450x550/M001239.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Addison P. McDowell | /officials/M001240.jpg | https://unitedstates.github.io/images/congress/450x550/M001240.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dave Min | /officials/M001241.jpg | https://unitedstates.github.io/images/congress/450x550/M001241.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Christian D. Menefee | /officials/M001245.jpg | https://commons.wikimedia.org/wiki/File%3AChristian%20Menefee%2C%20official%20portrait%20(119th%20Congress).jpg | Public domain — U.S. House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AChristian%20Menefee%2C%20official%20portrait%20(119th%20Congress).jpg) |
| Analilia Mejia | /officials/M001246.jpg | https://commons.wikimedia.org/wiki/File%3AAnalilia%20Mejia%2C%20official%20portrait%20(119th%20Congress).jpg | Public domain — U.S. House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AAnalilia%20Mejia%2C%20official%20portrait%20(119th%20Congress).jpg) |
| Jerrold Nadler | /officials/N000002.jpg | https://unitedstates.github.io/images/congress/450x550/N000002.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Richard E. Neal | /officials/N000015.jpg | https://unitedstates.github.io/images/congress/450x550/N000015.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Troy E. Nehls | /officials/N000026.jpg | https://unitedstates.github.io/images/congress/450x550/N000026.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Donald Norcross | /officials/N000188.jpg | https://unitedstates.github.io/images/congress/450x550/N000188.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dan Newhouse | /officials/N000189.jpg | https://unitedstates.github.io/images/congress/450x550/N000189.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ralph Norman | /officials/N000190.jpg | https://unitedstates.github.io/images/congress/450x550/N000190.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joe Neguse | /officials/N000191.jpg | https://unitedstates.github.io/images/congress/450x550/N000191.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Zachary Nunn | /officials/N000193.jpg | https://unitedstates.github.io/images/congress/450x550/N000193.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jay Obernolte | /officials/O000019.jpg | https://unitedstates.github.io/images/congress/450x550/O000019.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Burgess Owens | /officials/O000086.jpg | https://unitedstates.github.io/images/congress/450x550/O000086.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Alexandria Ocasio-Cortez | /officials/O000172.jpg | https://unitedstates.github.io/images/congress/450x550/O000172.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ilhan Omar | /officials/O000173.jpg | https://unitedstates.github.io/images/congress/450x550/O000173.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andrew Ogles | /officials/O000175.jpg | https://unitedstates.github.io/images/congress/450x550/O000175.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Johnny Olszewski, Jr. | /officials/O000176.jpg | https://unitedstates.github.io/images/congress/450x550/O000176.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert F. Onder, Jr. | /officials/O000177.jpg | https://unitedstates.github.io/images/congress/450x550/O000177.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Frank Pallone, Jr. | /officials/P000034.jpg | https://unitedstates.github.io/images/congress/450x550/P000034.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| August Pfluger | /officials/P000048.jpg | https://unitedstates.github.io/images/congress/450x550/P000048.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nancy Pelosi | /officials/P000197.jpg | https://unitedstates.github.io/images/congress/450x550/P000197.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Chellie Pingree | /officials/P000597.jpg | https://unitedstates.github.io/images/congress/450x550/P000597.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Scott Perry | /officials/P000605.jpg | https://unitedstates.github.io/images/congress/450x550/P000605.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark Pocan | /officials/P000607.jpg | https://unitedstates.github.io/images/congress/450x550/P000607.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Scott H. Peters | /officials/P000608.jpg | https://unitedstates.github.io/images/congress/450x550/P000608.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gary J. Palmer | /officials/P000609.jpg | https://unitedstates.github.io/images/congress/450x550/P000609.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jimmy Panetta | /officials/P000613.jpg | https://unitedstates.github.io/images/congress/450x550/P000613.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Chris Pappas | /officials/P000614.jpg | https://unitedstates.github.io/images/congress/450x550/P000614.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ayanna Pressley | /officials/P000617.jpg | https://unitedstates.github.io/images/congress/450x550/P000617.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brittany Pettersen | /officials/P000620.jpg | https://unitedstates.github.io/images/congress/450x550/P000620.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nellie Pou | /officials/P000621.jpg | https://unitedstates.github.io/images/congress/450x550/P000621.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jimmy Patronis | /officials/P000622.jpg | https://unitedstates.github.io/images/congress/450x550/P000622.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Quigley | /officials/Q000023.jpg | https://unitedstates.github.io/images/congress/450x550/Q000023.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Deborah K. Ross | /officials/R000305.jpg | https://unitedstates.github.io/images/congress/450x550/R000305.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Harold Rogers | /officials/R000395.jpg | https://unitedstates.github.io/images/congress/450x550/R000395.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Rogers | /officials/R000575.jpg | https://unitedstates.github.io/images/congress/450x550/R000575.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Patrick Ryan | /officials/R000579.jpg | https://unitedstates.github.io/images/congress/450x550/R000579.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Raul Ruiz | /officials/R000599.jpg | https://unitedstates.github.io/images/congress/450x550/R000599.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David Rouzer | /officials/R000603.jpg | https://unitedstates.github.io/images/congress/450x550/R000603.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jamie Raskin | /officials/R000606.jpg | https://unitedstates.github.io/images/congress/450x550/R000606.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John H. Rutherford | /officials/R000609.jpg | https://unitedstates.github.io/images/congress/450x550/R000609.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Guy Reschenthaler | /officials/R000610.jpg | https://unitedstates.github.io/images/congress/450x550/R000610.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| John W. Rose | /officials/R000612.jpg | https://unitedstates.github.io/images/congress/450x550/R000612.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Chip Roy | /officials/R000614.jpg | https://unitedstates.github.io/images/congress/450x550/R000614.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Delia C. Ramirez | /officials/R000617.jpg | https://unitedstates.github.io/images/congress/450x550/R000617.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael A. Rulli | /officials/R000619.jpg | https://unitedstates.github.io/images/congress/450x550/R000619.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Luz M. Rivas | /officials/R000620.jpg | https://unitedstates.github.io/images/congress/450x550/R000620.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Emily Randall | /officials/R000621.jpg | https://unitedstates.github.io/images/congress/450x550/R000621.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Josh Riley | /officials/R000622.jpg | https://unitedstates.github.io/images/congress/450x550/R000622.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Maria Elvira Salazar | /officials/S000168.jpg | https://unitedstates.github.io/images/congress/450x550/S000168.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert C. "Bobby" Scott | /officials/S000185.jpg | https://unitedstates.github.io/images/congress/450x550/S000185.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pete Sessions | /officials/S000250.jpg | https://unitedstates.github.io/images/congress/450x550/S000250.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Brad Sherman | /officials/S000344.jpg | https://unitedstates.github.io/images/congress/450x550/S000344.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Adam Smith | /officials/S000510.jpg | https://unitedstates.github.io/images/congress/450x550/S000510.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Christopher H. Smith | /officials/S000522.jpg | https://unitedstates.github.io/images/congress/450x550/S000522.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Victoria Spartz | /officials/S000929.jpg | https://unitedstates.github.io/images/congress/450x550/S000929.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Janice D. Schakowsky | /officials/S001145.jpg | https://unitedstates.github.io/images/congress/450x550/S001145.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael K. Simpson | /officials/S001148.jpg | https://unitedstates.github.io/images/congress/450x550/S001148.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Linda T. Sánchez | /officials/S001156.jpg | https://unitedstates.github.io/images/congress/450x550/S001156.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Marilyn Strickland | /officials/S001159.jpg | https://unitedstates.github.io/images/congress/450x550/S001159.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Adrian Smith | /officials/S001172.jpg | https://unitedstates.github.io/images/congress/450x550/S001172.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Steve Scalise | /officials/S001176.jpg | https://unitedstates.github.io/images/congress/450x550/S001176.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jeanne Shaheen | /officials/S001181.jpg | https://unitedstates.github.io/images/congress/450x550/S001181.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David Schweikert | /officials/S001183.jpg | https://unitedstates.github.io/images/congress/450x550/S001183.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Terri A. Sewell | /officials/S001185.jpg | https://unitedstates.github.io/images/congress/450x550/S001185.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Marlin A. Stutzman | /officials/S001188.jpg | https://unitedstates.github.io/images/congress/450x550/S001188.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Austin Scott | /officials/S001189.jpg | https://unitedstates.github.io/images/congress/450x550/S001189.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bradley Scott Schneider | /officials/S001190.jpg | https://unitedstates.github.io/images/congress/450x550/S001190.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jason Smith | /officials/S001195.jpg | https://unitedstates.github.io/images/congress/450x550/S001195.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Elise M. Stefanik | /officials/S001196.jpg | https://unitedstates.github.io/images/congress/450x550/S001196.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lloyd Smucker | /officials/S001199.jpg | https://unitedstates.github.io/images/congress/450x550/S001199.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Darren Soto | /officials/S001200.jpg | https://unitedstates.github.io/images/congress/450x550/S001200.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Thomas R. Suozzi | /officials/S001201.jpg | https://unitedstates.github.io/images/congress/450x550/S001201.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mary Gay Scanlon | /officials/S001205.jpg | https://unitedstates.github.io/images/congress/450x550/S001205.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Greg Stanton | /officials/S001211.jpg | https://unitedstates.github.io/images/congress/450x550/S001211.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Pete Stauber | /officials/S001212.jpg | https://unitedstates.github.io/images/congress/450x550/S001212.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bryan Steil | /officials/S001213.jpg | https://unitedstates.github.io/images/congress/450x550/S001213.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| W. Gregory Steube | /officials/S001214.jpg | https://unitedstates.github.io/images/congress/450x550/S001214.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Haley M. Stevens | /officials/S001215.jpg | https://unitedstates.github.io/images/congress/450x550/S001215.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Kim Schrier | /officials/S001216.jpg | https://unitedstates.github.io/images/congress/450x550/S001216.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Melanie A. Stansbury | /officials/S001218.jpg | https://unitedstates.github.io/images/congress/450x550/S001218.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dale W. Strong | /officials/S001220.jpg | https://unitedstates.github.io/images/congress/450x550/S001220.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Hillary J. Scholten | /officials/S001221.jpg | https://unitedstates.github.io/images/congress/450x550/S001221.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Emilia Strong Sykes | /officials/S001223.jpg | https://unitedstates.github.io/images/congress/450x550/S001223.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Keith Self | /officials/S001224.jpg | https://unitedstates.github.io/images/congress/450x550/S001224.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Eric Sorensen | /officials/S001225.jpg | https://unitedstates.github.io/images/congress/450x550/S001225.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andrea Salinas | /officials/S001226.jpg | https://unitedstates.github.io/images/congress/450x550/S001226.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Derek Schmidt | /officials/S001228.jpg | https://unitedstates.github.io/images/congress/450x550/S001228.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jefferson Shreve | /officials/S001229.jpg | https://unitedstates.github.io/images/congress/450x550/S001229.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Suhas Subramanyam | /officials/S001230.jpg | https://unitedstates.github.io/images/congress/450x550/S001230.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lateefah Simon | /officials/S001231.jpg | https://unitedstates.github.io/images/congress/450x550/S001231.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Thomas P. Tiffany | /officials/T000165.jpg | https://unitedstates.github.io/images/congress/450x550/T000165.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bennie G. Thompson | /officials/T000193.jpg | https://unitedstates.github.io/images/congress/450x550/T000193.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mike Thompson | /officials/T000460.jpg | https://unitedstates.github.io/images/congress/450x550/T000460.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Michael R. Turner | /officials/T000463.jpg | https://unitedstates.github.io/images/congress/450x550/T000463.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Glenn Thompson | /officials/T000467.jpg | https://unitedstates.github.io/images/congress/450x550/T000467.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Dina Titus | /officials/T000468.jpg | https://unitedstates.github.io/images/congress/450x550/T000468.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Paul Tonko | /officials/T000469.jpg | https://unitedstates.github.io/images/congress/450x550/T000469.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Mark Takano | /officials/T000472.jpg | https://unitedstates.github.io/images/congress/450x550/T000472.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Norma J. Torres | /officials/T000474.jpg | https://unitedstates.github.io/images/congress/450x550/T000474.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Claudia Tenney | /officials/T000478.jpg | https://unitedstates.github.io/images/congress/450x550/T000478.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| William R. Timmons IV | /officials/T000480.jpg | https://unitedstates.github.io/images/congress/450x550/T000480.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Rashida Tlaib | /officials/T000481.jpg | https://unitedstates.github.io/images/congress/450x550/T000481.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lori Trahan | /officials/T000482.jpg | https://unitedstates.github.io/images/congress/450x550/T000482.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ritchie Torres | /officials/T000486.jpg | https://unitedstates.github.io/images/congress/450x550/T000486.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jill N. Tokuda | /officials/T000487.jpg | https://unitedstates.github.io/images/congress/450x550/T000487.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Shri Thanedar | /officials/T000488.jpg | https://unitedstates.github.io/images/congress/450x550/T000488.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David J. Taylor | /officials/T000490.jpg | https://unitedstates.github.io/images/congress/450x550/T000490.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Derek Tran | /officials/T000491.jpg | https://unitedstates.github.io/images/congress/450x550/T000491.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Lauren Underwood | /officials/U000040.jpg | https://unitedstates.github.io/images/congress/450x550/U000040.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nydia M. Velázquez | /officials/V000081.jpg | https://unitedstates.github.io/images/congress/450x550/V000081.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| David G. Valadao | /officials/V000129.jpg | https://unitedstates.github.io/images/congress/450x550/V000129.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Juan Vargas | /officials/V000130.jpg | https://unitedstates.github.io/images/congress/450x550/V000130.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Marc A. Veasey | /officials/V000131.jpg | https://unitedstates.github.io/images/congress/450x550/V000131.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Jefferson Van Drew | /officials/V000133.jpg | https://unitedstates.github.io/images/congress/450x550/V000133.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Beth Van Duyne | /officials/V000134.jpg | https://unitedstates.github.io/images/congress/450x550/V000134.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Derrick Van Orden | /officials/V000135.jpg | https://unitedstates.github.io/images/congress/450x550/V000135.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Gabe Vasquez | /officials/V000136.jpg | https://unitedstates.github.io/images/congress/450x550/V000136.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Eugene Simon Vindman | /officials/V000138.jpg | https://unitedstates.github.io/images/congress/450x550/V000138.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Matt Van Epps | /officials/V000139.jpg | https://commons.wikimedia.org/wiki/File%3ARep.%20Matt%20Van%20Epps%20official%20portrait%2C%20119th%20Congress.jpg | Public domain — House Creative Services (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Matt%20Van%20Epps%20official%20portrait%2C%20119th%20Congress.jpg) |
| Maxine Waters | /officials/W000187.jpg | https://unitedstates.github.io/images/congress/450x550/W000187.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Nikema Williams | /officials/W000788.jpg | https://unitedstates.github.io/images/congress/450x550/W000788.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Joe Wilson | /officials/W000795.jpg | https://unitedstates.github.io/images/congress/450x550/W000795.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Debbie Wasserman Schultz | /officials/W000797.jpg | https://unitedstates.github.io/images/congress/450x550/W000797.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tim Walberg | /officials/W000798.jpg | https://unitedstates.github.io/images/congress/450x550/W000798.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Robert J. Wittman | /officials/W000804.jpg | https://unitedstates.github.io/images/congress/450x550/W000804.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Daniel Webster | /officials/W000806.jpg | https://unitedstates.github.io/images/congress/450x550/W000806.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Frederica S. Wilson | /officials/W000808.jpg | https://unitedstates.github.io/images/congress/450x550/W000808.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Steve Womack | /officials/W000809.jpg | https://unitedstates.github.io/images/congress/450x550/W000809.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ann Wagner | /officials/W000812.jpg | https://unitedstates.github.io/images/congress/450x550/W000812.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Randy K. Weber, Sr. | /officials/W000814.jpg | https://unitedstates.github.io/images/congress/450x550/W000814.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Roger Williams | /officials/W000816.jpg | https://unitedstates.github.io/images/congress/450x550/W000816.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bruce Westerman | /officials/W000821.jpg | https://unitedstates.github.io/images/congress/450x550/W000821.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Bonnie Watson Coleman | /officials/W000822.jpg | https://unitedstates.github.io/images/congress/450x550/W000822.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Tony Wied | /officials/W000829.jpg | https://unitedstates.github.io/images/congress/450x550/W000829.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| George Whitesides | /officials/W000830.jpg | https://unitedstates.github.io/images/congress/450x550/W000830.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| James R. Walkinshaw | /officials/W000831.jpg | https://commons.wikimedia.org/wiki/File%3AJames%20Walkinshaw.jpg | Public domain — US Congress (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AJames%20Walkinshaw.jpg) |
| Rudy Yakym III | /officials/Y000067.jpg | https://unitedstates.github.io/images/congress/450x550/Y000067.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Ryan K. Zinke | /officials/Z000018.jpg | https://unitedstates.github.io/images/congress/450x550/Z000018.jpg | Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images) |
| Andrés Cano | /officials/roster-pima-5.jpg | https://commons.wikimedia.org/wiki/File%3ACano%20Final.jpg | CC BY-SA 4.0 — Tucsondemocrat (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ACano%20Final.jpg) |
| Consuelo Hernandez | /officials/roster-susd12-4.jpg | https://commons.wikimedia.org/wiki/File%3AConsuelo%20Hernandez%20by%20Gage%20Skidmore.jpg | CC BY-SA 3.0 — Gage Skidmore (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AConsuelo%20Hernandez%20by%20Gage%20Skidmore.jpg) |
| Regina Romero | /officials/roster-tucson-mc-1.jpg | https://commons.wikimedia.org/wiki/File%3ARegina%20Romero%20-%202020%2001.jpg | Public domain — The United States Senate - Office of Senator Martha McSally (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARegina%20Romero%20-%202020%2001.jpg) |
| Katie Hobbs | /officials/statewide-az-governor.jpg | https://commons.wikimedia.org/wiki/File%3AKatie%20Hobbs%20by%20Gage%20Skidmore.jpg | CC BY-SA 3.0 — Gage Skidmore (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AKatie%20Hobbs%20by%20Gage%20Skidmore.jpg) |
| Kelly Ayotte | /officials/statewide-nh-governor.jpg | https://commons.wikimedia.org/wiki/File%3AKelly%20Ayotte%2C%20Official%20Portrait%2C%20112th%20Congress%202.jpg | Public domain — United States Senate (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AKelly%20Ayotte%2C%20Official%20Portrait%2C%20112th%20Congress%202.jpg) |
| Mikie Sherrill | /officials/statewide-nj-governor.jpg | https://commons.wikimedia.org/wiki/File%3AMikie%20Sherrill%20Headshot.jpg | CC BY-SA 4.0 — Joeshmonobody (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3AMikie%20Sherrill%20Headshot.jpg) |

80 recorded absences (every one carries its reason and date in the manifest):

| Person | Id | Reason |
|---|---|---|
| Marisa Sweeney | `plural:028a440f-10cb-49cc-9417-1dfd0cff83e2` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Aura Dunn | `plural:03aa8bec-9d7e-41e7-ad20-b5ba1991cab6` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Gail Griffin | `plural:1e39adcf-868d-4722-a07b-09fcd36ad9ed` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Sally Gonzales | `plural:3c965e03-1e51-4f10-a037-4fb2f35292c5` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| David Gowan | `plural:51520de4-0e87-475b-91d2-99aa18addf72` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Dan Innis | `plural:6328e7f7-d952-4d28-98b8-75a9a6f50c8d` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Alma Hernández | `plural:6dba6afa-b274-4273-b8c6-270d27214eee` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Betty Villegas | `plural:81d12f3a-b635-4111-be8d-a71d2f7565f2` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Karen Ebel | `plural:947e2e2b-04eb-4f92-9f83-aef8760517e0` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Lupe Diaz | `plural:bc52f516-a13b-4490-a12c-7b98fa3969e5` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Greg Sargent | `plural:f1292af8-a209-4ff7-87b5-086acddcc10e` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Tony Bucco | `plural:f321f20f-b8af-4d0b-85ba-e7b8dcf9ae03` | state legislature portrait — per-state terms hunt not yet done (docs/source-ladder.md) |
| Vicki Cox Golder | `roster:amphi#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Matt Kopec | `roster:amphi#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_P18 — Q26703665 matched (attributes: "American politician | member of the Arizona House of Representatives") but carries no P18 image |
| Deanna Day | `roster:amphi#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Michael Gemma | `roster:amphi#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Susan Zibrat | `roster:amphi#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Alison Mastin | `roster:kearsarge#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Kristen Schultz | `roster:kearsarge#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 3 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Kearsarge Regional School District|Kearsarge Regional School|New Hampshire/ |
| James MacKenna | `roster:kearsarge#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 1 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Kearsarge Regional School District|Kearsarge Regional School|New Hampshire/ |
| David Keith | `roster:kearsarge#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Kearsarge Regional School District|Kearsarge Regional School|New Hampshire/ |
| Art Bobruff | `roster:kearsarge#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Patrick McGowan | `roster:kearsarge#6` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Kearsarge Regional School District|Kearsarge Regional School|New Hampshire/ |
| Paul Lakevicius | `roster:kearsarge#7` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Nancy Glynn | `roster:kearsarge#8` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 1 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Kearsarge Regional School District|Kearsarge Regional School|New Hampshire/ |
| Eric Gregoire | `roster:kearsarge#9` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Stuart D. Trachy | `roster:merrimack#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| David M. Lovlien | `roster:merrimack#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Stephen Shurtleff | `roster:merrimack#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Stephen H. Shaw | `roster:morris#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| John Krickus | `roster:morris#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Douglas R. Cabana | `roster:morris#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Thomas J. Mastrangelo | `roster:morris#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Christine Myers | `roster:morris#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 2 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Morris County|New Jersey/ |
| Tayfun Selen | `roster:morris#6` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Deborah Smith | `roster:morris#7` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Morris County|New Jersey/ |
| Kristen Schultz | `roster:newbury#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 3 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Merrimack|Newbury Selectboard|New Hampshire/ |
| Scott Wheeler | `roster:newbury#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Merrimack|Newbury Selectboard|New Hampshire/ |
| Sandra Warde | `roster:newbury#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Rex Scott | `roster:pima#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Dr. Matt Heinz | `roster:pima#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jennifer Allen | `roster:pima#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Pima|Pima County|Arizona/ |
| Steve Christy | `roster:pima#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Joseph Jackson | `roster:rockaway#0` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Rockaway Township|New Jersey/ |
| Howard Morrison | `roster:rockaway#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 4 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Rockaway Township|New Jersey/ |
| Jonathan Sackett | `roster:rockaway#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 2 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Rockaway Township|New Jersey/ |
| Adam Salberg | `roster:rockaway#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Pawel Wojtowicz | `roster:rockaway#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Susan Fahrman Royek | `roster:rockaway#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| John J. Quinn | `roster:rockaway#6` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 2 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Morris|Rockaway Township|New Jersey/ |
| Sophia Freire | `roster:rockaway#7` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Emanuel Friedlander | `roster:rockaway#8` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Tucker Kelley | `roster:rockaway#9` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Alison McGeary | `roster:rocktwp-boe#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Noël Anderson | `roster:rocktwp-boe#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 3 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Rockaway Township School District|Rockaway Township|New Jersey/ |
| Lisa Mezik | `roster:rocktwp-boe#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jacalyn Richardson | `roster:rocktwp-boe#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jemila Ann Tourne | `roster:rocktwp-boe#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jamie Gorman | `roster:rocktwp-boe#6` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 2 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Rockaway Township School District|Rockaway Township|New Jersey/ |
| Rachael Brookes | `roster:rocktwp-boe#7` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Beki Quintero | `roster:susd12#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Ted Rodriquez | `roster:susd12#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Edgar Bustamante | `roster:susd12#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 1 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Sunnyside Unified District|Sunnyside Unified School District Governing|Arizona/ |
| Roberto Jaramillo | `roster:susd12#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Sunnyside Unified District|Sunnyside Unified School District Governing|Arizona/ |
| Lane Santa Cruz | `roster:tucson-mc#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Paul Cunningham | `roster:tucson-mc#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Tucson|Tucson Mayor &|Arizona/ |
| Kevin Dahl | `roster:tucson-mc#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 2 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Tucson|Tucson Mayor &|Arizona/ |
| Nikki Lee | `roster:tucson-mc#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Tucson|Tucson Mayor &|Arizona/ |
| Selina Barajas | `roster:tucson-mc#6` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Miranda Schubert | `roster:tucson-mc#7` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Dr. Ravi Shah | `roster:tusd#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Natalie Luna Rose | `roster:tusd#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jennifer Eckstrom | `roster:tusd#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Val Romero | `roster:tusd#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Sadie Shaw | `roster:tusd#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Allison Pratt | `roster:vail#1` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Callie Tippett | `roster:vail#2` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Jen Anderson | `roster:vail#3` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 1 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Vail Unified District|Vail Unified School District Governing|Arizona/ |
| Ed Buster | `roster:vail#4` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — no search hits |
| Chris King | `roster:vail#5` | Wikimedia Commons rung (photo session 2026-08-14): NO_WIKIDATA_MATCH — 5 hits, none passed office=/mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician/ + place=/Vail Unified District|Vail Unified School District Governing|Arizona/ |

## Candidate cards — `data/ballot/candidate-cards-2026.json`

Generated from the cards file by `scripts/photo-census.mts`. Each row is
a shipped photo with the judgment and source recorded on the card itself
(`photoSource` renders as the image's title/alt). External photos were
localized 2026-08-14: committed copies under `public/candidates/`,
metadata-stripped, served from our origin. A candidate not listed renders
initials, and every absence is a recorded hunt in the file's `hunts`
array (128 recorded hunts, rung-by-rung with dates).

50 shipped card photos:

| Card key | Served file | Judgment and source |
|---|---|---|
| `ballot-az-pima:attorney-general:mayes-kris` | /candidates/az-pima-attorney-general-mayes-kris.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 2.0, photo: Gage Skidmore from Surprise, AZ, United States of America, Please attribute to Gage Skidmore if used elsewhere.; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:attorney-general:petersen-warren` | /candidates/az-pima-attorney-general-petersen-warren.jpg | solo event candid wearing his own name badge, sole subject — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:attorney-general|Kris Mayes` | /candidates/az-pima-attorney-general-mayes-kris.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 2.0, photo: Gage Skidmore from Surprise, AZ, United States of America, Please attribute to Gage Skidmore if used elsewhere.; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:attorney-general|Warren Petersen` | /candidates/az-pima-attorney-general-petersen-warren.jpg | solo event candid wearing his own name badge, sole subject — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:governor:biggs-andy` | /officials/B001302.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/B001302.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-az-pima:governor:hobbs-katie` | /candidates/az-pima-governor-hobbs-katie.jpg | solo speaking-event portrait, unambiguous sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:governor:schweikert-david` | /officials/S001183.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/S001183.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-az-pima:governor|Andy Biggs` | /officials/B001302.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/B001302.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-az-pima:governor|Katie Hobbs` | /candidates/az-pima-governor-hobbs-katie.jpg | solo speaking-event portrait, unambiguous sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:secretary-of-state:fontes-adrian` | /candidates/az-pima-secretary-of-state-fontes-adrian.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:secretary-of-state:kolodin-alexander` | /candidates/az-pima-secretary-of-state-kolodin-alexander.jpg | solo speaking portrait, sole subject — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:secretary-of-state|Adrian Fontes` | /candidates/az-pima-secretary-of-state-fontes-adrian.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:secretary-of-state|Alexander Kolodin` | /candidates/az-pima-secretary-of-state-kolodin-alexander.jpg | solo speaking portrait, sole subject — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-19:diaz-lupe` | /candidates/az-pima-state-house-19-diaz-lupe.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-19:gowan-david` | /candidates/az-pima-state-house-19-gowan-david.jpg | solo event candid, sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-19|David Gowan` | /candidates/az-pima-state-house-19-gowan-david.jpg | solo event candid, sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-19|Lupe Diaz` | /candidates/az-pima-state-house-19-diaz-lupe.jpg | clean solo portrait â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-20:gonzales-sally-ann` | /candidates/az-pima-state-house-20-gonzales-sally-ann.jpg | solo speaking portrait at committee microphone â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-20:villegas-betty` | /candidates/az-pima-state-house-20-villegas-betty.jpg | clean solo portrait (hearing room) â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-20|Betty Villegas` | /candidates/az-pima-state-house-20-villegas-betty.jpg | clean solo portrait (hearing room) â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-house-20|Sally Ann Gonzales` | /candidates/az-pima-state-house-20-gonzales-sally-ann.jpg | solo speaking portrait at committee microphone â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-senate-19:griffin-gail` | /candidates/az-pima-state-senate-19-griffin-gail.jpg | informal event candid, unambiguous sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-senate-19|Gail Griffin` | /candidates/az-pima-state-senate-19-griffin-gail.jpg | informal event candid, unambiguous sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-senate-20:hernandez-alma` | /candidates/az-pima-state-senate-20-hernandez-alma.jpg | clean solo candid, sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-senate-20|Alma Hernandez` | /candidates/az-pima-state-senate-20-hernandez-alma.jpg | clean solo candid, sole subject â€” Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:state-treasurer:mansour-nick` | /candidates/az-pima-state-treasurer-Nick-Mansour.jpg | clean solo portrait (outdoor, wide hero crop) — the campaign site's own photo (http://static1.squarespace.com/static/68080891cdf97c2e874172e0/t/69d3fae562e8ac760d3be2d2/1775500005849/Mansour__DSF7615_GFX100S-hero.jpg?format=1500w), read 2026-08-14; committed copy served from our origin, metadata stripped |
| `ballot-az-pima:state-treasurer|Nick Mansour` | /candidates/az-pima-state-treasurer-Nick-Mansour.jpg | clean solo portrait (outdoor, wide hero crop) — the campaign site's own photo (http://static1.squarespace.com/static/68080891cdf97c2e874172e0/t/69d3fae562e8ac760d3be2d2/1775500005849/Mansour__DSF7615_GFX100S-hero.jpg?format=1500w), read 2026-08-14; committed copy served from our origin, metadata stripped |
| `ballot-az-pima:superintendent:horne-tom` | /candidates/az-pima-superintendent-horne-tom.jpg | solo event candid, sole subject — Wikimedia Commons, CC BY-SA 2.0, photo: Gage Skidmore from Surprise, AZ, United States of America; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:superintendent:leyba-ruiz-teresa` | /candidates/az-pima-superintendent-Teresa-Leyba-Ruiz.jpg | clean solo portrait (office, arms crossed) — the campaign site's own photo (https://static.wixstatic.com/media/f57a3d_70983a372846453f9db0bf6bd87ec3c5~mv2.jpg/v1/fill/w_1024,h_684,al_c/f57a3d_70983a372846453f9db0bf6bd87ec3c5~mv2.jpg), read 2026-08-14; committed copy served from our origin, metadata stripped |
| `ballot-az-pima:superintendent:yee-kimberly` | /candidates/az-pima-superintendent-yee-kimberly.jpg | solo podium portrait wearing her name badge — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:superintendent|Kimberly Yee` | /candidates/az-pima-superintendent-yee-kimberly.jpg | solo podium portrait wearing her name badge — Wikimedia Commons, CC BY-SA 3.0, photo: Gage Skidmore; file page read 2026-08-14, committed copy served from our origin |
| `ballot-az-pima:superintendent|Teresa Leyba Ruiz` | /candidates/az-pima-superintendent-Teresa-Leyba-Ruiz.jpg | clean solo portrait (office, arms crossed) — the campaign site's own photo (https://static.wixstatic.com/media/f57a3d_70983a372846453f9db0bf6bd87ec3c5~mv2.jpg/v1/fill/w_1024,h_684,al_c/f57a3d_70983a372846453f9db0bf6bd87ec3c5~mv2.jpg), read 2026-08-14; committed copy served from our origin, metadata stripped |
| `ballot-az-pima:us-house-6:ciscomani-juan` | /officials/C001133.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/C001133.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-az-pima:us-house-6|Juan Ciscomani` | /officials/C001133.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/C001133.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-az-pima:us-house-7:grijalva-adelita` | /officials/G000606.jpg | Committed portrait of the sitting member (license recorded in lib/registry/official-photos.json: Public domain â€” Damien Salas, Office of the Clerk U.S.House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Adelita%20Grijalva%20Official%20Portrait.jpg)) |
| `ballot-az-pima:us-house-7|Adelita Grijalva` | /officials/G000606.jpg | Committed portrait of the sitting member (license recorded in lib/registry/official-photos.json: Public domain â€” Damien Salas, Office of the Clerk U.S.House of Representatives (Wikimedia Commons, https://commons.wikimedia.org/wiki/File%3ARep.%20Adelita%20Grijalva%20Official%20Portrait.jpg)) |
| `ballot-nh-merrimack:executive-council-2:liot-hill-karen` | /candidates/nh-merrimack-executive-council-2-liot-hill-karen.jpg | Photo: the candidate's campaign site (karenliothill.com) â€” committed copy of https://static.wixstatic.com/media/644896_ac32357ab0c6496a8824ebedef424559~mv2.jpeg served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nh-merrimack:governor:ayotte-kelly` | /candidates/nh-merrimack-governor-ayotte-kelly.jpg | official U.S. Senate portrait, public domain â€” Wikimedia Commons, Public domain, photo: United States Senate; file page read 2026-08-14, committed copy served from our origin |
| `ballot-nh-merrimack:governor:warmington-cinde` | /candidates/nh-merrimack-governor-warmington-cinde.jpg | Photo: the candidate's campaign site (cindewarmington.com) â€” committed copy of https://run.imgix.net/97cfce8c-9d0e-4e05-824d-283b14876207/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3.jpg served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nh-merrimack:state-house-merrimack-7:sargent-gregory-m-` | /candidates/nh-merrimack-state-house-merrimack-7-sargent-gregory-m-.jpg | Photo: the candidate's campaign site (gregforrep.com) â€” committed copy of https://gregforrep.com/greg-portrait.jpg served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nh-merrimack:us-house-2:goodlander-maggie` | /officials/G000604.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy; license recorded in lib/registry/official-photos.json |
| `ballot-nh-merrimack:us-house-2:tang-williams-lily` | /candidates/nh-merrimack-us-house-2-tang-williams-lily.png | Photo: the candidate's campaign site (lilytangwilliams.com) â€” committed copy of https://www.lilytangwilliams.com/wp-content/uploads/2022/01/lily-tang-williams-homepage.png served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nh-merrimack:us-senate:brown-scott-p-` | /candidates/nh-merrimack-us-senate-brown-scott-p-.jpg | official U.S. Senate portrait, public domain — Wikimedia Commons, Public domain, photo: United States Congress; file page read 2026-08-14, committed copy served from our origin |
| `ballot-nh-merrimack:us-senate:pappas-chris` | /officials/P000614.jpg | Official portrait â€” GPO Congressional Pictorial Directory (public domain), committed copy at /officials/P000614.jpg; license recorded in lib/registry/official-photos.json |
| `ballot-nh-merrimack:us-senate:sununu-john-e-` | /candidates/nh-merrimack-us-senate-sununu-john-e-.jpg | official U.S. Senate portrait, public domain — Wikimedia Commons, Public domain, photo: Unknown authorUnknown author; file page read 2026-08-14, committed copy served from our origin |
| `ballot-nj-morris:county-commissioner:selen` | /candidates/nj-morris-county-commissioner-selen.jpg | Photo: the candidate's campaign site (selenformorriscounty.com) â€” committed copy of https://static.wixstatic.com/media/7ef20c_da57f763291442e19e51303d0828044b~mv2.jpg served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nj-morris:us-house-11:mejia` | /officials/M001246.jpg | Committed portrait of the sitting member (license recorded in lib/registry/official-photos.json: Public domain, official congressional portrait via Wikimedia Commons) |
| `ballot-nj-morris:us-senate:booker` | /candidates/nj-morris-us-senate-booker.png | Photo: the candidate's campaign site (corybooker.com) â€” committed copy of https://corybooker.com/wp-content/uploads/2020/01/cory_sq_profile.png served from our origin (fetched 2026-08-14, metadata stripped) |
| `ballot-nj-morris:us-senate:fernandez` | /candidates/nj-morris-us-senate-fernandez.png | clean solo studio portrait — the campaign site's own photo (https://img1.wsimg.com/isteam/ip/968e4fa3-7440-46a2-ae03-16126b33e7da/blob-3188f26.png), read 2026-08-14; committed copy served from our origin, metadata stripped |
| `ballot-nj-morris:us-senate:murphy` | /candidates/nj-morris-us-senate-murphy.jpg | solo photo at his own campaign event, unambiguous sole subject — the campaign site's own photo (https://jerseyjustin4senate.org/wp-content/uploads/2024/01/D70_8879-684x1024.jpg), read 2026-08-14; committed copy served from our origin, metadata stripped |


## The census — every rendered person, counted by script

Run `pnpm exec tsx scripts/photo-census.mts` to regenerate. Counted
2026-08-15 against the committed data. "Portrait"
means the surface serves an actual judged photo; everything else renders
honest initials. The universe is people the product can actually render:
ballot candidacies and lineup nominees, federal officials attached to
covered divisions, state legislators attached to covered divisions, and
every curated local roster member.

**476 of 750 rendered people have a portrait; 274 render initials.**

| Surface | Portraits | Initials | Total |
|---|---|---|---|
| ballot candidates | 33 | 76 | 109 |
| federal officials | 437 | 0 | 437 |
| state legislators | 0 | 130 | 130 |
| curated local rosters | 3 | 68 | 71 |
| statewide executives | 3 | 0 | 3 |

| State | Portraits | Initials | Total |
|---|---|---|---|
| AK | 1 | 0 | 1 |
| AL | 7 | 0 | 7 |
| AR | 4 | 0 | 4 |
| AZ | 34 | 81 | 115 |
| CA | 51 | 0 | 51 |
| CO | 8 | 0 | 8 |
| CT | 5 | 0 | 5 |
| DE | 1 | 0 | 1 |
| FL | 27 | 0 | 27 |
| GA | 13 | 0 | 13 |
| HI | 2 | 0 | 2 |
| IA | 4 | 0 | 4 |
| ID | 2 | 0 | 2 |
| IL | 17 | 0 | 17 |
| IN | 9 | 0 | 9 |
| KS | 4 | 0 | 4 |
| KY | 6 | 0 | 6 |
| LA | 6 | 0 | 6 |
| MA | 9 | 0 | 9 |
| MD | 8 | 0 | 8 |
| ME | 2 | 0 | 2 |
| MI | 13 | 0 | 13 |
| MN | 8 | 0 | 8 |
| MO | 8 | 0 | 8 |
| MS | 4 | 0 | 4 |
| MT | 2 | 0 | 2 |
| NC | 14 | 0 | 14 |
| ND | 1 | 0 | 1 |
| NE | 3 | 0 | 3 |
| NH | 14 | 138 | 152 |
| NJ | 20 | 55 | 75 |
| NM | 3 | 0 | 3 |
| NV | 4 | 0 | 4 |
| NY | 26 | 0 | 26 |
| OH | 15 | 0 | 15 |
| OK | 5 | 0 | 5 |
| OR | 6 | 0 | 6 |
| PA | 17 | 0 | 17 |
| RI | 2 | 0 | 2 |
| SC | 7 | 0 | 7 |
| SD | 1 | 0 | 1 |
| TN | 9 | 0 | 9 |
| TX | 37 | 0 | 37 |
| UT | 4 | 0 | 4 |
| VA | 11 | 0 | 11 |
| VT | 1 | 0 | 1 |
| WA | 10 | 0 | 10 |
| WI | 8 | 0 | 8 |
| WV | 2 | 0 | 2 |
| WY | 1 | 0 | 1 |

### The named misses — the dedicated photo session's shopping list

**ballot candidates — AZ (28):** Teri Ann Hourihan; Risa Lombardo; Hugh Lytle; Ken Miceli; Scott Neely; Duwayne Collier; Gina Swoboda; Rodney Glassman; Michael Zepeda; Katherine Haley; Elijah Norton; Michael D. Butts; Brett Matthew Newby; Brian Matlock; JoAnna Mendoza; Iman Bah; Jereme Lance Peters; Daniel Francis Butierez Sr.; Ryan Slawson; Rocque Perez; Jackie O'Donnell Anderson; Aiden Nicholette Swallow; Cheryl Caswell; Genoveva Diaz; Ben Koehler; Walter "Les" Presmyk; Gary Swing; Bob Karp

**ballot candidates — NH (38):** Shaun Fife; Bob Wayne McClory; David Jarvis; Karishma Manzur; Maxwell L. Saal; John Vail; Tom Alciere; Sky Danley; Andy Martin; Mary Maxwell; Richard A. McMenamon II; Sabrina Ann Smith; Paige Beauchemin; Michael Anthony Callis; Dan Nicholson; Victor Orlando; Rebecca Harned; Daniel E. Innis; Karen Elizabeth Ebel; Cynthia Rusis; Tobin Menard; Kim Strathdee; Vincent S. Ribas; Richard Bilodeau; Harold F. French; Peter Shephard; Frank T. Cassidy; Jason Gerhard; Ben Weir; Steven Endres; Meg Hagaman; Jon Raiche; Sarah Rogers; Kathleen Donnelly; Dianne E. Schuett; Erica S. Davis; Samantha Morse; Jane Bradstreet

**ballot candidates — NJ (10):** Joanne KUNIANSKY; Alan B. BOND; Joe HATHAWAY; Christopher (Chris) RUSSO; Munir "Monir" MAMOUN; Lisa MEZIK; Russell G. NYDEGGER; Olivier BORNO; Brian ROACH; William SERAFIN

**state legislators — AZ (24):** Alma Hernández; Betty Villegas; Brian Fernandez; Chris Lopez; Chris Mathis; Consuelo Hernandez; David Gowan; Gail Griffin; Kevin Volk; Lupe Diaz; Mariana Sandoval; Michele Peña; Nancy Gutierrez; Priya Sundareshan; Rachel Keshel; Rosanna Gabaldón; Sally Gonzales; Stephanie Stahl Hamilton; Sylvia Allen; Teresa Martinez; T.J. Shope; Vince Leach; Walt Blackman; Wendy Rogers

**state legislators — NH (85):** Barbara Comtois; Beth Richards; Brian Seaworth; Bryan Morse; Cassandra Levesque; Christine Seibert; Clayton Wood; Connie Lane; Cy Aures; Dan McGuire; Dan Innis; Dave Nagel; David Preece; David Luneau; Deborah Aylward; Eileen Kelly; Eleana Colby; Eric Gallager; Ernesto Gonzalez; George Grant; Glen Aldrich; Greg Sargent; Greg Hill; Heath Howard; Henry Giasson; Howard Pearl; Jim Spillane; James Roesener; James Newsom; James Gray; Jim MacKay; Jason Osborne; Jessica Grill; Jim Fedolfi; Jim Guzofski; Jim Creighton; Joe Alexander; John Leavitt; John Sellers; Jose Cambrils; Judy Aron; Juliet Harvey-Bolia; Karen Ebel; Keith Erf; Keith Murphy; Kevin Verville; Len Turcotte; Lex Berezhny; Linda DiSilvestro; Louise Andrus; Mary Jane Wallner; Mary Murphy; Matt Wilhelm; Matthew Pitaro; Matthew Hicks; Merryl Gibbs; Mike Moffett; Muriel Hall; Pat Long; Paul Terry; Paul Tudor; Peter Mehegan; Peter Varney; Riché Colcombe; Rick Devoid; Russ Dumais; Ruth Ward; Scott Bryer; Sharon Carson; Sherri Reinfurt; Stephanie Payeur; Stephen Boyd; Steve Kesselring; Sue Prentiss; Tara Reardon; Tom Schamberg; Thomas Walsh; Timothy Soucy; Tim Lang; Tom Ploszaj; Tony Caplan; Tracy Bricchi; Travis Corcoran; Travis Toner; Yury Polozov

**state legislators — NJ (21):** Al Barlas; Alixon Collazos-Gill; Andrew Macurdy; Tony Bucco; Aura Dunn; Brian Bergen; Chris DePhillips; Dawn Fantasia; Doug Steinhardt; Erik Peterson; Jay Webber; John DiMaio; John McKeon; Jon Bramnick; Joe Pennacchio; Kristin Corrado; Marisa Sweeney; Mike Inganamort; Parker Space; Rosy Bagolie; Vinnie Kearney

**curated local rosters — AZ (29):** Dr. Ravi Shah; Natalie Luna Rose; Jennifer Eckstrom; Val Romero; Sadie Shaw; Rex Scott; Dr. Matt Heinz; Jennifer Allen; Steve Christy; Lane Santa Cruz; Paul Cunningham; Kevin Dahl; Nikki Lee; Selina Barajas; Miranda Schubert; Allison Pratt; Callie Tippett; Jen Anderson; Ed Buster; Chris King; Beki Quintero; Ted Rodriquez; Edgar Bustamante; Roberto Jaramillo; Vicki Cox Golder; Matt Kopec; Deanna Day; Michael Gemma; Susan Zibrat

**curated local rosters — NH (15):** Kristen Schultz; Scott Wheeler; Sandra Warde; Alison Mastin; Kristen Schultz; James MacKenna; David Keith; Art Bobruff; Patrick McGowan; Paul Lakevicius; Nancy Glynn; Eric Gregoire; Stuart D. Trachy; David M. Lovlien; Stephen Shurtleff

**curated local rosters — NJ (24):** Joseph Jackson; Howard Morrison; Jonathan Sackett; Adam Salberg; Pawel Wojtowicz; Susan Fahrman Royek; John J. Quinn; Sophia Freire; Emanuel Friedlander; Tucker Kelley; Stephen H. Shaw; John Krickus; Douglas R. Cabana; Thomas J. Mastrangelo; Christine Myers; Tayfun Selen; Deborah Smith; Alison McGeary; Noël Anderson; Lisa Mezik; Jacalyn Richardson; Jemila Ann Tourne; Jamie Gorman; Rachael Brookes
