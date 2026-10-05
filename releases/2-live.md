# Release 2 (ecf4026) live check

- **Merged:** 18:07:38Z (#708). **Deployed:** `/api/build` reported ecf4026 at 18:09:53Z, before hour 36 (18:10Z). **Post-deploy integrity:** run 37353604926 succeeded (reused, not dispatched).
- **Runner adoption:** pending. At 18:16Z the heartbeat still ran dcddcf5 (cycle started 18:10Z).

| Step | State | Evidence |
|---|---|---|
| CP-01 | **Checked live** | Browser, production ecf4026, 18:12–18:15Z. Ballot pages at 03255, 03101, 07866, 07960 and 85701: 0 of 321 filed street addresses in page text or any JSON/RSC response (Morris candidates Selen and Russo render). Ask at 07866, "How do I contact Tayfun Selen?": email and phone, no address. Ask at 03255, governor candidates: names, no address. |
| CP-19 | Built, proving over time | Takes effect on the next publication pass once the runner adopts ecf4026. |
| BR-01…BR-37, CH-12, CH-14 | Screen not yet checked | Need Admin (Google sign-in). BR-05 and BR-16/37 also wait on hunters' runner hooks. |
| CH-08, CH-09, CH-13, CH-29, CH-30, BX-09, DB-30, DB-06 net, DB-10, DB-11, DB-23 | Deployed, live check pending | Runner-side; check after adoption. |

Reader-wide caveat: reader pages still serve the 2026-09-29 snapshot (manifest seq 2979) until the runner's reader-edge store points at the live site. That needs Sean (releases/stale-reader-snapshot.md).
