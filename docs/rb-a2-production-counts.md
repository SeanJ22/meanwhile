# Place map counts by state

Read-only production identities and published Census memberships were imported into a disposable PostgreSQL 17.11 copy. No production writes occurred. These are the actual Admin query results from that copy, not a claim that the map is deployed. The baseline was read on October 24, 2026 from tiny-hill-13996172 / br-delicate-lab-ax02xuo5 as readonly.

Mapped places have a boundary record, including explicitly marked county attachments. Every held entity ID remains available, including historical IDs without a current map record. The Census unassigned ZCTA codes 00000 and 99999 establish no membership. ZIP and ZCTA counts use state memberships, so a shared tribal area cannot assign another state’s ZIPs to its filing state.

Gains count distinct additional ZIP–district links for congressional, legislative, school and special districts, compared with both ordinary and fringe links in the September 23 ZIP index. They include postal ZIP links acquired from the separately held postal mapping. A new map year for an already held district ID is retained separately and is not counted as a new district ID.

| State | Held place IDs before | Mapped places | ZIPs | ZCTAs | County attachments | Gained district links | cd:120 shapes |
|---|---:|---:|---:|---:|---:|---:|---:|
| AK | 761 | 776 | 278 | 245 | 17 | 1,077 | 1 |
| AL | 1,433 | 1,769 | 841 | 658 | 336 | 9,527 | 7 |
| AR | 2,237 | 3,048 | 717 | 620 | 588 | 13,242 | 4 |
| AS | 117 | 101 | 1 | 1 | 0 | 1 | 1 |
| AZ | 1,033 | 1,194 | 572 | 420 | 161 | 17,895 | 9 |
| CA | 3,823 | 6,211 | 2,656 | 1,808 | 2,384 | 144,760 | 52 |
| CO | 3,531 | 4,213 | 665 | 530 | 678 | 21,398 | 8 |
| CT | 794 | 1,376 | 438 | 288 | 397 | 17,258 | 5 |
| DC | 64 | 61 | 296 | 57 | 1 | 311 | 1 |
| DE | 203 | 445 | 100 | 70 | 253 | 6,453 | 1 |
| FL | 1,868 | 3,140 | 1,468 | 1,013 | 1,275 | 50,030 | 28 |
| GA | 1,884 | 2,230 | 974 | 752 | 355 | 8,500 | 14 |
| GU | 79 | 91 | 17 | 7 | 0 | 9 | 1 |
| HI | 357 | 384 | 136 | 97 | 17 | 905 | 2 |
| IA | 3,275 | 3,608 | 1,066 | 972 | 324 | 10,346 | 4 |
| ID | 1,151 | 1,443 | 332 | 287 | 290 | 4,887 | 2 |
| IL | 4,758 | 7,433 | 1,588 | 1,397 | 2,647 | 78,680 | 17 |
| IN | 2,780 | 3,088 | 991 | 807 | 304 | 9,127 | 9 |
| KS | 2,881 | 4,191 | 763 | 710 | 1,339 | 21,325 | 4 |
| KY | 1,659 | 1,844 | 969 | 782 | 185 | 5,565 | 6 |
| LA | 1,361 | 1,462 | 725 | 540 | 96 | 4,423 | 6 |
| MA | 1,408 | 1,555 | 699 | 540 | 335 | 20,816 | 9 |
| MD | 1,013 | 1,156 | 623 | 478 | 154 | 4,573 | 8 |
| ME | 1,284 | 1,383 | 487 | 427 | 134 | 6,095 | 2 |
| MI | 3,230 | 3,476 | 1,170 | 993 | 340 | 12,791 | 13 |
| MN | 4,350 | 4,816 | 1,038 | 887 | 478 | 15,699 | 8 |
| MO | 3,352 | 5,061 | 1,179 | 1,040 | 1,710 | 36,594 | 8 |
| MP | 161 | 154 | 3 | 3 | 0 | 3 | 1 |
| MS | 1,286 | 1,566 | 533 | 428 | 314 | 5,892 | 4 |
| MT | 1,607 | 2,038 | 408 | 373 | 439 | 7,278 | 2 |
| NC | 2,244 | 2,518 | 1,088 | 853 | 265 | 8,108 | 14 |
| ND | 2,799 | 3,165 | 420 | 400 | 367 | 8,010 | 1 |
| NE | 2,621 | 3,497 | 627 | 592 | 854 | 15,742 | 3 |
| NH | 762 | 861 | 284 | 247 | 110 | 4,276 | 2 |
| NJ | 1,947 | 2,157 | 731 | 598 | 203 | 10,321 | 12 |
| NM | 966 | 1,687 | 436 | 379 | 734 | 18,207 | 3 |
| NV | 384 | 493 | 254 | 182 | 108 | 2,952 | 4 |
| NY | 3,531 | 4,500 | 2,199 | 1,826 | 972 | 51,731 | 26 |
| OH | 3,743 | 4,402 | 1,441 | 1,233 | 661 | 23,456 | 15 |
| OK | 1,954 | 2,509 | 779 | 666 | 554 | 11,007 | 5 |
| OR | 1,128 | 1,934 | 494 | 430 | 809 | 16,278 | 6 |
| PA | 5,520 | 6,931 | 2,208 | 1,833 | 1,406 | 71,611 | 17 |
| PR | 1,321 | 1,363 | 178 | 132 | 0 | 620 | 1 |
| RI | 260 | 319 | 91 | 81 | 56 | 2,064 | 2 |
| SC | 1,092 | 1,301 | 540 | 424 | 209 | 6,513 | 7 |
| SD | 2,177 | 2,583 | 420 | 401 | 398 | 7,275 | 1 |
| TN | 1,830 | 2,086 | 803 | 643 | 234 | 6,626 | 9 |
| TX | 5,944 | 7,176 | 2,646 | 1,992 | 1,502 | 51,646 | 38 |
| UT | 692 | 897 | 353 | 303 | 220 | 6,075 | 4 |
| VA | 1,670 | 1,875 | 1,244 | 907 | 186 | 5,945 | 11 |
| VI | 41 | 39 | 15 | 6 | 0 | 6 | 1 |
| VT | 835 | 859 | 309 | 265 | 145 | 5,194 | 1 |
| WA | 1,822 | 2,606 | 733 | 606 | 787 | 21,016 | 10 |
| WI | 3,373 | 4,046 | 894 | 783 | 656 | 16,610 | 8 |
| WV | 900 | 1,132 | 860 | 741 | 226 | 7,694 | 2 |
| WY | 750 | 1,108 | 194 | 180 | 358 | 4,995 | 1 |

All 56 jurisdictions have mapped places. There are 131,357 mapped places, 919,438 additional ZIP–district links and 441 cd:120 shapes. County attachments locate a district at its host county; they do not establish its service boundary.

Preservation checks found no missing link in the September 23 ordinary/fringe index or the held production Census congressional and legislative memberships (33,931 representation and 33,933 election state/ZIP comparisons). All 41,831 postal ZIP lookups returned memberships; maximum 17.33 ms, median 1.45 ms, p99 5.32 ms in the isolated native PostgreSQL copy. Admin reads the same state totals from the importer's count cache in 6.69 ms.
