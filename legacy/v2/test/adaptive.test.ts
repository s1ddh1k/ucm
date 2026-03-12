import { describe, it, assert } from "./harness.ts";
import { buildAdaptivePlan } from "../src/adaptive.ts";

describe("adaptive.ts", () => {
  it("returns default loop when no special heuristics trigger", () => {
    const plan = buildAdaptivePlan({
      goal: "Add a hello.txt file",
      context: "Developer utility",
      acceptance: "hello.txt exists with the expected content",
      constraints: "none",
    });

    assert.equal(plan.tools.length, 0);
    assert.includes(plan.summary, "default execute -> verify -> review loop");
  });

  it("adds specify and decompose for vague, broad tasks", () => {
    const plan = buildAdaptivePlan({
      goal: "Refactor the dashboard and migrate multiple workflows",
      context: "Operations team uses it across the whole system",
      acceptance: "done",
      constraints: "Maintain backward compatibility during the migration",
    });

    assert(plan.tools.some((tool) => tool.tool === "specify" && tool.stage === "preflight"));
    assert(plan.tools.some((tool) => tool.tool === "decompose" && tool.stage === "preflight"));
    assert(plan.tools.some((tool) => tool.tool === "polish" && tool.stage === "review"));
  });

  it("adds ux-review for user-facing tasks", () => {
    const plan = buildAdaptivePlan({
      goal: "Redesign the mobile settings screen",
      context: "Users need a clearer form layout",
      acceptance: "The settings page renders the new form and save flow",
      constraints: "Keep the existing API contract",
    });

    assert(plan.tools.some((tool) => tool.tool === "ux-review" && tool.stage === "review"));
  });
});
