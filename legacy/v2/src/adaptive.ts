import type { AdaptivePlan, AdaptiveToolPlan, Task } from "./types.ts";

const WEAK_ACCEPTANCE_RE = /^(done|works|working|complete|ship it|good enough)$/i;
const UI_RE = /\b(ui|ux|screen|page|layout|button|form|modal|dashboard|component|react|css|frontend|web|mobile)\b/i;
const LARGE_SCOPE_RE = /\b(refactor|migrate|rewrite|overhaul|system|platform|multiple|multi-step|end-to-end|full stack|workflow|dashboard)\b/i;
const RISK_RE = /\b(auth|security|permission|migration|performance|backward compatibility|packaging|release|production)\b/i;

function addTool(
  tools: AdaptiveToolPlan[],
  tool: AdaptiveToolPlan["tool"],
  stage: AdaptiveToolPlan["stage"],
  rationale: string,
): void {
  if (!tools.some((entry) => entry.tool === tool && entry.stage === stage)) {
    tools.push({ tool, stage, rationale });
  }
}

export function buildAdaptivePlan(task: Task): AdaptivePlan {
  const tools: AdaptiveToolPlan[] = [];
  const goal = task.goal.trim();
  const context = task.context.trim();
  const acceptance = task.acceptance.trim();
  const constraints = task.constraints?.trim() || "";
  const combined = [goal, context, acceptance, constraints].join("\n");

  if (
    acceptance.length < 32 ||
    WEAK_ACCEPTANCE_RE.test(acceptance) ||
    !/\b(test|file|screen|route|command|response|diff|exists|render|log|button|field|api|pass)\b/i.test(acceptance)
  ) {
    addTool(tools, "specify", "preflight", "Acceptance criteria are too weak for a reliable stop condition.");
  }

  if (
    combined.length > 280 ||
    LARGE_SCOPE_RE.test(combined) ||
    goal.split(/\band\b|,/i).length > 2
  ) {
    addTool(tools, "decompose", "preflight", "The scope looks broad enough that the agent should sequence the work explicitly.");
  }

  if (UI_RE.test(combined)) {
    addTool(tools, "ux-review", "review", "The task appears user-facing, so the review should explicitly check the interaction and presentation.");
  }

  if (RISK_RE.test(combined) || tools.some((tool) => tool.tool === "decompose")) {
    addTool(tools, "polish", "review", "The change looks risky enough to justify an explicit final quality pass.");
  }

  const summary = tools.length === 0
    ? "Use the default execute -> verify -> review loop without extra adaptive tools."
    : `Adaptive tools: ${tools.map((tool) => `${tool.tool} (${tool.stage})`).join(", ")}.`;

  return { summary, tools };
}
