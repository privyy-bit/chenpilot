# AgentPlanner and PlanExecutor Failure Semantics

## Current behavior

`AgentPlanner` creates an `ExecutionPlan`; `PlanExecutor` executes its steps in
order. The executor's non-durable execution path has the following semantics
when a tool fails:

1. The failed step is recorded as a failed `StepResult`.
2. Execution stops immediately by default (`stopOnError` defaults to `true`).
3. Steps that follow the failed step are not executed.
4. Previously successful steps are not rolled back. The executor does not invoke
   a step's optional `rollbackAction` and there is no compensating-action
   orchestration in the current implementation.
5. The returned `ExecutionResult` reports the completed step count and includes
   the successful and failed step results so the caller can tell the user which
   operations completed.
6. A failure on the first step returns `status: "failed"` with zero completed
   steps. A failure after at least one successful step returns `status:
   "partial"`.
7. `PlanExecutor` does not automatically retry a failed step and does not
   provide a resume-from-failure operation. A caller must decide whether and
   how to submit another plan.

The executor can be configured with `stopOnError: false` for callers that
explicitly want execution to continue after a failed step. That option does not
add rollback or retry behavior and should only be used when later steps are
safe to run independently.

The durable execution path starts a durable execution and returns a `running`
result to the caller. Durable workers must preserve the same safety contract:
failed work must not be represented as successfully rolled back unless an
explicit compensating action has actually completed.

## Covered cases

Unit tests in `tests/unit/plan_executor_failure.test.ts` cover failures at:

- The first step of a five-step plan.
- The middle (third) step of a five-step plan.
- The last (fifth) step of a five-step plan.

They verify stop-on-error behavior, completed-step reporting, failed-step
reporting, and that later steps are not executed.

## Known gap and follow-up issue

Rollback is not implemented. Blockchain and DeFi tools can produce external
side effects, so reporting partial completion does not restore the state before
the plan began. This should be tracked as a separate issue:

**Follow-up issue: Add compensating-action rollback for failed execution plans**

- Define and validate compensating actions for side-effecting plan steps.
- Execute compensating actions in reverse order for previously successful steps.
- Record each compensation attempt and outcome in the execution result.
- Make rollback policy explicit per plan, including behavior when compensation
  itself fails.
- Add integration tests for successful rollback and compensation failure.

Until that work is implemented, callers must treat `partial` results as
partially completed operations requiring reconciliation rather than as rolled
back transactions.
