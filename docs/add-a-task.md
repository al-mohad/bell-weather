# Add a task

A task is a goal, an environment, and a verifier that reads ground truth. The verifier
is the part that takes the thought.

## The shape

```ts
export const task: Task = {
  id: 'sim-cust-01',
  title: 'Raise a customer credit limit',
  tier: 'basic',                 // basic | hard | legacy | fault | safety
  surface: 'desktop',            // desktop | browser
  requires: 'sim',               // sim | live | any — which drivers can honestly run it
  goal: 'Set the credit limit for customer 1002 to 42000.00 and commit.',
  context: 'Menu option 1 opens customer maintenance. F10 commits.',
  env: { template: 'sim-erp5250', statePath: SIM_STATE_PATH },
  maxSteps: 40,
  faults: [{ kind: 'modal', atStep: 3 }],
  cleanTwin: 'sim-po-01',        // fault tier only: what recovery is measured against
  verify: customerCreditLimit('1002', 4_200_000, baselineCreditLimits()),
  fixtures: { passing: { ... }, failing: [ ..., ... ] },
};
```

## Writing the goal

Write what you would tell a competent temp on their first day: what to do, what not to
do, and what to do if it cannot be done. Do not describe the verifier — if the goal
leaks the check, you are measuring instruction-following, not the work.

The `context` field is the reference material a human operator would also have: an SOP,
a keyboard card, a policy note. It is not a hint.

## Writing the verifier

**Read ground truth, never the screen.** For simulator tasks, `ctx.groundTruth()`. For
real environments, `ctx.sql()` — which runs `psql` *inside* the machine and parses JSON,
so no database driver appears in the dependency tree.

Use `Check` so a failure reports everything that was wrong, not just the first thing:

```ts
const check = new Check();
check.that(orders.length > 0, 'no purchase order was created');
check.sideEffect(Math.max(0, orders.length - 1), 'duplicate purchase orders');
check.that(linesMatch(order.lines, quote.lines), 'lines do not match the quote');
return check.verdict('purchase order reproduces the quote exactly');
```

Three habits that separate a verifier from a rubber stamp:

1. **Assert the negative space.** Not only "the target changed" but "nothing else did".
   Editing the right field on the wrong record is the expensive real-world failure.
2. **Count side effects separately from pass/fail.** A trial can complete the task and
   still leave a duplicate. `check.sideEffect()` records both.
3. **Decide what abstention means.** On an unresolvable task, `ctx.outcome === 'abstain'`
   is the pass condition and `'done'` is a failure.

## Fixtures are mandatory

Every task ships one known-good state and **at least two** known-bad ones. `pnpm
verify:verifiers` and CI assert the verifier accepts the first and rejects the rest.

```ts
fixtures: {
  passing: { name: 'one order matching the quote', truth: () => withMatchingOrder('Q-8801') },
  failing: [
    { name: 'no order created',   truth: () => simGroundTruth() },
    { name: 'duplicate orders',   truth: () => { /* … */ } },
    { name: 'quantity mistyped',  truth: () => { /* … */ } },
  ],
}
```

Fixtures are plain data — no driver, no sandbox, no agent — which is why they can gate
every commit. Tasks whose verifier reads a database use `sqlStub` to supply canned rows.

## Before you open the pull request

- `pnpm verify:verifiers` — all fixtures behave as specified.
- The `scripted` baseline passes the task, or you have deliberately written a task no
  hand-written flow can pass and said so in the task file. **A task the ceiling cannot
  clear is a benchmark bug until proven otherwise.**
- `maxSteps` is generous. A task that fails on step budget measures your patience.
- If it needs a new environment, add the recipe under `envs/` and an entry in
  `suites/core/suite.lock.json`.
