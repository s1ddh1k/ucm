import type {
  AgentSnapshot,
  RoleContractId,
  RuntimeProvider,
  RunDetail,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

export const ROLE_CONTRACT_IDS = [
  "conductor",
  "spec_agent",
  "research_agent",
  "architect_agent",
  "builder_agent",
  "reviewer_agent",
  "qa_agent",
  "security_agent",
  "release_agent",
  "ops_agent",
  "learning_agent",
] as const satisfies readonly RoleContractId[];

export type RuntimeRoleRegistry = {
  enforceRoleContracts: boolean;
};

export type RoleContractValidationResult = {
  valid: boolean;
  errors: string[];
  providerPreference?: RuntimeProvider | "local";
};

export function inferRoleContractIdForRun(
  _run: Pick<RunDetail, "status" | "origin">,
  agentRole?: AgentSnapshot["role"],
): RoleContractId {
  if (agentRole === "coordination") {
    return "conductor";
  }
  if (agentRole === "verification") {
    return "qa_agent";
  }
  if (agentRole === "implementation") {
    return "builder_agent";
  }
  return "builder_agent";
}

export function validateRoleContractRunStart(input: {
  state: RuntimeState;
  missionId: string;
  run: RunDetail;
  agent: AgentSnapshot;
  roleRegistry: RuntimeRoleRegistry;
  preferredProvider?: RuntimeProvider | "local";
}): RoleContractValidationResult {
  return {
    valid: true,
    errors: [],
    providerPreference: input.preferredProvider,
  };
}

export function validateRoleContractRunCompletion(_input: {
  state: RuntimeState;
  missionId: string;
  run: RunDetail;
  agent: AgentSnapshot;
  roleRegistry: RuntimeRoleRegistry;
}): RoleContractValidationResult {
  return { valid: true, errors: [] };
}

export function loadRuntimeRoleRegistry(_input?: {
  repoRoot?: string | null;
}): RuntimeRoleRegistry {
  return { enforceRoleContracts: false };
}
