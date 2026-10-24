# Owed list

A resident's missing information stays visible to Admin and the hunters. Each verified fact continues to publish independently.

Remaining work, owned by RB-A6:

- Build the editable kind/field table and reuse the existing setting history and undo.
- Connect state totals and one-place held/missing reads to the place map, facts and blanks. Depends on RB-A2's map contract.
- Verify SQL counts for every state, ten places in ten states, the next scheduled read, and live reader preservation.
- Merge River after its integration record includes RB-A2, rerun checks, push READY, and handle River's live-check return.

Base: `origin/river` at `21ae9bcfb`. RB-A2 was absent from origin at the first fetch. Production reads use only `readonly` on the reader branch and `wtp_cp_release_readonly` on the control-plane branch. The history table had zero rows at the initial read.
