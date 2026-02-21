export const TASK_STATES = ["pending", "running", "review", "done", "failed"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const PIPELINES = {
  trivial: ["implement", "verify", "deliver"],
  small: ["design", "implement", "verify", "deliver"],
  medium: ["clarify", "specify", "design", "implement", "verify", "ux-review", "polish", "deliver"],
  large: ["clarify", "specify", "decompose", "design", "implement", "verify", "ux-review", "polish", "integrate", "deliver"],
} as const;

export type PipelineName = keyof typeof PIPELINES;

export const STATE_COLORS: Record<TaskState, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  review: "text-purple-400",
  done: "text-emerald-400",
  failed: "text-red-400",
};

export const STATE_BG_COLORS: Record<TaskState, string> = {
  pending: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
  running: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  review: "bg-purple-400/10 text-purple-400 border-purple-400/20",
  done: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  failed: "bg-red-400/10 text-red-400 border-red-400/20",
};

export const PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "implemented"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_CATEGORIES = [
  "template", "core", "config", "test",
  "bugfix", "ux", "architecture", "performance", "docs", "research",
] as const;

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "text-emerald-400",
  medium: "text-yellow-400",
  high: "text-red-400",
};

export const AUTOPILOT_STATUSES = [
  "planning", "running", "paused", "awaiting_review",
  "releasing", "stopped", "completed",
] as const;
export type AutopilotStatus = (typeof AUTOPILOT_STATUSES)[number];
