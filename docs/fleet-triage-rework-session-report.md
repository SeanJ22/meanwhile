## Fleet triage rework: session report

Branch `claude/admin-status-display-rework-1b78ae`, not merged.
Design handoff: `docs/design/fleet-triage-wiring.md` (corrected WIRING.md, committed).
Work follows WIRING.md sections in the recommended order.

### Completed (all nine WIRING.md items)

| Commit | Section | What changed |
| --- | --- | --- |
| `0456ab66` | S5 | Mount DecisionQueue on fleet page with shared pulseRevision |
| `e891ed19` | S6a | Render all OwnerDecisionCard fields; blockedDescendants prints "not measured" |
| `46c18416` | S6b | Opened as tracker row D74 (schema question: does the tracker store which decision a work item waits on?) |
| `068b6054` | S1 | Scope deferral counters to the lane they cover (was summing two lanes, printing four zeros) |
| `77a978ec` | S2 | Show stage counts against their 7-item denominator, scope statement first |
| `98f7b72f` | S3 | Label the two clocks (fleet read vs runner heartbeat), surface the gap when > HEARTBEAT_LATE_MINUTES |
| `daee9935` | S4 | Show read age in human terms ("34 minutes ago"), state "Nothing re-reads this page" |
| `af67bf51` | S7 | Fleet decisions first as interactive queue; non-fleet 43 as four summary cards after a divider |
| `01a32470` | S7 | Reworked: fleet-first grouping (NH/D/ASK/NW/R prefixes), non-fleet as summary cards by category |
| `7f88debb` | S8 | Sort operations by lastActivity.at (oldest first), add subject search |
| `2494b88f` | S9 | Split panels into "Reads something" (3) and "No producer" (3) with dashed teal rim |
| `c36cc320` | -- | Corrected WIRING.md committed to repo at docs/design/fleet-triage-wiring.md |

### Files touched

- `app/(admin)/admin/fleet/page.tsx` -- two-clock strip (S3), server-side data plumbing
- `app/(admin)/layout.tsx` -- two-clock CSS in @layer ce-recipe
- `components/admin/fleet-operations-map.tsx` -- S1, S2, S4, S7, S8, S9 (the client component carrying most of the page)
- `lib/control-plane/research-progress-health.ts` -- S1 (per-lane deferral counts), S2 (denominator)
- `docs/design/fleet-triage-wiring.md` -- corrected WIRING.md with S3 path fix

### S7 grouping logic

Fleet rowIds: `NH*`, `D\d*`, `ASK*`, `NW*`, `R\d*`. Everything else is non-fleet,
bucketed into four summary-card categories:

| Category | Prefixes |
| --- | --- |
| Commercial and product | C, V, X, PB |
| Business, legal and trust | B, T |
| Design and console calls | NS |
| Defect reports | OWN |

Fleet decisions render through the full interactive DecisionQueue. Non-fleet
render as count-only summary cards after a divider.

### What S6b needs before it can start

D74 is open. The question: does the tracker record which decision a work item
is waiting on? If not, adding that link is a schema change and comes before
the `blockedDescendants` count can be produced. The "not measured" placeholder
is shipped (S6a); the backend work is separate.

### Design rules held throughout

- Zero never stands in for unknown. Every unknown prints "not measured" or its
  named gap.
- No working-looking control for a non-existent action. Disabled controls show
  the proposed action id.

### Not started (out of scope per the handoff)

- The four triage bands (red/amber/green/no-producer)
- Tab strip (Triage, Work in flight, Decisions, Panels, Blind spots)
- Record-class families and the "shape of the other 2 614"
- The worked decision card (R08 demonstration)
- The Blind spots tab with copy-brief buttons

These are design-level additions beyond the nine wiring items.
