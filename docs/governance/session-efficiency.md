# SESSION EFFICIENCY LAW — OWNER DIRECTIVE

*Adopted verbatim as an owner directive by RULING 237; the adoption record in the
ledger carries the adoption date and context. Since 2026-09-25 Sean's standing
decisions are `docs/rulings.md` (carried into autonomous-system briefs by the
generated `docs/governance/constitution.md`), and this directive, like every
older ruling, is historical evidence rather than an independently active
instruction. The text below the line is unchanged.*

---

This project is moving very quickly. Rigor remains mandatory, but brute-force verification, redundant model work, and avoidable serial waiting are prohibited.

The goal is:

MAXIMUM VERIFIED PROGRESS PER WALL-CLOCK MINUTE, MODEL TOKEN, AND HUMAN ATTENTION.

Efficiency never means weakening proof. It means choosing the cheapest, fastest, most deterministic way to obtain the same or stronger proof.

## 1. PARALLELISM FOLLOWS INDEPENDENCE — NOT A FIXED HEADCOUNT

Use as many concurrent workers as there are genuinely independent work units whose inputs, outputs, and mutable resources do not conflict.

High fan-out is encouraged when work is embarrassingly parallel, including:

* independent states, counties, municipalities, jurisdictions, bodies, candidates, filing authorities, or source routes;
* separate documents or publisher surfaces;
* independent acquisition obligations;
* isolated research questions with typed outputs;
* worktrees with clearly separated file ownership.

Fifty workers walking fifty independent county filing authorities can be better than five workers doing them serially. Do not artificially constrain productive concurrency.

High fan-out is not justified when workers:

* answer substantially the same question;
* inspect substantially the same evidence;
* mutate the same files or generated artifacts;
* compete for the same database rows, server, browser, port, credential, or provider budget;
* depend immediately on one another's output;
* create a large serial reconciliation burden for one integration owner;
* are launched merely to increase confidence by repetition.

Before fan-out, partition the problem into independent units.

Every worker must have:

distinct question → distinct owned output → defined completion condition

If those cannot be stated, the work is probably not independently parallelizable.

Optimize for:

TIME TO INTEGRATED PROOF

not:

NUMBER OF AGENTS LAUNCHED

## 2. VERIFICATION FAN-OUT HAS DIMINISHING RETURNS

Model reviewers are not independent merely because there are many of them.

Ten instances of the same model reading the same files with the same instructions are correlated reviewers, not ten independent sources of truth.

For a normal acceptance claim:

primary deterministic/evidence proof + one genuinely adversarial independent check

is normally sufficient.

Additional reviewers are justified only when:

* the first two disagree;
* materially different evidence sources exist;
* the claim is unusually high-risk or irreversible;
* one reviewer discovered a specific unresolved uncertainty;
* the directive explicitly calls for broader sampling.

Do not launch a 20/40/60-agent jury merely because implementation is complete and confidence is desired.

If the claim can be answered by SQL, a schema invariant, a browser assertion, a provider readback, a hash, a source denominator, or a deterministic test, use that instead of model voting.

## 3. DO NOT RE-AUDIT THE WHOLE PROJECT

Start from:

* current `main`;
* the current directive;
* canonical governance;
* generated status;
* current frontier;
* proving artifacts and current test results.

Do not reconstruct the entire project history at the beginning of every session.

A prior claim with a current proving check/artifact is inherited provisionally.

Reopen it only when:

* this session changes a dependency underneath it;
* its current check fails;
* contradictory evidence appears;
* its proving artifact is stale or invalid;
* the directive explicitly requires re-proof.

“Be thorough” does not mean “start over.”

## 4. ACCEPTANCE CRITERIA ARE THE SESSION WORK QUEUE

At bootstrap, convert the directive into one finite execution table:

`item → exact acceptance → dependencies → likely files/systems → proving instrument → current state`

That table is the session plan.

Do not replace it with an expanding narrative to-do list.

Every piece of work must answer:

Which acceptance criterion does this advance?

Newly discovered work that does not block the session becomes a durable WorkItem/frontier obligation.

It interrupts current work only if it:

* threatens reader truth;
* creates security/privacy/data-loss risk;
* invalidates an acceptance proof;
* blocks the integration/merge;
* makes continued work materially wasteful.

Interesting adjacent improvements do not automatically become session scope.

## 5. DESIGN THE PROOF BEFORE IMPLEMENTATION

For every acceptance criterion, decide first:

What exact evidence will prove this is done?

Then implement toward that proof.

Do not finish implementation and afterward launch a giant audit because nobody decided how completion would be measured.

Preferred structure:

`acceptance → proving instrument → implementation → instrument passes`

not:

`implementation → claim completion → invent verification campaign`

## 6. USE THE CHEAPEST CAPABILITY THAT CAN SETTLE THE QUESTION

Default preference order:

existing deterministic test
→ targeted deterministic script/query
→ provider/source readback
→ targeted browser assertion
→ one model investigation
→ second independent model/adversary if material uncertainty remains

Do not use a model where ordinary code can answer the question exactly.

Do not use Opus to compare two JSON counters.

Do not use ten agents to inspect whether a migration exists.

Do not use a browser when a direct API/readback proves the exact same thing more strongly.

Conversely, do not substitute a unit test for a reader-visible browser acceptance when the acceptance is explicitly about the rendered product.

Match the instrument to the claim.

## 7. TARGETED TESTS DURING DEVELOPMENT; FULL GATES AT INTEGRATION

Do not run the complete suite after every edit.

During development, run:

* the tests covering the changed contract;
* the relevant generator/check;
* the relevant provider readback;
* targeted walk/browser identities when reader behavior changed.

Full-suite verification belongs at integration boundaries.

Normal pattern:

targeted development checks → integrated head → full gates → repair if needed → final exact-head gates

Another complete run is justified when:

* code changed after the last complete run;
* the prior run failed and the repair touched relevant code;
* the prior result was invalidated by environment/state;
* a specific failure requires broader reproduction.

Never rerun an unchanged green full suite merely for reassurance.

The same applies to `walk:all`.

Use targeted walk identities while developing. Run the full walk against the integrated reader-facing head, not after every local change.

## 8. A FAILURE GETS DIAGNOSED BEFORE IT GETS RERUN

One red run does not authorize repeated reruns.

On failure:

1. identify the exact failing check;
2. inspect its evidence/output;
3. identify what code/state it depends on;
4. determine whether this session changed that dependency;
5. reproduce with the smallest possible command;
6. classify: regression, stale state, environment, race/flake, or instrument defect;
7. repair or record the correct blocker;
8. rerun the smallest proving check;
9. rerun broader gates only when justified.

A flaky test is a defect to isolate.

“Run the full suite again and see whether it passes” is not diagnosis.

## 9. FIX FLAKES; DO NOT MERELY LEARN TO RECOGNIZE THEM

A detector that can distinguish a race from a regression is useful.

But a known race that continues randomly turning the suite red remains a defect.

Where feasible:

* remove shared mutable test state;
* use temporary output locations;
* isolate ports/databases/filesystems;
* serialize the genuinely shared seam;
* make generators pure or destination-parameterized.

Do not normalize repeated false-red gates as an acceptable operating cost.

## 10. NO HUMAN-LOG POLLING AS A COMPLETION PROTOCOL

Background jobs must expose machine-readable completion through:

* process exit;
* durable artifact existence/state;
* structured result record;
* job/provider API status;
* typed database state.

Do not hold worker/task slots with shell loops grepping human-formatted logs for phrases whose whitespace or wording can change.

Human prose is for people.

Machine completion is machine state.

## 11. PARALLEL LANES NEED RESOURCE OWNERSHIP

Every parallel lane must identify:

* files it owns;
* shared files it may only propose changes to;
* database/provider resources it uses;
* ports/processes it owns;
* artifact outputs;
* integration dependencies.

Avoid parallel edits to high-contention central files.

If several lanes must eventually modify one central registry/module:

parallelize their discovery/acquisition,

then serialize the final integration into that seam.

Do not have five agents repeatedly merge/rebase the same central file.

## 12. ONE INTEGRATION OWNER

Parallel workers produce bounded outputs.

One integration owner assembles them into the session head.

The integration owner:

* resolves conflicts;
* verifies typed interfaces;
* ensures outputs are not duplicates;
* runs cross-lane checks;
* owns the final acceptance table.

Workers do not independently declare the session complete.

Workers do not independently merge to `main`.

## 13. MINIMIZE SERIAL RECONCILIATION

Before launching large fan-out, define a typed/common output shape.

For example, fifty jurisdiction workers should return something like:

`jurisdictionId`
`authority`
`sourceUrl`
`permission`
`routeStatus`
`candidateCount`
`artifactIds`
`gap`
`nextAction`

rather than fifty freeform essays.

Large parallelism only remains fast when the results are mechanically combinable.

If the parent must read fifty narrative reports and manually infer their meaning, the parallelism has simply moved the bottleneck.

## 14. LARGE ENUMERATIONS SHOULD BE MASSIVELY PARALLEL WHEN SAFE

Do not serialize state/county/source acquisition merely because earlier sessions used a small number of agents.

When the denominator is known and units are independent:

fan out aggressively.

Examples:

* all county filing authorities in a state;
* municipal clerk source discovery;
* independent candidate campaign-site acquisition;
* source permission audits;
* document classification;
* independent route probes.

Apply shared per-host/per-provider/per-credential rate limits centrally.

Productive parallelism is a feature of the architecture, not something to suppress.

## 15. MODELS HANDLE NOVELTY; CODE HANDLES LEARNED PROCEDURE

Every model-heavy investigation should ask at completion:

Did we learn a stable procedure?

If yes, capture it as:

* deterministic code;
* adapter;
* source method;
* typed rule;
* permanent check;
* generator;
* reusable route.

Do not make future workers pay model tokens to rediscover something the project already learned how to do.

The system should become less model-dependent as it matures, not more.

## 16. COMMENTS EXPLAIN INVARIANTS — NOT THE ENTIRE SESSION

Do not write hundreds of lines of historical narrative into implementation files for small behavioral changes.

Code comments should explain:

* the invariant;
* the non-obvious failure mode;
* why the implementation has an unusual constraint.

Put longer investigations in evidence/audit documents when genuinely useful.

Prefer:

test + typed interface + concise comment

over:

five pages of prose explaining why the code should work.

The codebase must remain readable as the project rapidly grows.

## 17. REPORTING IS NOT ANOTHER RESEARCH PROJECT

Build the final report incrementally from the acceptance table.

Every item ends as exactly one of:

MET
NOT MET
NEEDS_SEAN

with:

* one concise result;
* exact denominator where applicable;
* exact proving pointer;
* any remaining gap.

Do not launch a giant generic “audit the audit” campaign after implementation merely to construct the closeout report.

High-risk claims may receive one independent adversarial verification.

If that verification finds a contradiction, investigate that contradiction specifically.

## 18. SELF-REFUTATION SHOULD BE TARGETED

Adversarial review remains mandatory where it matters.

Its job is not to generate lots of opinions.

Its job is to answer:

What evidence would make this acceptance claim false?

Good adversarial questions include:

* Is the denominator actually authoritative?
* Could this test pass while observing nothing?
* Could this test be reading stale output?
* Could a pilot-derived population be mislabeled statewide?
* Could a browser check miss server-side acquisition?
* Could the claimed model differ from the deployed model?
* Could a passing generator comparison be comparing two outputs from the same incorrect source?

One strong refutation attempt is more useful than twenty generic reviewers.

## 19. DETECT INSTRUMENTS THAT “LOOK AT NOTHING” MECHANICALLY

Where possible, permanent instruments should prove their own denominator/input.

A check should state:

* how many things it examined;
* what universe it expected;
* what source/input it actually read.

Zero rows where rows were expected is not a green check.

A missing source should not silently collapse into an empty successful loop.

Use positive controls/plant checks for important guards so we know they can actually fail.

Once that ability is deterministic, do not repeatedly spend model reviewers re-proving it.

## 20. KEEP ACQUISITION MOVING WHILE ENGINEERING CONTINUES

Do not unnecessarily pause independent acquisition because an engineering lane is busy.

If 40 state/local source obligations can advance while one application seam is being repaired, let them advance.

Conversely, do not launch acquisition that depends on an identity contract currently being rewritten.

The rule is dependency-aware concurrency.

## 21. WALL-CLOCK DISCIPLINE

Periodically inspect the critical path.

Ask:

* Which acceptance criteria turned green since the last checkpoint?
* What is blocking the merge?
* Which workers are on the critical path?
* Which workers are useful but non-blocking?
* Which workers are redundant?
* Which jobs are waiting rather than working?
* Which serial integration step will dominate next?

Stop or redirect redundant work promptly.

Do not allow a background task to appear “active” for hours merely because a waiter process exists.

If a session spends a substantial period without moving an acceptance criterion, diagnose why before adding more workers.

## 22. TOKEN AND COST DISCIPLINE IS ECONOMIC, NOT AN ARBITRARY CAP

There is no fixed agent-count or token ceiling when additional parallel work has clear marginal value.

However, before a large model fan-out, estimate:

* number of independent units;
* expected output per unit;
* model class required;
* reconciliation cost;
* shared-resource contention;
* whether a deterministic alternative exists.

Additional model spend should have a clear expected information gain.

Stop adding reviewers when the next reviewer is unlikely to change the decision.

Spend heavily when it converts substantial wall-clock time into verified independent work.

Do not spend heavily merely to hear the same conclusion repeatedly.

## 23. USE MODEL CAPABILITY APPROPRIATELY

Not every worker needs the most expensive/deepest model.

Use stronger reasoning for:

* ambiguous identity reconciliation;
* novel source discovery;
* governance interpretation;
* adversarial reasoning;
* complex architectural design.

Use simpler/deterministic execution for:

* known adapter runs;
* mechanical extraction;
* file inventories;
* source existence checks;
* repeated classification with stable rules;
* already-learned procedures.

Model choice is part of efficiency.

Do not downgrade a task whose uncertainty genuinely requires stronger reasoning merely to save cost.

## 24. DO NOT CONFUSE ACTIVITY WITH PROGRESS

Agent count is not progress.
Token count is not progress.
Test count is not progress.
Commits are not progress.
Hours spent are not progress.

Progress is:

acceptance criteria moving from unresolved → proved

and durable capability being created so the same work is cheaper next time.

## 25. DISCOVERED WORK MUST NOT EXPLODE THE SESSION

New defects found during work are classified:

BLOCKING — must fix before acceptance/merge.

HIGH-RISK ADJACENT — durable obligation immediately; work concurrently if capacity exists and it cannot destabilize the critical path.

FRONTIER — record and continue.

Do not turn every discovery into another lane in the current session.

Do not hide discoveries merely to preserve scope either.

Correct classification is the goal.

## 26. PROVIDER/LIVE-STATE CHECKS HAPPEN ONCE AT THE RIGHT TIME

External claims such as:

* deployment;
* DNS;
* HTTPS;
* redirect;
* database migration state;
* staging isolation;
* production model;
* scheduler process health;

should be read back from the actual provider/live endpoint once the relevant state exists.

Do not repeatedly poll external providers while implementation is still changing unless waiting on them is the critical path.

Build first. Prove once when the state is meaningful.

## 27. PRESERVE A GREEN EXACT HEAD

Once the integrated head is green:

do not casually modify it.

Any subsequent change must have a clear acceptance reason.

A final exact-head result is an asset.

Avoid “one tiny cleanup” after final gates that forces another complete verification cycle unless the cleanup genuinely matters.

## 28. SESSION SCOPE SHOULD BE COHERENT

Parallelism can make large sessions practical, but it does not eliminate integration complexity.

Prefer sessions whose deliverables share an architectural theme or dependency graph.

Do not combine unrelated UI polish, infrastructure migration, source acquisition, governance redesign, model economics, production operations, and provider setup merely because all can technically run in parallel.

When future work naturally separates into independent themes, separate sessions may be faster overall because each gets a much smaller integration surface.

This is a planning preference, not a prohibition against large sessions when one integrated change genuinely requires them.

## 29. DEFINITION OF EFFICIENT

Efficient means:

* 50 independent jurisdiction workers when there are 50 independent jurisdictions;
* 1 reviewer instead of 50 reviewers when there is one claim;
* one authoritative denominator instead of repeated pilot hunts;
* one typed worker result schema instead of fifty narrative reports;
* one targeted reproduction instead of repeated full-suite runs;
* one provider readback instead of ten assumptions;
* one deterministic invariant instead of recurring model inspection;
* one clean integration path instead of repeated conflict repair;
* one exact-head shipping proof instead of reassurance reruns;
* learned procedures graduating into code.

Efficient does not mean doing less.

It means doing more useful work simultaneously, while minimizing duplication, contention, reconciliation, and re-proof.

## 30. A SESSION MAY END UNFINISHED WITHOUT BECOMING A FAILURE

When the planned shipping point has been reached and remaining work is correctly classified and durably recorded, do not repeatedly extend the session merely to improve the percentage of acceptance criteria marked MET.

NOT MET and NEEDS_SEAN are legitimate terminal session outcomes.

A newly discovered defect becomes same-session work only under the BLOCKING/HIGH-RISK rules already defined (§25). Otherwise it belongs to the next coherent session.

Do not use merge exceptions, continuation language, or closeout verification as a mechanism for repeatedly expanding a session that has already produced its intended integrated shipment. A rule that tells us when a second merge MAY happen does not mean a second merge SHOULD happen; technical permission is not strategic recommendation.

## SESSION BOOTSTRAP REQUIREMENT

Before starting implementation, report briefly:

1. the finite acceptance table;
2. the critical path;
3. what work will be parallelized and why those units are independent;
4. what shared resources must be serialized;
5. the proving instrument for each acceptance item;
6. which proofs are deterministic and which genuinely require model judgment.

Then execute.

Do not spend a long opening period narrating the plan. The bootstrap exists to prevent wasted work, not to become work itself.

## SESSION CLOSEOUT REQUIREMENT

Before declaring the session complete:

1. read the original acceptance table;
2. classify every item `MET / NOT MET / NEEDS_SEAN`;
3. cite the actual proving artifact/check for each;
4. run only the remaining final integrated proofs;
5. perform targeted adversarial refutation of high-risk claims;
6. reconcile contradictions rather than averaging reviewer opinions;
7. report unresolved work honestly;
8. do not launch a broad verifier swarm merely because closeout has begun.

The objective is not maximum confidence purchased with unlimited repetition.

The objective is the strongest justified confidence obtainable with the least redundant work.
