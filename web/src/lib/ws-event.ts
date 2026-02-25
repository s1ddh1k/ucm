import type { DaemonStats, ProposalStatus, TaskState } from "@/api/types";

const DAEMON_STATUS_VALUES = ["running", "paused", "offline"] as const;
const TASK_STATE_VALUES = [
  "pending",
  "running",
  "review",
  "done",
  "failed",
] as const;
const PROPOSAL_STATUS_VALUES = [
  "proposed",
  "packaging",
  "packaged",
  "held",
  "approved",
  "rejected",
  "implemented",
] as const;

type StringValues<T extends readonly string[]> = T[number];

function isStringEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
): value is StringValues<T> {
  return (
    typeof value === "string" &&
    (values as readonly string[]).includes(value)
  );
}

export function getStringField(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

export function getNumberField(
  data: Record<string, unknown>,
  key: string,
): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

export function getArrayBufferField(
  data: Record<string, unknown>,
  key: string,
): ArrayBuffer | null {
  const value = data[key];
  return value instanceof ArrayBuffer ? value : null;
}

export function parseDaemonStatus(value: unknown): DaemonStats["daemonStatus"] | null {
  return isStringEnum(value, DAEMON_STATUS_VALUES) ? value : null;
}

export function parseTaskState(value: unknown): TaskState | null {
  return isStringEnum(value, TASK_STATE_VALUES) ? value : null;
}

export function parseProposalStatus(value: unknown): ProposalStatus | null {
  return isStringEnum(value, PROPOSAL_STATUS_VALUES) ? value : null;
}
