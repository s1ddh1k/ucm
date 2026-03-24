import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";

export const ARTIFACT_SCHEMA_IDS = [
  "adr_record",
  "acceptance_checks",
  "alternative_set",
  "architecture_record",
  "decision_record",
  "deliverable_revision",
  "evidence_log",
  "review_packet",
  "evidence_pack",
  "handoff_record",
  "improvement_proposal",
  "incident_record",
  "patch_set",
  "research_dossier",
  "release_manifest",
  "rollback_plan",
  "security_report",
  "success_metrics",
  "risk_register",
  "run_trace",
  "spec_brief",
  "task_backlog",
  "test_result",
] as const;

export type ArtifactSchemaId = (typeof ARTIFACT_SCHEMA_IDS)[number];

export type SchemaValidationResult = {
  valid: boolean;
  enforced: boolean;
  errors: string[];
};

type RuntimeSchemaRegistry = {
  repoRoot: string | null;
  diagnostics: string[];
  validators: Partial<Record<ArtifactSchemaId, ValidateFunction<unknown>>>;
  enforceArtifactSchemas: boolean;
};

const SCHEMA_PATHS: Record<ArtifactSchemaId, string[]> = {
  adr_record: ["schemas", "artifacts", "adr-record.schema.json"],
  acceptance_checks: ["schemas", "artifacts", "acceptance-checks.schema.json"],
  alternative_set: ["schemas", "artifacts", "alternative-set.schema.json"],
  architecture_record: ["schemas", "artifacts", "architecture-record.schema.json"],
  decision_record: ["schemas", "artifacts", "decision-record.schema.json"],
  deliverable_revision: ["schemas", "artifacts", "deliverable-revision.schema.json"],
  evidence_log: ["schemas", "artifacts", "evidence-log.schema.json"],
  review_packet: ["schemas", "artifacts", "review-packet.schema.json"],
  evidence_pack: ["schemas", "artifacts", "evidence-pack.schema.json"],
  handoff_record: ["schemas", "artifacts", "handoff-record.schema.json"],
  improvement_proposal: ["schemas", "artifacts", "improvement-proposal.schema.json"],
  incident_record: ["schemas", "artifacts", "incident-record.schema.json"],
  patch_set: ["schemas", "artifacts", "patch-set.schema.json"],
  research_dossier: ["schemas", "artifacts", "research-dossier.schema.json"],
  release_manifest: ["schemas", "artifacts", "release-manifest.schema.json"],
  rollback_plan: ["schemas", "artifacts", "rollback-plan.schema.json"],
  security_report: ["schemas", "artifacts", "security-report.schema.json"],
  success_metrics: ["schemas", "artifacts", "success-metrics.schema.json"],
  risk_register: ["schemas", "artifacts", "risk-register.schema.json"],
  run_trace: ["schemas", "artifacts", "run-trace.schema.json"],
  spec_brief: ["schemas", "artifacts", "spec-brief.schema.json"],
  task_backlog: ["schemas", "artifacts", "task-backlog.schema.json"],
  test_result: ["schemas", "artifacts", "test-result.schema.json"],
};

let cachedRegistry: RuntimeSchemaRegistry | null = null;

function hasRuntimeConfigRoot(candidate: string | null | undefined): candidate is string {
  if (!candidate) {
    return false;
  }

  const hasRoles = fs.existsSync(path.join(candidate, "roles", "contracts"));
  const hasSchemas = fs.existsSync(path.join(candidate, "schemas"));
  return hasRoles && hasSchemas;
}

export function resolveUcmRepoRoot(explicitRoot?: string | null): string | null {
  const runtimeConfigDir = process.env.UCM_RUNTIME_CONFIG_DIR;
  const resourcesPath = process.resourcesPath;
  const candidates = [
    explicitRoot,
    runtimeConfigDir,
    process.env.UCM_REPO_ROOT,
    resourcesPath ? path.join(resourcesPath, "runtime-config") : null,
    resourcesPath ? path.join(resourcesPath, "ucm-runtime-config") : null,
    path.resolve(__dirname, "../../resources/runtime-config"),
    path.resolve(process.cwd(), "resources/runtime-config"),
    path.resolve(__dirname, "../../../"),
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of new Set(candidates)) {
    if (hasRuntimeConfigRoot(candidate)) {
      return candidate;
    }
  }

  return null;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath ? error.instancePath : "$";
    return `${location} ${error.message ?? "is invalid"}`.trim();
  });
}

function readJsonSchema(filePath: string): AnySchema {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as AnySchema;
}

export function loadRuntimeSchemaRegistry(input?: {
  repoRoot?: string | null;
}): RuntimeSchemaRegistry {
  if (!input?.repoRoot && cachedRegistry) {
    return cachedRegistry;
  }

  const repoRoot = resolveUcmRepoRoot(input?.repoRoot);
  const diagnostics: string[] = [];
  const validators: RuntimeSchemaRegistry["validators"] = {};

  if (!repoRoot) {
    const registry = {
      repoRoot: null,
      diagnostics: [
        "UCM schema directory could not be resolved. Artifact schema enforcement is disabled.",
      ],
      validators,
      enforceArtifactSchemas: false,
    } satisfies RuntimeSchemaRegistry;
    if (!input?.repoRoot) {
      cachedRegistry = registry;
    }
    return registry;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });

  for (const schemaId of ARTIFACT_SCHEMA_IDS) {
    const schemaPath = path.join(repoRoot, ...SCHEMA_PATHS[schemaId]);
    if (!fs.existsSync(schemaPath)) {
      diagnostics.push(`Missing artifact schema: ${schemaPath}`);
      continue;
    }

    try {
      validators[schemaId] = ajv.compile(readJsonSchema(schemaPath));
    } catch (error) {
      diagnostics.push(
        `Failed to compile ${schemaId} schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const registry = {
    repoRoot,
    diagnostics,
    validators,
    enforceArtifactSchemas:
      diagnostics.length === 0 &&
      ARTIFACT_SCHEMA_IDS.every((schemaId) => Boolean(validators[schemaId])),
  } satisfies RuntimeSchemaRegistry;

  if (!input?.repoRoot) {
    cachedRegistry = registry;
  }
  return registry;
}

export function validateArtifactPayload(
  schemaId: ArtifactSchemaId,
  payload: unknown,
  input?: { repoRoot?: string | null },
): SchemaValidationResult {
  const registry = loadRuntimeSchemaRegistry(input);
  const validator = registry.validators[schemaId];

  if (!validator || !registry.enforceArtifactSchemas) {
    return {
      valid: true,
      enforced: false,
      errors: registry.diagnostics,
    };
  }

  const valid = Boolean(validator(payload));
  return {
    valid,
    enforced: true,
    errors: valid ? [] : formatAjvErrors(validator.errors),
  };
}

export function listSchemaDiagnostics(input?: {
  repoRoot?: string | null;
}): string[] {
  return loadRuntimeSchemaRegistry(input).diagnostics;
}
