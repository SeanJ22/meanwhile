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

## Roster officials — `lib/registry/official-photos.json`, served from `/officials/`

All eight are the GPO Congressional Pictorial Directory portrait
(450×550, public domain as U.S. federal government works), fetched via
the public-domain unitedstates/images mirror. Portraits by construction.

| Person | Served file | Source URL |
|---|---|---|
| Juan Ciscomani | /officials/C001133.jpg | https://unitedstates.github.io/images/congress/450x550/C001133.jpg |
| Mark Kelly | /officials/K000377.jpg | https://unitedstates.github.io/images/congress/450x550/K000377.jpg |
| Ruben Gallego | /officials/G000574.jpg | https://unitedstates.github.io/images/congress/450x550/G000574.jpg |
| Andy Kim | /officials/K000394.jpg | https://unitedstates.github.io/images/congress/450x550/K000394.jpg |
| Cory A. Booker | /officials/B001288.jpg | https://unitedstates.github.io/images/congress/450x550/B001288.jpg |
| Maggie Goodlander | /officials/G000604.jpg | https://unitedstates.github.io/images/congress/450x550/G000604.jpg |
| Jeanne Shaheen | /officials/S001181.jpg | https://unitedstates.github.io/images/congress/450x550/S001181.jpg |
| Margaret Wood Hassan | /officials/H001076.jpg | https://unitedstates.github.io/images/congress/450x550/H001076.jpg |

## Candidate cards — `data/ballot/candidate-cards-2026.json`

The eight photos that pass the rule, exactly as served:

| Candidate | Judgment | Source URL |
|---|---|---|
| Cinde Warmington | clean solo portrait (brick wall, arms crossed) | https://run.imgix.net/97cfce8c-9d0e-4e05-824d-283b14876207/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3.jpg |
| Lily Tang Williams | clean solo headshot (transparent background) | https://www.lilytangwilliams.com/wp-content/uploads/2022/01/lily-tang-williams-homepage.png |
| Gregory M. Sargent | clean solo headshot (outdoor bokeh) | https://gregforrep.com/greg-portrait.jpg |
| Karen Liot Hill | solo self-portrait at the NH State House — informal but the unambiguous sole subject | https://static.wixstatic.com/media/644896_ac32357ab0c6496a8824ebedef424559~mv2.jpeg |
| Cory Booker | solo profile portrait (B&W) | https://corybooker.com/wp-content/uploads/2020/01/cory_sq_profile.png |
| Analilia Mejia | clean solo portrait (street, arms crossed) | https://images.squarespace-cdn.com/content/v1/691b52e1abc45c143c47e6a2/1ffd50e3-47e3-411d-b5d0-94c514a55328/Headshot-+Web+Background+3.jpg |
| Tahsin Selen | clean solo portrait (suit, arms crossed) | https://static.wixstatic.com/media/7ef20c_da57f763291442e19e51303d0828044b~mv2.jpg |
| Maggie Goodlander | committed public-domain official portrait | /officials/G000604.jpg (see roster table) |

The six that fell to initials on 2026-08-19, with the failing class
(full rung-by-rung records live in the cards file's hunts):

| Candidate | What the shipped image actually was |
|---|---|
| Kelly Ayotte | WinRed campaign banner with logo text |
| Katie Hobbs | white-on-transparent campaign wordmark — not a photograph (the card the author flagged) |
| Justin Murphy | file renders blank white as fetched |
| Scott P. Brown | two-person event candid |
| John E. Sununu | two-person couple photo — a stranger cannot tell which person is the candidate |
| Rebecca Harned | canoe selfie with a child |

Cards that had no photo before and still have none: Chris Pappas, Joe
Hathaway, Andy Biggs (recorded hunts, unchanged).

## The census — every rendered person, counted by script

Run `pnpm exec tsx scripts/photo-census.mts` to regenerate. Counted
2026-08-14 against the committed data. "Portrait"
means the surface serves an actual judged photo; everything else renders
honest initials. The universe is people the product can actually render:
ballot candidacies and lineup nominees, federal officials attached to
covered divisions, state legislators attached to covered divisions, and
every curated local roster member.

**16 of 747 rendered people have a portrait; 731 render initials.**

| Surface | Portraits | Initials | Total |
|---|---|---|---|
| ballot candidates | 8 | 101 | 109 |
| federal officials | 8 | 429 | 437 |
| state legislators | 0 | 130 | 130 |
| curated local rosters | 0 | 71 | 71 |

| State | Portraits | Initials | Total |
|---|---|---|---|
| AK | 0 | 1 | 1 |
| AL | 0 | 7 | 7 |
| AR | 0 | 4 | 4 |
| AZ | 3 | 111 | 114 |
| CA | 0 | 51 | 51 |
| CO | 0 | 8 | 8 |
| CT | 0 | 5 | 5 |
| DE | 0 | 1 | 1 |
| FL | 0 | 27 | 27 |
| GA | 0 | 13 | 13 |
| HI | 0 | 2 | 2 |
| IA | 0 | 4 | 4 |
| ID | 0 | 2 | 2 |
| IL | 0 | 17 | 17 |
| IN | 0 | 9 | 9 |
| KS | 0 | 4 | 4 |
| KY | 0 | 6 | 6 |
| LA | 0 | 6 | 6 |
| MA | 0 | 9 | 9 |
| MD | 0 | 8 | 8 |
| ME | 0 | 2 | 2 |
| MI | 0 | 13 | 13 |
| MN | 0 | 8 | 8 |
| MO | 0 | 8 | 8 |
| MS | 0 | 4 | 4 |
| MT | 0 | 2 | 2 |
| NC | 0 | 14 | 14 |
| ND | 0 | 1 | 1 |
| NE | 0 | 3 | 3 |
| NH | 8 | 143 | 151 |
| NJ | 5 | 69 | 74 |
| NM | 0 | 3 | 3 |
| NV | 0 | 4 | 4 |
| NY | 0 | 26 | 26 |
| OH | 0 | 15 | 15 |
| OK | 0 | 5 | 5 |
| OR | 0 | 6 | 6 |
| PA | 0 | 17 | 17 |
| RI | 0 | 2 | 2 |
| SC | 0 | 7 | 7 |
| SD | 0 | 1 | 1 |
| TN | 0 | 9 | 9 |
| TX | 0 | 37 | 37 |
| UT | 0 | 4 | 4 |
| VA | 0 | 11 | 11 |
| VT | 0 | 1 | 1 |
| WA | 0 | 10 | 10 |
| WI | 0 | 8 | 8 |
| WV | 0 | 2 | 2 |
| WY | 0 | 1 | 1 |

### The named misses — the dedicated photo session's shopping list

**ballot candidates — AZ (47):** Katie Hobbs; Teri Ann Hourihan; Risa Lombardo; Hugh Lytle; Andy Biggs; Ken Miceli; Scott Neely; David Schweikert; Adrian Fontes; Duwayne Collier; Alexander Kolodin; Gina Swoboda; Kris Mayes; Rodney Glassman; Warren Petersen; Nick Mansour; Michael Zepeda; Katherine Haley; Elijah Norton; Michael D. Butts; Teresa Leyba Ruiz; Brett Matthew Newby; Tom Horne; Kimberly Yee; Brian Matlock; JoAnna Mendoza; Iman Bah; Jereme Lance Peters; Juan Ciscomani; Adelita Grijalva; Daniel Francis Butierez Sr.; Ryan Slawson; Gail Griffin; Alma Hernandez; Rocque Perez; Jackie O'Donnell Anderson; Aiden Nicholette Swallow; Cheryl Caswell; Lupe Diaz; David Gowan; Genoveva Diaz; Sally Ann Gonzales; Ben Koehler; Betty Villegas; Walter "Les" Presmyk; Gary Swing; Bob Karp

**ballot candidates — NH (42):** Kelly Ayotte; Shaun Fife; Bob Wayne McClory; David Jarvis; Karishma Manzur; Chris Pappas; Maxwell L. Saal; John Vail; Tom Alciere; Scott P. Brown; Sky Danley; Andy Martin; Mary Maxwell; Richard A. McMenamon II; Sabrina Ann Smith; John E. Sununu; Paige Beauchemin; Michael Anthony Callis; Dan Nicholson; Victor Orlando; Rebecca Harned; Daniel E. Innis; Karen Elizabeth Ebel; Cynthia Rusis; Tobin Menard; Kim Strathdee; Vincent S. Ribas; Richard Bilodeau; Harold F. French; Peter Shephard; Frank T. Cassidy; Jason Gerhard; Ben Weir; Steven Endres; Meg Hagaman; Jon Raiche; Sarah Rogers; Kathleen Donnelly; Dianne E. Schuett; Erica S. Davis; Samantha Morse; Jane Bradstreet

**ballot candidates — NJ (12):** Veronica FERNANDEZ; Joanne KUNIANSKY; Justin MURPHY; Alan B. BOND; Joe HATHAWAY; Christopher (Chris) RUSSO; Munir "Monir" MAMOUN; Lisa MEZIK; Russell G. NYDEGGER; Olivier BORNO; Brian ROACH; William SERAFIN

**federal officials — AK (1):** Nicholas J. Begich III

**federal officials — AL (7):** Robert B. Aderholt; Mike Rogers; Terri A. Sewell; Gary J. Palmer; Barry Moore; Dale W. Strong; Shomari Figures

**federal officials — AR (4):** Eric A. "Rick" Crawford; Steve Womack; J. French Hill; Bruce Westerman

**federal officials — AZ (8):** Paul A. Gosar; David Schweikert; Andy Biggs; Greg Stanton; Elijah Crane; Yassamin Ansari; Abraham J. Hamadeh; Adelita S. Grijalva

**federal officials — CA (51):** Ken Calvert; Judy Chu; Jim Costa; John Garamendi; Zoe Lofgren; Doris O. Matsui; Tom McClintock; Nancy Pelosi; Brad Sherman; Linda T. Sánchez; Mike Thompson; Maxine Waters; Jared Huffman; Ami Bera; Julia Brownley; Raul Ruiz; Mark Takano; Juan Vargas; Scott H. Peters; Mark DeSaulnier; Pete Aguilar; Ted Lieu; Norma J. Torres; Ro Khanna; Jimmy Panetta; Salud O. Carbajal; Nanette Diaz Barragán; J. Luis Correa; Jimmy Gomez; Josh Harder; Mike Levin; Darrell Issa; David G. Valadao; Jay Obernolte; Young Kim; Sara Jacobs; Kevin Kiley; Kevin Mullin; Sydney Kamlager-Dove; Robert Garcia; Vince Fong; Gilbert Ray Cisneros, Jr.; Lateefah Simon; Adam Gray; Sam T. Liccardo; George Whitesides; Luz M. Rivas; Laura Friedman; Derek Tran; Dave Min; James Gallagher

**federal officials — CO (8):** Diana DeGette; Joe Neguse; Jason Crow; Lauren Boebert; Brittany Pettersen; Jeff Hurd; Jeff Crank; Gabe Evans

**federal officials — CT (5):** Joe Courtney; Rosa L. DeLauro; James A. Himes; John B. Larson; Jahana Hayes

**federal officials — DE (1):** Sarah McBride

**federal officials — FL (27):** Gus M. Bilirakis; Vern Buchanan; Kathy Castor; Mario Diaz-Balart; Debbie Wasserman Schultz; Daniel Webster; Frederica S. Wilson; Lois Frankel; Neal P. Dunn; John H. Rutherford; Darren Soto; Brian J. Mast; W. Gregory Steube; Kat Cammack; Scott Franklin; Byron Donalds; Carlos A. Gimenez; Maria Elvira Salazar; Aaron Bean; Cory Mills; Maxwell Frost; Anna Paulina Luna; Laurel M. Lee; Jared Moskowitz; Mike Haridopolos; Jimmy Patronis; Randy Fine

**federal officials — GA (13):** Sanford D. Bishop, Jr.; Henry C. "Hank" Johnson, Jr.; Austin Scott; Earl L. "Buddy" Carter; Barry Loudermilk; Rick W. Allen; Lucy McBath; Nikema Williams; Andrew S. Clyde; Richard McCormick; Mike Collins; Brian Jack; Clay Fuller

**federal officials — HI (2):** Ed Case; Jill N. Tokuda

**federal officials — IA (4):** Ashley Hinson; Mariannette Miller-Meeks; Randy Feenstra; Zachary Nunn

**federal officials — ID (2):** Michael K. Simpson; Russ Fulcher

**federal officials — IL (17):** Danny K. Davis; Mike Quigley; Janice D. Schakowsky; Bill Foster; Robin L. Kelly; Mike Bost; Darin LaHood; Bradley Scott Schneider; Raja Krishnamoorthi; Jesús G. "Chuy" García; Sean Casten; Lauren Underwood; Mary E. Miller; Jonathan L. Jackson; Delia C. Ramirez; Nikki Budzinski; Eric Sorensen

**federal officials — IN (9):** André Carson; James R. Baird; Frank J. Mrvan; Victoria Spartz; Rudy Yakym III; Erin Houchin; Marlin A. Stutzman; Jefferson Shreve; Mark B. Messmer

**federal officials — KS (4):** Ron Estes; Sharice Davids; Tracey Mann; Derek Schmidt

**federal officials — KY (6):** Brett Guthrie; Harold Rogers; Thomas Massie; Andy Barr; James Comer; Morgan McGarvey

**federal officials — LA (6):** Steve Scalise; Clay Higgins; Mike Johnson; Julia Letlow; Troy A. Carter; Cleo Fields

**federal officials — MA (9):** William R. Keating; Stephen F. Lynch; James P. McGovern; Richard E. Neal; Katherine M. Clark; Seth Moulton; Lori Trahan; Ayanna Pressley; Jake Auchincloss

**federal officials — MD (8):** Andy Harris; Steny H. Hoyer; Jamie Raskin; Kweisi Mfume; Glenn Ivey; Johnny Olszewski, Jr.; Sarah Elfreth; April McClain Delaney

**federal officials — ME (2):** Chellie Pingree; Jared F. Golden

**federal officials — MI (13):** Bill Huizenga; Tim Walberg; John R. Moolenaar; Debbie Dingell; Jack Bergman; Haley M. Stevens; Rashida Tlaib; Lisa C. McClain; Hillary J. Scholten; John James; Shri Thanedar; Tom Barrett; Kristen McDonald Rivet

**federal officials — MN (8):** Betty McCollum; Tom Emmer; Angie Craig; Ilhan Omar; Pete Stauber; Michelle Fischbach; Brad Finstad; Kelly Morrison

**federal officials — MO (8):** Emanuel Cleaver; Sam Graves; Ann Wagner; Jason Smith; Mark Alford; Eric Burlison; Wesley Bell; Robert F. Onder, Jr.

**federal officials — MS (4):** Bennie G. Thompson; Trent Kelly; Michael Guest; Mike Ezell

**federal officials — MT (2):** Ryan K. Zinke; Troy Downing

**federal officials — NC (14):** Virginia Foxx; Richard Hudson; Alma S. Adams; David Rouzer; Gregory F. Murphy; Deborah K. Ross; Donald G. Davis; Valerie P. Foushee; Chuck Edwards; Addison P. McDowell; Mark Harris; Pat Harrigan; Brad Knott; Tim Moore

**federal officials — ND (1):** Julie Fedorchak

**federal officials — NE (3):** Adrian Smith; Don Bacon; Mike Flood

**federal officials — NH (1):** Chris Pappas

**federal officials — NJ (12):** Frank Pallone, Jr.; Christopher H. Smith; Donald Norcross; Bonnie Watson Coleman; Josh Gottheimer; Jefferson Van Drew; Thomas H. Kean, Jr.; Robert Menendez; LaMonica McIver; Herbert C. Conaway, Jr.; Nellie Pou; Analilia Mejia

**federal officials — NM (3):** Teresa Leger Fernandez; Melanie A. Stansbury; Gabe Vasquez

**federal officials — NV (4):** Mark E. Amodei; Dina Titus; Steven Horsford; Susie Lee

**federal officials — NY (26):** Yvette D. Clarke; Gregory W. Meeks; Jerrold Nadler; Paul Tonko; Nydia M. Velázquez; Grace Meng; Hakeem S. Jeffries; Elise M. Stefanik; Adriano Espaillat; Joseph D. Morelle; Alexandria Ocasio-Cortez; Andrew R. Garbarino; Nicole Malliotakis; Ritchie Torres; Claudia Tenney; Patrick Ryan; Nick LaLota; Daniel S. Goldman; Michael Lawler; Nicholas A. Langworthy; Thomas R. Suozzi; Timothy M. Kennedy; Laura Gillen; George Latimer; Josh Riley; John W. Mannion

**federal officials — OH (15):** Jim Jordan; Marcy Kaptur; Robert E. Latta; Michael R. Turner; Joyce Beatty; David P. Joyce; Warren Davidson; Troy Balderson; Shontel M. Brown; Mike Carey; Greg Landsman; Max L. Miller; Emilia Strong Sykes; Michael A. Rulli; David J. Taylor

**federal officials — OK (5):** Tom Cole; Frank D. Lucas; Kevin Hern; Stephanie I. Bice; Josh Brecheen

**federal officials — OR (6):** Suzanne Bonamici; Cliff Bentz; Val T. Hoyle; Andrea Salinas; Maxine Dexter; Janelle S. Bynum

**federal officials — PA (17):** Mike Kelly; Glenn Thompson; Scott Perry; Brendan F. Boyle; Dwight Evans; Brian K. Fitzpatrick; Lloyd Smucker; Mary Gay Scanlon; Madeleine Dean; Chrissy Houlahan; Daniel Meuser; John Joyce; Guy Reschenthaler; Summer L. Lee; Christopher R. Deluzio; Ryan Mackenzie; Robert P. Bresnahan, Jr.

**federal officials — RI (2):** Seth Magaziner; Gabe Amo

**federal officials — SC (7):** James E. Clyburn; Joe Wilson; Ralph Norman; William R. Timmons IV; Nancy Mace; Russell Fry; Sheri Biggs

**federal officials — SD (1):** Dusty Johnson

**federal officials — TN (9):** Steve Cohen; Scott DesJarlais; Charles J. "Chuck" Fleischmann; David Kustoff; Tim Burchett; John W. Rose; Diana Harshbarger; Andrew Ogles; Matt Van Epps

**federal officials — TX (37):** John R. Carter; Henry Cuellar; Lloyd Doggett; Al Green; Michael T. McCaul; Randy K. Weber, Sr.; Joaquin Castro; Roger Williams; Marc A. Veasey; Brian Babin; Vicente Gonzalez; Jodey C. Arrington; Michael Cloud; Dan Crenshaw; Lance Gooden; Lizzie Fletcher; Veronica Escobar; Chip Roy; Sylvia R. Garcia; Pete Sessions; Pat Fallon; August Pfluger; Ronny Jackson; Troy E. Nehls; Beth Van Duyne; Jake Ellzey; Nathaniel Moran; Keith Self; Morgan Luttrell; Monica De La Cruz; Jasmine Crockett; Greg Casar; Wesley Hunt; Craig A. Goldman; Brandon Gill; Julie Johnson; Christian D. Menefee

**federal officials — UT (4):** Blake D. Moore; Burgess Owens; Celeste Maloy; Mike Kennedy

**federal officials — VA (11):** H. Morgan Griffith; Robert C. "Bobby" Scott; Robert J. Wittman; Donald S. Beyer, Jr.; Ben Cline; Jennifer A. Kiggans; Jennifer L. McClellan; John J. McGuire III; Eugene Simon Vindman; Suhas Subramanyam; James R. Walkinshaw

**federal officials — VT (1):** Becca Balint

**federal officials — WA (10):** Rick Larsen; Adam Smith; Suzan K. DelBene; Dan Newhouse; Pramila Jayapal; Kim Schrier; Marilyn Strickland; Marie Gluesenkamp Perez; Michael Baumgartner; Emily Randall

**federal officials — WI (8):** Gwen Moore; Mark Pocan; Glenn Grothman; Bryan Steil; Thomas P. Tiffany; Scott Fitzgerald; Derrick Van Orden; Tony Wied

**federal officials — WV (2):** Carol D. Miller; Riley M. Moore

**federal officials — WY (1):** Harriet M. Hageman

**state legislators — AZ (24):** Alma Hernández; Betty Villegas; Brian Fernandez; Chris Lopez; Chris Mathis; Consuelo Hernandez; David Gowan; Gail Griffin; Kevin Volk; Lupe Diaz; Mariana Sandoval; Michele Peña; Nancy Gutierrez; Priya Sundareshan; Rachel Keshel; Rosanna Gabaldón; Sally Gonzales; Stephanie Stahl Hamilton; Sylvia Allen; Teresa Martinez; T.J. Shope; Vince Leach; Walt Blackman; Wendy Rogers

**state legislators — NH (85):** Barbara Comtois; Beth Richards; Brian Seaworth; Bryan Morse; Cassandra Levesque; Christine Seibert; Clayton Wood; Connie Lane; Cy Aures; Dan McGuire; Dan Innis; Dave Nagel; David Preece; David Luneau; Deborah Aylward; Eileen Kelly; Eleana Colby; Eric Gallager; Ernesto Gonzalez; George Grant; Glen Aldrich; Greg Sargent; Greg Hill; Heath Howard; Henry Giasson; Howard Pearl; Jim Spillane; James Roesener; James Newsom; James Gray; Jim MacKay; Jason Osborne; Jessica Grill; Jim Fedolfi; Jim Guzofski; Jim Creighton; Joe Alexander; John Leavitt; John Sellers; Jose Cambrils; Judy Aron; Juliet Harvey-Bolia; Karen Ebel; Keith Erf; Keith Murphy; Kevin Verville; Len Turcotte; Lex Berezhny; Linda DiSilvestro; Louise Andrus; Mary Jane Wallner; Mary Murphy; Matt Wilhelm; Matthew Pitaro; Matthew Hicks; Merryl Gibbs; Mike Moffett; Muriel Hall; Pat Long; Paul Terry; Paul Tudor; Peter Mehegan; Peter Varney; Riché Colcombe; Rick Devoid; Russ Dumais; Ruth Ward; Scott Bryer; Sharon Carson; Sherri Reinfurt; Stephanie Payeur; Stephen Boyd; Steve Kesselring; Sue Prentiss; Tara Reardon; Tom Schamberg; Thomas Walsh; Timothy Soucy; Tim Lang; Tom Ploszaj; Tony Caplan; Tracy Bricchi; Travis Corcoran; Travis Toner; Yury Polozov

**state legislators — NJ (21):** Al Barlas; Alixon Collazos-Gill; Andrew Macurdy; Tony Bucco; Aura Dunn; Brian Bergen; Chris DePhillips; Dawn Fantasia; Doug Steinhardt; Erik Peterson; Jay Webber; John DiMaio; John McKeon; Jon Bramnick; Joe Pennacchio; Kristin Corrado; Marisa Sweeney; Mike Inganamort; Parker Space; Rosy Bagolie; Vinnie Kearney

**curated local rosters — AZ (32):** Dr. Ravi Shah; Natalie Luna Rose; Jennifer Eckstrom; Val Romero; Sadie Shaw; Rex Scott; Dr. Matt Heinz; Jennifer Allen; Steve Christy; Andrés Cano; Regina Romero; Lane Santa Cruz; Paul Cunningham; Kevin Dahl; Nikki Lee; Selina Barajas; Miranda Schubert; Allison Pratt; Callie Tippett; Jen Anderson; Ed Buster; Chris King; Beki Quintero; Ted Rodriquez; Edgar Bustamante; Consuelo Hernandez; Roberto Jaramillo; Vicki Cox Golder; Matt Kopec; Deanna Day; Michael Gemma; Susan Zibrat

**curated local rosters — NH (15):** Kristen Schultz; Scott Wheeler; Sandra Warde; Alison Mastin; Kristen Schultz; James MacKenna; David Keith; Art Bobruff; Patrick McGowan; Paul Lakevicius; Nancy Glynn; Eric Gregoire; Stuart D. Trachy; David M. Lovlien; Stephen Shurtleff

**curated local rosters — NJ (24):** Joseph Jackson; Howard Morrison; Jonathan Sackett; Adam Salberg; Pawel Wojtowicz; Susan Fahrman Royek; John J. Quinn; Sophia Freire; Emanuel Friedlander; Tucker Kelley; Stephen H. Shaw; John Krickus; Douglas R. Cabana; Thomas J. Mastrangelo; Christine Myers; Tayfun Selen; Deborah Smith; Alison McGeary; Noël Anderson; Lisa Mezik; Jacalyn Richardson; Jemila Ann Tourne; Jamie Gorman; Rachael Brookes
