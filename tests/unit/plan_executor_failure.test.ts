import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PlanExecutor } from "../../src/Agents/planner/PlanExecutor";
import { ExecutionPlan } from "../../src/Agents/planner/AgentPlanner";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";

jest.mock("../../src/Agents/registry/ToolRegistry");

describe("PlanExecutor multi-step failure semantics", () => {
  let executor: PlanExecutor;

  const createPlan = (): ExecutionPlan => ({
    planId: "plan_failure-semantics",
    steps: Array.from({ length: 5 }, (_, index) => ({
      stepNumber: index + 1,
      action: `step_${index + 1}`,
      payload: { step: index + 1 },
      description: `Step ${index + 1}`,
      dependencies: [],
    })),
    totalSteps: 5,
    estimatedDuration: 15000,
    riskLevel: "low",
    requiresApproval: false,
    summary: "Five-step failure semantics test plan",
  });

  beforeEach(() => {
    executor = new PlanExecutor();
    jest.clearAllMocks();
  });

  const executeWithFailureAt = async (failureAt: number) => {
    (toolRegistry.executeTool as jest.Mock).mockImplementation(
      async (action: string) => {
        const stepNumber = Number(action.replace("step_", ""));
        if (stepNumber === failureAt) {
          throw new Error(`step ${failureAt} failed`);
        }

        return {
          action,
          status: "success",
          data: { stepNumber },
        };
      }
    );

    return executor.executePlan(createPlan(), "user-123", {
      durable: false,
    });
  };

  it("reports a first-step failure and does not execute later steps", async () => {
    const result = await executeWithFailureAt(1);

    expect(result.status).toBe("failed");
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]).toMatchObject({
      stepNumber: 1,
      action: "step_1",
      status: "failed",
    });
    expect(result.error).toContain("step 1 failed");
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(1);
  });

  it("reports completed steps and a middle-step failure without rollback or continuation", async () => {
    const result = await executeWithFailureAt(3);

    expect(result.status).toBe("partial");
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults.map((step) => step.status)).toEqual([
      "success",
      "success",
      "failed",
    ]);
    expect(result.stepResults.map((step) => step.stepNumber)).toEqual([1, 2, 3]);
    expect(result.stepResults[2].error).toContain("step 3 failed");
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(3);
    expect(toolRegistry.executeTool).not.toHaveBeenCalledWith(
      "step_4",
      expect.anything(),
      "user-123"
    );
    expect(toolRegistry.executeTool).not.toHaveBeenCalledWith(
      "step_5",
      expect.anything(),
      "user-123"
    );
  });

  it("reports all prior successes and a last-step failure", async () => {
    const result = await executeWithFailureAt(5);

    expect(result.status).toBe("partial");
    expect(result.completedSteps).toBe(4);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults).toHaveLength(5);
    expect(result.stepResults.map((step) => step.status)).toEqual([
      "success",
      "success",
      "success",
      "success",
      "failed",
    ]);
    expect(result.stepResults[4].error).toContain("step 5 failed");
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(5);
  });
});
