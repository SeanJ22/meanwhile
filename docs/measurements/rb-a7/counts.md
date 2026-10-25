# Production counts by state

Read-only production baseline at 2026-10-25 03:11 UTC, followed by state-scoped ZIP identity checks. Entity columns count stored identities; people are not a count of visible officials. ZIP columns count held shard memberships, including fringe divisions. A ZIP crossing a state line appears in each touched state. US includes the national place with a null state.

The **ZIP pages planned** column comes from an exhaustive local run of the current seeder against the existing postal, centroid and ZIP-division assets. Its fake Query counts 41,945 emitted ZIP subjects and 379,277 division dependency edges, with zero database connections, database mutations or network attempts. All 41,945 supported routable ZIPs with a point receive a planned page, including all 114 without a division entry; missing planned pages are zero in every state. These are planned identities, not built or content-checked pages. Body dependencies were omitted from this local count. See [the local ZIP plan](zip-page-plan.json).

These are inventory and identity checks, not full ZIP-page content parity. The production baseline has no built pages. Full content parity is proven for two copied ZIPs in Arizona; every other ZIP remains unverified.

| State | Place identities | Body identities | Person identities | Meeting identities | ZIP touches | ZIP division identities | Missing identities | ZIPs without a division shard | ZIP pages planned | Ready pages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 761 | 141 | 422 | 371 | 245 | 467 | 0 | 3 | 281 | 0 |
| AL | 1433 | 289 | 633 | 165 | 658 | 1272 | 0 | 0 | 839 | 0 |
| AR | 2237 | 152 | 573 | 60 | 619 | 2093 | 0 | 0 | 711 | 0 |
| AS | 117 | 0 | 44 | 0 | 1 | 97 | 0 | 0 | 1 | 0 |
| AZ | 1033 | 977 | 979 | 1376 | 420 | 941 | 0 | 1 | 569 | 0 |
| CA | 3823 | 1913 | 3617 | 2673 | 1808 | 3531 | 0 | 6 | 2657 | 0 |
| CO | 3531 | 345 | 636 | 2254 | 530 | 2416 | 0 | 0 | 663 | 0 |
| CT | 794 | 222 | 878 | 1674 | 288 | 595 | 0 | 0 | 438 | 0 |
| DC | 64 | 6 | 78 | 0 | 57 | 50 | 0 | 0 | 296 | 0 |
| DE | 203 | 52 | 266 | 9 | 68 | 126 | 0 | 0 | 98 | 0 |
| FL | 1868 | 783 | 1914 | 2658 | 1013 | 1624 | 0 | 27 | 1495 | 0 |
| GA | 1884 | 258 | 994 | 162 | 752 | 1621 | 0 | 0 | 973 | 0 |
| GU | 79 | 0 | 0 | 0 | 7 | 78 | 0 | 1 | 18 | 0 |
| HI | 357 | 71 | 320 | 64 | 97 | 212 | 0 | 5 | 141 | 0 |
| IA | 3275 | 76 | 547 | 84 | 972 | 3119 | 0 | 0 | 1064 | 0 |
| ID | 1151 | 155 | 826 | 286 | 287 | 1062 | 0 | 1 | 326 | 0 |
| IL | 4758 | 437 | 1129 | 912 | 1397 | 4553 | 0 | 2 | 1589 | 0 |
| IN | 2780 | 32 | 563 | 0 | 807 | 2615 | 0 | 0 | 991 | 0 |
| KS | 2881 | 13 | 714 | 0 | 710 | 2676 | 0 | 0 | 757 | 0 |
| KY | 1659 | 30 | 469 | 3 | 782 | 1512 | 0 | 0 | 966 | 0 |
| LA | 1361 | 0 | 342 | 0 | 540 | 1197 | 0 | 1 | 725 | 0 |
| MA | 1408 | 113 | 729 | 689 | 540 | 989 | 0 | 6 | 704 | 0 |
| MD | 1013 | 314 | 1019 | 20 | 478 | 875 | 0 | 0 | 622 | 0 |
| ME | 1284 | 29 | 889 | 223 | 427 | 1034 | 0 | 2 | 489 | 0 |
| MI | 3230 | 169 | 1280 | 417 | 993 | 2920 | 0 | 1 | 1170 | 0 |
| MN | 4350 | 78 | 1029 | 1833 | 887 | 4096 | 0 | 0 | 1032 | 0 |
| MO | 3352 | 470 | 1273 | 1734 | 1040 | 3145 | 0 | 0 | 1174 | 0 |
| MP | 161 | 0 | 72 | 0 | 3 | 135 | 0 | 0 | 3 | 0 |
| MS | 1286 | 10 | 505 | 30 | 428 | 1071 | 0 | 1 | 533 | 0 |
| MT | 1607 | 6 | 516 | 0 | 373 | 1432 | 0 | 1 | 405 | 0 |
| NC | 2244 | 178 | 1430 | 1232 | 853 | 2049 | 0 | 3 | 1091 | 0 |
| ND | 2799 | 13 | 869 | 0 | 400 | 2691 | 0 | 0 | 408 | 0 |
| NE | 2621 | 0 | 201 | 0 | 592 | 2538 | 0 | 0 | 621 | 0 |
| NH | 762 | 676 | 997 | 484 | 247 | 554 | 0 | 0 | 283 | 0 |
| NJ | 1947 | 737 | 743 | 1067 | 598 | 1846 | 0 | 1 | 732 | 0 |
| NM | 966 | 80 | 799 | 183 | 379 | 811 | 0 | 0 | 430 | 0 |
| NV | 384 | 56 | 423 | 200 | 182 | 286 | 0 | 2 | 254 | 0 |
| NY | 3531 | 187 | 1141 | 551 | 1826 | 3261 | 0 | 10 | 2209 | 0 |
| OH | 3743 | 149 | 758 | 1511 | 1234 | 3583 | 0 | 8 | 1448 | 0 |
| OK | 1954 | 57 | 556 | 426 | 666 | 1770 | 0 | 0 | 777 | 0 |
| OR | 1129 | 100 | 456 | 226 | 430 | 1014 | 0 | 0 | 492 | 0 |
| PA | 5520 | 36 | 778 | 199 | 1833 | 5247 | 0 | 5 | 2213 | 0 |
| PR | 1321 | 0 | 164 | 0 | 132 | 1270 | 0 | 1 | 179 | 0 |
| RI | 260 | 9 | 393 | 47 | 81 | 144 | 0 | 0 | 91 | 0 |
| SC | 1092 | 8 | 775 | 9 | 424 | 905 | 0 | 0 | 540 | 0 |
| SD | 2177 | 9 | 351 | 58 | 401 | 2097 | 0 | 0 | 394 | 0 |
| TN | 1830 | 10 | 549 | 4 | 639 | 1685 | 0 | 0 | 798 | 0 |
| TX | 5944 | 551 | 3087 | 3106 | 1992 | 5280 | 0 | 17 | 2660 | 0 |
| US | 1 | 21 | 0 | 16 | 0 | 0 | 0 | 0 | 0 | 0 |
| UT | 692 | 16 | 518 | 115 | 303 | 560 | 0 | 1 | 350 | 0 |
| VA | 1670 | 102 | 1481 | 1590 | 905 | 1513 | 0 | 0 | 1240 | 0 |
| VI | 41 | 1 | 70 | 0 | 6 | 34 | 0 | 1 | 16 | 0 |
| VT | 835 | 12 | 736 | 0 | 265 | 583 | 0 | 0 | 309 | 0 |
| WA | 1822 | 95 | 762 | 1341 | 606 | 1672 | 0 | 1 | 733 | 0 |
| WI | 3373 | 1030 | 2856 | 3747 | 783 | 3219 | 0 | 4 | 898 | 0 |
| WV | 900 | 34 | 633 | 113 | 741 | 780 | 0 | 0 | 857 | 0 |
| WY | 750 | 26 | 325 | 143 | 180 | 625 | 0 | 2 | 192 | 0 |

All 56 state, DC and territory buckets plus US are listed, including zero counts. The ZIP identity comparison covers 93,571 state/division identities and 33,925 state/ZIP touches with zero missing identities. The national inventory holds 104,048 place identities.

Local postal and centroid files identify 114 routable ZIPs without a division shard in 27 states and territories. Initial preparation includes their existing empty-selection answers and any held territory bodies. This enumeration uses no database or network reads; see [the local ZIP counts](zip-empty-selection-counts.json).

## Member and roster inventories

Counts-only production snapshot at 2026-10-25 08:50:36 UTC, separate from the earlier identity inventory above. The single backend request used role `readonly`, a read-only repeatable-read transaction and a 60-second statement timeout. It returned 57 count rows and no member, person, fact-value or payload records. [The result and byte measurements](member-inventory-counts.json) preserve the exact scope and the earlier local guard failure, which sent no request.

Each column is a separate stored inventory. Distinct member IDs are the nonempty IDs after `member:` in live fact fields, grouped by their owning entity's state; aliases are not merged. Runtime roster counts are membership entries, executives are array entries, and candidacy holders are bridge entries with a holder. These are not deduplicated people, visible official totals or nationwide ZIP-page parity, and the columns should not be added together. Other people sources and the retired country-wide runtime aggregate are excluded.

All 56 supported state/DC/territory runtime pointers contain the three counted fields, including empty arrays. US has no canonical pointer in this scope and is marked absent. For example, NH has no live member facts but does have 87 runtime roster entries; the table retains both storage families.

| State | Live member facts | Distinct raw member IDs | Runtime roster members | Statewide executive entries | Candidacy holder entries | Runtime projection |
|---|---:|---:|---:|---:|---:|---|
| AK | 177 | 142 | 0 | 0 | 3 | Present |
| AL | 208 | 178 | 0 | 0 | 155 | Present |
| AR | 69 | 69 | 0 | 0 | 127 | Present |
| AS | 0 | 0 | 0 | 0 | 1 | Present |
| AZ | 421 | 346 | 62 | 10 | 84 | Present |
| CA | 5286 | 2970 | 0 | 0 | 156 | Present |
| CO | 377 | 164 | 0 | 0 | 99 | Present |
| CT | 264 | 222 | 0 | 0 | 195 | Present |
| DC | 0 | 0 | 0 | 0 | 1 | Present |
| DE | 29 | 29 | 0 | 0 | 56 | Present |
| FL | 1526 | 1131 | 0 | 0 | 167 | Present |
| GA | 228 | 180 | 0 | 0 | 255 | Present |
| GU | 0 | 0 | 0 | 0 | 1 | Present |
| HI | 27 | 27 | 0 | 0 | 4 | Present |
| IA | 65 | 65 | 0 | 0 | 131 | Present |
| ID | 57 | 57 | 0 | 0 | 43 | Present |
| IL | 1265 | 509 | 0 | 0 | 66 | Present |
| IN | 44 | 44 | 0 | 0 | 137 | Present |
| KS | 10 | 10 | 0 | 0 | 8 | Present |
| KY | 94 | 24 | 0 | 0 | 127 | Present |
| LA | 0 | 0 | 0 | 0 | 8 | Present |
| MA | 71 | 11 | 0 | 0 | 14 | Present |
| MD | 123 | 40 | 0 | 0 | 187 | Present |
| ME | 60 | 52 | 0 | 0 | 191 | Present |
| MI | 364 | 261 | 0 | 0 | 55 | Present |
| MN | 261 | 45 | 0 | 0 | 194 | Present |
| MO | 941 | 602 | 0 | 0 | 181 | Present |
| MP | 0 | 0 | 0 | 0 | 1 | Present |
| MS | 4 | 4 | 0 | 0 | 6 | Present |
| MT | 1 | 1 | 0 | 0 | 129 | Present |
| NC | 126 | 63 | 0 | 0 | 16 | Present |
| ND | 10 | 10 | 0 | 0 | 77 | Present |
| NE | 0 | 0 | 0 | 0 | 7 | Present |
| NH | 0 | 0 | 87 | 1 | 92 | Present |
| NJ | 88 | 88 | 153 | 2 | 169 | Present |
| NM | 321 | 246 | 0 | 0 | 75 | Present |
| NV | 225 | 161 | 0 | 0 | 63 | Present |
| NY | 339 | 209 | 0 | 0 | 241 | Present |
| OH | 175 | 99 | 0 | 0 | 134 | Present |
| OK | 244 | 107 | 0 | 0 | 78 | Present |
| OR | 21 | 12 | 0 | 0 | 84 | Present |
| PA | 35 | 21 | 0 | 0 | 165 | Present |
| PR | 0 | 0 | 0 | 0 | 1 | Present |
| RI | 0 | 0 | 0 | 0 | 8 | Present |
| SC | 8 | 8 | 0 | 0 | 135 | Present |
| SD | 0 | 0 | 0 | 0 | 110 | Present |
| TN | 3 | 3 | 0 | 0 | 12 | Present |
| TX | 870 | 612 | 0 | 0 | 205 | Present |
| US | 0 | 0 | 0 | 0 | 0 | Absent |
| UT | 27 | 27 | 0 | 0 | 6 | Present |
| VA | 149 | 111 | 0 | 0 | 13 | Present |
| VI | 0 | 0 | 0 | 0 | 1 | Present |
| VT | 2 | 2 | 0 | 0 | 7 | Present |
| WA | 290 | 154 | 0 | 0 | 12 | Present |
| WI | 3361 | 2259 | 0 | 0 | 30 | Present |
| WV | 0 | 0 | 0 | 0 | 4 | Present |
| WY | 15 | 15 | 0 | 0 | 84 | Present |

The parsed count rows serialize to 18,609 bytes. The observed request body was 4,423 bytes and the decoded HTTP response body was 4,390 bytes, totalling 8,813 bytes before headers; these are body/JSON measurements, not exact provider billing. No database row was changed.
