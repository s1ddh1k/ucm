import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import YAML from "yaml";
import type {
  AgentSnapshot,
  RoleContract,
  RoleContractId,
  RuntimeProvider,
  RunDetail,
} from "../shared/contracts";
import { latestValidArtifactPayload } from "./runtime-artifact-queries";
import {
  listReleaseQualityIssues,
  normalizeReviewQualitySummary,
} from "./runtime-review-quality-core";
import {
  loadRuntimeSchemaRegistry,
  resolveUcmRepoRoot,
  validateArtifactPayload,
  type ArtifactSchemaId,
} from "./runtime-schema-loader";
import type { RuntimeState } from "./runtime-state";
import { satisfiesRoleDependency } from "./runtime-role-dependencies";

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
  repoRoot: string | null;
  diagnostics: string[];
  contractsById: Partial<Record<RoleContractId, RoleContract>>;
  enforceRoleContracts: boolean;
  getRoleContract: (id: RoleContractId) => RoleContract | null;
  hasRoleContract: (id: RoleContractId) => boolean;
  validateArtifact: (
    schemaId: ArtifactSchemaId,
    payload: unknown,
  ) => ReturnType<typeof validateArtifactPayload>;
};

export type RoleContractValidationResult = {
  valid: boolean;
  errors: string[];
  providerPreference?: RuntimeProvider;
};

let cachedRegistry: RuntimeRoleRegistry | null = null;

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath ? error.instancePath : "$";
    return `${location} ${error.message ?? "is invalid"}`.trim();
  });
}

function expectedRoleContractFilename(contractId: RoleContractId): string {
  return `${contractId}.yaml`;
}

function readJsonFile(filePath: string): AnySchema {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as AnySchema;
}

export function inferRoleContractIdForRun(
  run: Pick<RunDetail, "status" | "origin">,
  agentRole?: AgentSnapshot["role"],
): RoleContractId {
  if (
    agentRole === "verification" &&
    (run.origin?.schedulerRuleId === "review_from_review_ready_event" ||
      run.status === "needs_review")
  ) {
    return "reviewer_agent";
  }

  if (agentRole === "verification") {
    return "qa_agent";
  }
  if (agentRole === "implementation") {
    return "builder_agent";
  }
  if (agentRole === "research") {
    return "research_agent";
  }
  if (agentRole === "design") {
    return "architect_agent";
  }
  return "conductor";
}

export function isExecutableRoleContractCompatible(
  agentRole: AgentSnapshot["role"],
  roleContractId: RoleContractId,
): boolean {
  if (agentRole === "implementation") {
    return roleContractId === "builder_agent";
  }
  if (agentRole === "research") {
    return (
      roleContractId === "research_agent" ||
      roleContractId === "ops_agent" ||
      roleContractId === "learning_agent"
    );
  }
  if (agentRole === "verification") {
    return (
      roleContractId === "qa_agent" ||
      roleContractId === "reviewer_agent" ||
      roleContractId === "security_agent" ||
      roleContractId === "release_agent"
    );
  }
  if (agentRole === "design") {
    return roleContractId === "architect_agent" || roleContractId === "spec_agent";
  }
  if (agentRole === "coordination") {
    return roleContractId === "conductor" || roleContractId === "spec_agent";
  }
  return true;
}

function resolveAllowedProvider(
  allowedProviders: RuntimeProvider[] | undefined,
  preferredProvider: RuntimeProvider | undefined,
): RuntimeProvider | undefined {
  if (!allowedProviders || allowedProviders.length === 0) {
    return preferredProvider;
  }
  if (preferredProvider && allowedProviders.includes(preferredProvider)) {
    return preferredProvider;
  }
  return allowedProviders[0];
}

export function validateRoleContractRunStart(input: {
  state: RuntimeState;
  missionId: string;
  run: RunDetail;
  agent: AgentSnapshot;
  roleRegistry: RuntimeRoleRegistry;
  preferredProvider?: RuntimeProvider;
}): RoleContractValidationResult {
  const { state, missionId, run, agent, roleRegistry, preferredProvider } = input;
  if (!roleRegistry.enforceRoleContracts) {
    return {
      valid: false,
      errors: [
        "Role contract enforcement is disabled. Fix role contract diagnostics before starting this run.",
        ...roleRegistry.diagnostics,
      ],
      providerPreference: preferredProvider,
    };
  }

  if (!run.roleContractId) {
    return {
      valid: false,
      errors: ["Run has no attached role contract."],
      providerPreference: preferredProvider,
    };
  }

  const contract = roleRegistry.getRoleContract(run.roleContractId);
  if (!contract) {
    return {
      valid: false,
      errors: [`Missing role contract "${run.roleContractId}".`],
      providerPreference: preferredProvider,
    };
  }

  const errors: string[] = [];
  if (!isExecutableRoleContractCompatible(agent.role, contract.id)) {
    errors.push(`Role contract "${contract.id}" is incompatible with agent role "${agent.role}".`);
  }

  const normalizedProvider = run.workspaceCommand?.trim()
    ? undefined
    : resolveAllowedProvider(contract.allowedProviders, preferredProvider);
  if (!run.workspaceCommand?.trim() && !normalizedProvider) {
    errors.push(`Role contract "${contract.id}" does not allow any execution provider.`);
  }

  for (const dependency of contract.requiredInputs ?? []) {
    if (!dependency.required) {
      continue;
    }
    if (
      !satisfiesRoleDependency({
        state,
        missionId,
        run,
        kind: dependency.kind,
        freshness: dependency.freshness,
        phase: "input",
      })
    ) {
      errors.push(`Missing required input "${dependency.kind}" for role contract "${contract.id}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    providerPreference: normalizedProvider,
  };
}

export function validateRoleContractRunCompletion(input: {
  state: RuntimeState;
  missionId: string;
  run: RunDetail;
  agent: AgentSnapshot;
  roleRegistry: RuntimeRoleRegistry;
}): RoleContractValidationResult {
  const { state, missionId, run, agent, roleRegistry } = input;
  if (!roleRegistry.enforceRoleContracts || !run.roleContractId) {
    return { valid: true, errors: [] };
  }

  const contract = roleRegistry.getRoleContract(run.roleContractId);
  if (!contract) {
    return {
      valid: false,
      errors: [`Missing role contract "${run.roleContractId}".`],
    };
  }

  const errors: string[] = [];
  if (!isExecutableRoleContractCompatible(agent.role, contract.id)) {
    errors.push(`Role contract "${contract.id}" is incompatible with agent role "${agent.role}".`);
  }

  for (const dependency of contract.requiredOutputs ?? []) {
    if (!dependency.required) {
      continue;
    }
    if (
      !satisfiesRoleDependency({
        state,
        missionId,
        run,
        kind: dependency.kind,
        freshness: dependency.freshness,
        phase: "output",
      })
    ) {
      errors.push(`Missing required output "${dependency.kind}" for role contract "${contract.id}".`);
    }
  }

  if (contract.id === "release_agent") {
    const manifest = latestValidArtifactPayload<{
      qualityGates?: {
        functionalStatus?: string;
        visualStatus?: string;
        bugRiskStatus?: string;
        smokeStatus?: string;
        knownIssues?: string[];
      };
    }>(run, "release_manifest");
    const quality = manifest?.qualityGates
      ? normalizeReviewQualitySummary({
          ...manifest.qualityGates,
          surfacesReviewed: [],
        })
      : null;
    if (!quality) {
      errors.push('Release manifest is missing quality gate metadata.');
    } else {
      errors.push(...listReleaseQualityIssues(quality));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function loadRuntimeRoleRegistry(input?: {
  repoRoot?: string | null;
}): RuntimeRoleRegistry {
  if (!input?.repoRoot && cachedRegistry) {
    return cachedRegistry;
  }

  const repoRoot = resolveUcmRepoRoot(input?.repoRoot);
  const diagnostics: string[] = [];
  const contractsById: RuntimeRoleRegistry["contractsById"] = {};
  const schemaRegistry = loadRuntimeSchemaRegistry(
    repoRoot ? { repoRoot } : input,
  );

  if (!repoRoot) {
    const registry = createRegistry({
      repoRoot: null,
      diagnostics: [
        "UCM role contract directory could not be resolved. Role contract enforcement is disabled.",
      ],
      contractsById,
      enforceRoleContracts: false,
    });
    if (!input?.repoRoot) {
      cachedRegistry = registry;
    }
    return registry;
  }

  const schemaPath = path.join(repoRoot, "schemas", "role-contract.schema.json");
  const contractsDir = path.join(repoRoot, "roles", "contracts");

  if (!fs.existsSync(schemaPath) || !fs.existsSync(contractsDir)) {
    const registry = createRegistry({
      repoRoot,
      diagnostics: [
        "Role contract schema or contracts directory is missing. Role contract enforcement is disabled.",
      ],
      contractsById,
      enforceRoleContracts: false,
    });
    if (!input?.repoRoot) {
      cachedRegistry = registry;
    }
    return registry;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  let validateContract: ValidateFunction<unknown>;
  try {
    validateContract = ajv.compile(readJsonFile(schemaPath));
  } catch (error) {
    const registry = createRegistry({
      repoRoot,
      diagnostics: [
        `Failed to compile role contract schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      contractsById,
      enforceRoleContracts: false,
    });
    if (!input?.repoRoot) {
      cachedRegistry = registry;
    }
    return registry;
  }

  for (const fileName of fs.readdirSync(contractsDir).sort()) {
    if (!fileName.endsWith(".yaml")) {
      continue;
    }
    const filePath = path.join(contractsDir, fileName);
    try {
      const parsed = YAML.parse(fs.readFileSync(filePath, "utf8"));
      const valid = Boolean(validateContract(parsed));
      if (!valid) {
        diagnostics.push(
          `Invalid role contract ${fileName}: ${formatAjvErrors(validateContract.errors).join("; ")}`,
        );
        continue;
      }

      const contract = parsed as RoleContract;
      if (fileName !== expectedRoleContractFilename(contract.id)) {
        diagnostics.push(
          `Role contract "${contract.id}" should be named ${expectedRoleContractFilename(contract.id)}.`
        );
      }
      if (contractsById[contract.id]) {
        diagnostics.push(`Duplicate role contract id "${contract.id}" found in ${fileName}.`);
        continue;
      }
      contractsById[contract.id] = contract;
    } catch (error) {
      diagnostics.push(
        `Failed to load role contract ${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const roleId of ROLE_CONTRACT_IDS) {
    if (!contractsById[roleId]) {
      diagnostics.push(`Missing role contract for "${roleId}".`);
    }
  }

  const hasCompleteContractSet = ROLE_CONTRACT_IDS.every(
    (roleId) => Boolean(contractsById[roleId]),
  );

  const registry = createRegistry({
    repoRoot,
    diagnostics: [...diagnostics, ...schemaRegistry.diagnostics],
    contractsById,
    enforceRoleContracts:
      diagnostics.length === 0 &&
      hasCompleteContractSet &&
      schemaRegistry.enforceArtifactSchemas,
  });

  if (!input?.repoRoot) {
    cachedRegistry = registry;
  }
  return registry;
}

function createRegistry(input: {
  repoRoot: string | null;
  diagnostics: string[];
  contractsById: Partial<Record<RoleContractId, RoleContract>>;
  enforceRoleContracts: boolean;
}): RuntimeRoleRegistry {
  return {
    repoRoot: input.repoRoot,
    diagnostics: input.diagnostics,
    contractsById: input.contractsById,
    enforceRoleContracts: input.enforceRoleContracts,
    getRoleContract: (id) => input.contractsById[id] ?? null,
    hasRoleContract: (id) => Boolean(input.contractsById[id]),
    validateArtifact: (schemaId, payload) =>
      validateArtifactPayload(schemaId, payload, { repoRoot: input.repoRoot }),
  };
}
